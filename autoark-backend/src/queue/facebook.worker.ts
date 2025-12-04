import { Worker, WorkerOptions } from 'bullmq'
import { getRedisConnection, getRedisClient } from '../config/redis'
import logger from '../utils/logger'
import { accountQueue, campaignQueue, adQueue } from './facebook.queue'
import { fetchCampaigns } from '../integration/facebook/campaigns.api'
import { fetchAds } from '../integration/facebook/ads.api'
import { fetchInsights } from '../integration/facebook/insights.api'
import { normalizeForStorage } from '../utils/accountId'
import { upsertService } from '../services/facebook.upsert.service'
import { extractPurchaseValue } from '../utils/facebookPurchase'
import Campaign from '../models/Campaign'
import Ad from '../models/Ad'
import dayjs from 'dayjs'

// 检查 Redis 是否可用
const isRedisAvailable = (): boolean => {
  try {
    const client = getRedisClient()
    return client !== null
  } catch {
    return false
  }
}

// Worker 配置
let workerOptions: WorkerOptions | null = null
if (isRedisAvailable()) {
  try {
    workerOptions = {
      connection: getRedisConnection(),
      concurrency: 10, // 默认并发
      limiter: {
        max: 80, // 每分钟最多处理 80 个任务 (防止 API 限流)
        duration: 60000,
      },
    }
  } catch (error) {
    logger.warn('[Worker] Failed to create worker options, Redis may not be configured:', error)
  }
}

// 辅助函数：从 actions 数组中获取特定 action_type 的 value
const getActionValue = (actions: any[], actionType: string): number | undefined => {
  if (!actions || !Array.isArray(actions)) return undefined
  const action = actions.find((a: any) => a.action_type === actionType)
  return action ? parseFloat(action.value) : undefined
}

// 辅助函数：从 actions 数组中获取特定 action_type 的 count
const getActionCount = (actions: any[], actionType: string): number | undefined => {
  if (!actions || !Array.isArray(actions)) return undefined
  const action = actions.find((a: any) => a.action_type === actionType)
  return action ? parseFloat(action.value) : undefined
}

// ==================== 1. Account Sync Worker ====================
// 职责：拉取 Campaign 列表 -> 推送 Campaign 任务
export const accountWorker = (accountQueue && workerOptions) ? new Worker(
  'facebook.account.sync',
  async (job) => {
    const { accountId, token } = job.data
    logger.info(`[AccountWorker] Processing account: ${accountId}`)

    try {
      // 1. 拉取 Campaigns
      const campaigns = await fetchCampaigns(accountId, token)
      logger.info(`[AccountWorker] Fetched ${campaigns.length} campaigns for account ${accountId}`)

      // 2. 更新 Campaign 数据并推送任务
      const jobs = []
      for (const camp of campaigns) {
        // 更新 Campaign 基础信息
        await Campaign.findOneAndUpdate(
          { campaignId: camp.id },
          {
            campaignId: camp.id,
            accountId: normalizeForStorage(accountId),
            name: camp.name,
            status: camp.status,
            objective: camp.objective,
            daily_budget: camp.daily_budget,
            budget_remaining: camp.budget_remaining,
            buying_type: camp.buying_type,
            raw: camp,
          },
          { upsert: true, new: true }
        )

        // 仅处理活跃或有数据的 Campaign (可选过滤逻辑)
        // 推送到 campaignQueue
        if (campaignQueue) {
          jobs.push(campaignQueue.add(
            'sync-campaign',
            {
              accountId,
              campaignId: camp.id,
              token,
            },
            {
              jobId: `campaign-sync-${camp.id}-${dayjs().format('YYYY-MM-DD-HH')}`, // 每小时去重
              priority: 2,
            }
          ))
        }
      }
      
      await Promise.all(jobs)
      return { campaignsCount: campaigns.length }
    } catch (error: any) {
      logger.error(`[AccountWorker] Failed for account ${accountId}:`, error)
      throw error
    }
  },
  { ...workerOptions, concurrency: 5 } // 账户层级并发低一点
) : null

