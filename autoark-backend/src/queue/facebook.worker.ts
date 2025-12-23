import { Worker, WorkerOptions } from 'bullmq'
import { getRedisClient } from '../config/redis'
import logger from '../utils/logger'
import { accountQueue, campaignQueue, adQueue } from './facebook.queue'
import { fetchCampaigns } from '../integration/facebook/campaigns.api'
import { fetchInsights } from '../integration/facebook/insights.api'
import { normalizeForStorage } from '../utils/accountId'
import { upsertService } from '../services/facebook.upsert.service'
import { extractPurchaseValue } from '../utils/facebookPurchase'
import Campaign from '../models/Campaign'
import Ad from '../models/Ad'
import AdSet from '../models/AdSet'
import Creative from '../models/Creative'
import dayjs from 'dayjs'

// Worker 实例（延迟初始化）
let accountWorker: Worker | null = null
let campaignWorker: Worker | null = null
let adWorker: Worker | null = null

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

// 辅助函数：从 object_story_spec 中提取 image_hash
const extractImageHashFromSpec = (spec: any): string | undefined => {
  if (!spec) return undefined
  if (spec.link_data?.image_hash) return spec.link_data.image_hash
  if (spec.photo_data?.image_hash) return spec.photo_data.image_hash
  if (spec.video_data?.image_hash) return spec.video_data.image_hash
  return undefined
}

// 辅助函数：从 object_story_spec 中提取 video_id
const extractVideoIdFromSpec = (spec: any): string | undefined => {
  if (!spec) return undefined
  if (spec.video_data?.video_id) return spec.video_data.video_id
  if (spec.link_data?.video_id) return spec.link_data.video_id
  return undefined
}