// ==================== 2. Campaign Sync Worker ====================
// 职责：拉取 Ad 列表 -> 推送 Ad 任务
export const campaignWorker = (campaignQueue && workerOptions) ? new Worker(
  'facebook.campaign.sync',
  async (job) => {
    const { accountId, campaignId, token } = job.data
    // logger.debug(`[CampaignWorker] Processing campaign: ${campaignId}`)

    try {
      // 1. 拉取 Ads
      const ads = await fetchAds(accountId, token)
      // 过滤出属于当前 Campaign 的广告 (API 可能返回账户下所有广告，如果 fetchAds 不支持 filter by campaign)
      // 实际上 fetchAds 是 fetch all ads for account. 
      // 优化：应该用 fetchAdsForCampaign(campaignId) 或者 filter.
      // 但 Facebook API GET /{campaign-id}/ads 是存在的。
      // 让我们假设 fetchAds 实际上是 fetchAllAdsForAccount。
      // 为了效率，我们可以只 fetch ads for this campaign. 
      // 现在的 ads.api.ts 是 fetchAds(accountId). 
      // 我们可以改进 ads.api.ts 或者在这里 filter。
      // 考虑到 fetchAds(accountId) 会拉取所有广告，如果每个 campaign worker 都拉一遍，会很浪费。
      // 更好的做法：AccountWorker 拉取 Campaign 列表。
      // CampaignWorker 拉取该 Campaign 下的 Ads。
      
      // 修正：我们应该调用 facebookClient 直接拉取 campaign 下的 ads，或者在 ads.api.ts 加一个 fetchAdsByCampaign
      // 暂时在这里直接调用 fetchAds(accountId) 并 filter 效率极低。
      // 应该修改 integration/facebook/ads.api.ts 增加 fetchAdsByCampaign。
      // 由于 Phase 1 已经 lock 了 api.ts，我这里先用 fetchAds 并且注意：fetchAds 参数是 accountId。
      // 如果 accountId 很大，这里会有性能问题。
      // 但 API 支持 filtering。
      // 暂时：我们用 fetchAds(accountId) 并 filter。
      // 或者：修改 ads.api.ts (允许)。
      
      // 实际上，Facebook Graph API: GET /{campaign_id}/ads 是标准做法。
      // 我会在 Phase 3 补充这个 API 调用。
      
      // 暂时用 fetchAds(accountId) 并 filter (低效，但兼容现有 API 签名)。
      // 实际上 fetchAds(accountId) 有 limit 1000。
      // 更好的方式：
      const { facebookClient } = require('../integration/facebook/facebookClient')
      const res = await facebookClient.get(`/${campaignId}/ads`, {
        access_token: token,
        fields: 'id,name,status,adset_id,campaign_id,creative{id},created_time,updated_time',
        limit: 500,
      })
      const campaignAds = res.data || []

      // 2. 更新 Ad 数据并推送任务
      const jobs = []
      for (const ad of campaignAds) {
        await Ad.findOneAndUpdate(
          { adId: ad.id },
          {
            adId: ad.id,
            adsetId: ad.adset_id,
            campaignId: ad.campaign_id,
            accountId: normalizeForStorage(accountId),
            name: ad.name,
            status: ad.status,
            creativeId: ad.creative?.id,
            raw: ad,
          },
          { upsert: true }
        )

        if (adQueue) {
          jobs.push(adQueue.add(
            'sync-ad',
            {
              accountId,
              campaignId,
              adId: ad.id,
              adsetId: ad.adset_id,
              token,
            },
            {
              jobId: `ad-sync-${ad.id}-${dayjs().format('YYYY-MM-DD-HH')}`,
              priority: 3,
            }
          ))
        }
      }

      await Promise.all(jobs)
      return { adsCount: campaignAds.length }
    } catch (error: any) {
      logger.error(`[CampaignWorker] Failed for campaign ${campaignId}:`, error)
      throw error
    }
  },
  { ...workerOptions, concurrency: 10 }
) : null

// ==================== 3. Ad Sync Worker ====================
// 职责：拉取 Ad Insights (多时间粒度) -> Upsert
export const adWorker = (adQueue && workerOptions) ? new Worker(
  'facebook.ad.sync',
  async (job) => {
    const { accountId, campaignId, adId, adsetId, token } = job.data
    // logger.debug(`[AdWorker] Processing ad: ${adId}`)

    try {
      // 拉取多个时间范围的数据
      const datePresets = ['today', 'yesterday', 'last_3d', 'last_7d']
      
      const promises = datePresets.map(async (preset) => {
        const insights = await fetchInsights(
          adId,
          'ad',
          preset,
          token,
          ['country'] // 按国家分组
        )
        
        if (!insights || insights.length === 0) return

        for (const insight of insights) {
          const country = insight.country || null
          const date = insight.date_start || dayjs().format('YYYY-MM-DD')
          
          // 计算实际日期
          let actualDate = date
          if (preset === 'yesterday') {
            actualDate = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
          } else if (preset === 'today') {
            actualDate = dayjs().format('YYYY-MM-DD')
          }
          // last_3d / last_7d 是聚合数据，date_start 是开始日期，但也可能包含多天。
          // RawInsights 存储时保留 datePreset 标记。
          // MetricsDaily 只有按天存储。如果是 last_3d，通常用于 Purchase 修正，不直接存入 MetricsDaily (或者存入 Raw 后由修正逻辑处理)。
          // 这里我们：
          // 1. RawInsights: 全部存储
          // 2. MetricsDaily: 只存 today / yesterday (单日数据)
          // 3. 修正逻辑会读取 RawInsights(last_7d) 来修正 MetricsDaily

          const purchaseValue = extractPurchaseValue(insight.action_values)
          const mobileAppInstall = getActionCount(insight.actions, 'mobile_app_install')

          // 1. Upsert RawInsights (All Presets)
          await upsertService.upsertRawInsights({
            date: actualDate,
            datePreset: preset,
            adId: adId,
            country: country,
            raw: insight,
            accountId: normalizeForStorage(accountId),
            campaignId: campaignId,
            adsetId: adsetId,
            spend: parseFloat(insight.spend || '0'),
            impressions: insight.impressions || 0,
            clicks: insight.clicks || 0,
            purchase_value: purchaseValue,
            syncedAt: new Date(),
            tokenId: job.data.tokenId || 'unknown',
          })

          // 2. Upsert MetricsDaily (Only Single Day Presets)
          if (preset === 'today' || preset === 'yesterday') {
            await upsertService.upsertMetricsDaily({
              date: actualDate,
              level: 'ad',
              entityId: adId,
              channel: 'facebook',
              country: country,
              
              accountId: normalizeForStorage(accountId),
              campaignId: campaignId,
              adsetId: adsetId,
              adId: adId,
              
              spend: parseFloat(insight.spend || '0'),
              impressions: insight.impressions || 0,
              clicks: insight.clicks || 0,
              purchase_value: purchaseValue || 0,
              roas: insight.purchase_roas ? parseFloat(insight.purchase_roas) : 0,
              
              cpc: insight.cpc ? parseFloat(insight.cpc) : undefined,
              cpm: insight.cpm ? parseFloat(insight.cpm) : undefined,
              
              actions: insight.actions,
              action_values: insight.action_values,
              mobile_app_install_count: mobileAppInstall,
              
              raw: insight,
            })
          }
        }
      })

      await Promise.all(promises)
      return { success: true }
    } catch (error: any) {
      logger.error(`[AdWorker] Failed for ad ${adId}:`, error)
      throw error
    }
  },
  { ...workerOptions, concurrency: 20 } // 广告层级并发高
) : null

// 初始化 Workers
export const initWorkers = () => {
  if (!accountWorker || !campaignWorker || !adWorker) {
    logger.warn('[Worker] Workers not initialized (Redis unavailable)')
    return
  }

  const workers = [
    { name: 'AccountWorker', worker: accountWorker },
    { name: 'CampaignWorker', worker: campaignWorker },
    { name: 'AdWorker', worker: adWorker },
  ]

  workers.forEach(({ name, worker }) => {
    worker.on('failed', (job, err) => {
      logger.error(`[${name}] Job ${job?.id} failed:`, err)
    })
    worker.on('error', (err) => {
      logger.error(`[${name}] Worker error:`, err)
    })
  })

  logger.info('[Worker] Facebook sync workers initialized (Pipeline V2)')
}