// 初始化 Workers（延迟调用，确保 Redis 已连接）
export const initWorkers = () => {
  const client = getRedisClient()
  if (!client) {
    logger.warn('[Worker] Workers not initialized (Redis not configured)')
    return
  }

  // 创建 Worker 配置（使用 duplicate 创建新连接，并设置 BullMQ 必需的选项）
  const createWorkerOptions = (concurrency: number): WorkerOptions => {
    const connection = client.duplicate()
    // BullMQ 要求 maxRetriesPerRequest 为 null
    connection.options.maxRetriesPerRequest = null
    return {
      connection,
      concurrency,
      limiter: {
        max: 80,
        duration: 60000,
      },
    }
  }

  // 检查队列是否已初始化
  if (!accountQueue || !campaignQueue || !adQueue) {
    logger.warn('[Worker] Workers not initialized (Queues not available)')
    return
  }

  // ==================== 1. Account Sync Worker ====================
  accountWorker = new Worker(
    'facebook.account.sync',
    async (job) => {
      const { accountId, token } = job.data
      logger.info(`[AccountWorker] Processing account: ${accountId}`)

      try {
        const campaigns = await fetchCampaigns(accountId, token)
        logger.info(`[AccountWorker] Fetched ${campaigns.length} campaigns for account ${accountId}`)

        const jobs = []
        for (const camp of campaigns) {
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

          if (campaignQueue) {
            jobs.push(campaignQueue.add(
              'sync-campaign',
              { accountId, campaignId: camp.id, token },
              {
                jobId: `campaign-sync-${camp.id}-${dayjs().format('YYYY-MM-DD-HH')}`,
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
    createWorkerOptions(5)
  )

  // ==================== 2. Campaign Sync Worker ====================
  campaignWorker = new Worker(
    'facebook.campaign.sync',
    async (job) => {
      const { accountId, campaignId, token } = job.data

      try {
        const { facebookClient } = require('../integration/facebook/facebookClient')
        
        // 2.1 同步该 Campaign 下的 AdSets
        try {
          const adsetsRes = await facebookClient.get(`/${campaignId}/adsets`, {
            access_token: token,
            fields: 'id,name,status,optimization_goal,daily_budget,lifetime_budget,bid_amount,billing_event,targeting,created_time,updated_time',
            limit: 500,
          })
          const adsets = adsetsRes.data || []
          logger.info(`[CampaignWorker] Syncing ${adsets.length} adsets for campaign ${campaignId}`)
          
          for (const adset of adsets) {
            await AdSet.findOneAndUpdate(
              { adsetId: adset.id },
              {
                adsetId: adset.id,
                accountId: normalizeForStorage(accountId),
                campaignId: campaignId,
                channel: 'facebook',
                name: adset.name,
                status: adset.status,
                optimizationGoal: adset.optimization_goal,
                budget: adset.daily_budget ? parseInt(adset.daily_budget) : (adset.lifetime_budget ? parseInt(adset.lifetime_budget) : 0),
                created_time: adset.created_time,
                updated_time: adset.updated_time,
                raw: adset,
              },
              { upsert: true }
            )
          }
        } catch (adsetError: any) {
          logger.warn(`[CampaignWorker] Failed to sync adsets for campaign ${campaignId}: ${adsetError.message}`)
          // 不阻塞后续同步
        }
        
        // 2.2 同步该 Campaign 下的 Ads
        const res = await facebookClient.get(`/${campaignId}/ads`, {
          access_token: token,
          fields: 'id,name,status,adset_id,campaign_id,creative{id,name,status,image_hash,video_id,image_url,thumbnail_url,object_story_spec},created_time,updated_time',
          limit: 500,
        })
        const campaignAds = res.data || []

        const jobs = []
        for (const ad of campaignAds) {
          // 提取 creative 信息
          const creative = ad.creative || {}
          const creativeId = creative.id
          
          await Ad.findOneAndUpdate(
            { adId: ad.id },
            {
              adId: ad.id,
              adsetId: ad.adset_id,
              campaignId: ad.campaign_id,
              accountId: normalizeForStorage(accountId),
              name: ad.name,
              status: ad.status,
              creativeId: creativeId,
              raw: ad,
            },
            { upsert: true }
          )
          
          // 2.3 同步 Creative（如果存在）
          if (creativeId) {
            try {
              // 从 ad.creative 中提取素材标识
              const imageHash = creative.image_hash || extractImageHashFromSpec(creative.object_story_spec)
              const videoId = creative.video_id || extractVideoIdFromSpec(creative.object_story_spec)
              
              let creativeType = 'unknown'
              if (videoId) creativeType = 'video'
              else if (imageHash) creativeType = 'image'
              else if (creative.object_story_spec?.link_data?.child_attachments) creativeType = 'carousel'
              
              await Creative.findOneAndUpdate(
                { creativeId: creativeId },
                {
                  creativeId: creativeId,
                  channel: 'facebook',
                  accountId: normalizeForStorage(accountId),
                  name: creative.name,
                  status: creative.status,
                  type: creativeType,
                  imageHash: imageHash,
                  videoId: videoId,
                  hash: imageHash, // 兼容旧字段
                  imageUrl: creative.image_url,
                  thumbnailUrl: creative.thumbnail_url,
                  storageUrl: creative.image_url || creative.thumbnail_url,
                  raw: creative,
                },
                { upsert: true }
              )
            } catch (creativeError: any) {
              logger.warn(`[CampaignWorker] Failed to sync creative ${creativeId}: ${creativeError.message}`)
            }
          }

          if (adQueue) {
            jobs.push(adQueue.add(
              'sync-ad',
              {
                accountId,
                campaignId,
                adId: ad.id,
                adsetId: ad.adset_id,
                creativeId: creativeId,
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
    createWorkerOptions(10)
  )

  // ==================== 3. Ad Sync Worker ====================
  adWorker = new Worker(
    'facebook.ad.sync',
    async (job) => {
      const { accountId, campaignId, adId, adsetId, token } = job.data

      try {
        const datePresets = ['today', 'yesterday', 'last_3d', 'last_7d']
        
        const promises = datePresets.map(async (preset) => {
          const insights = await fetchInsights(adId, 'ad', preset, token, ['country'])
          
          if (!insights || insights.length === 0) return

          for (const insight of insights) {
            const country = insight.country || null
            const date = insight.date_start || dayjs().format('YYYY-MM-DD')
            
            let actualDate = date
            if (preset === 'yesterday') {
              actualDate = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
            } else if (preset === 'today') {
              actualDate = dayjs().format('YYYY-MM-DD')
            }

            // Hook Rate = video_3sec_views / impressions
            const actions = insight.actions || []
            const video3sAction = Array.isArray(actions) ? actions.find((a: any) => a.action_type === 'video_view' || a.action_type === 'video_3sec_views') : null
            const video3s = video3sAction ? parseFloat(video3sAction.value) : (insight.video_3sec_views || 0)
            const hookRate = insight.impressions > 0 ? video3s / insight.impressions : 0

            const purchaseValue = extractPurchaseValue(insight.action_values)
            const mobileAppInstall = getActionCount(insight.actions, 'mobile_app_install')

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
    createWorkerOptions(20)
  )

  // 设置错误处理
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

// 导出 workers（供其他模块使用）
export { accountWorker, campaignWorker, adWorker }
