import { Worker, WorkerOptions } from 'bullmq'
import { getRedisConnection, getRedisClient } from '../config/redis'
import logger from '../utils/logger'
import { adFetchQueue, insightsQueue, accountSyncQueue } from './facebook.queue'
import * as facebookSyncService from '../services/facebook.sync.service'
import * as facebookApiService from '../services/facebook.api'
import * as facebookCampaignsService from '../services/facebook.campaigns.service'
import Account from '../models/Account'
import Campaign from '../models/Campaign'
import Ad from '../models/Ad'
import MetricsDaily from '../models/MetricsDaily'
import { normalizeForApi, normalizeForStorage } from '../utils/accountId'
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

// Worker 配置（仅在 Redis 可用时创建）
let workerOptions: WorkerOptions | null = null
if (isRedisAvailable()) {
  try {
    workerOptions = {
      connection: getRedisConnection(),
      concurrency: 30, // 并发处理30个任务（可根据实际情况调整10-50）
      limiter: {
        max: 100, // 每秒最多100个任务
        duration: 1000,
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
  return action ? parseInt(action.value) : undefined
}

// ==================== 账户同步 Worker ====================
export const accountSyncWorker = (accountSyncQueue && workerOptions) ? new Worker(
  'account-sync',
  async (job) => {
    const { accountId, token } = job.data
    logger.info(`[Worker] Processing account sync: ${accountId}`)

    try {
      // 1. 抓取 Campaigns（只抓基础字段）
      const accountIdForApi = normalizeForApi(accountId)
      const campaigns = await facebookApiService.fetchCampaigns(accountIdForApi, token)
      logger.info(`[Worker] Found ${campaigns.length} campaigns for account ${accountId}`)

      // 2. 保存 Campaigns
      for (const camp of campaigns) {
        const campaignData = {
          campaignId: camp.id,
          accountId: normalizeForStorage(accountId),
          channel: 'facebook',
          name: camp.name,
          status: camp.status,
          objective: camp.objective,
          buying_type: camp.buying_type,
          daily_budget: camp.daily_budget,
          budget_remaining: camp.budget_remaining,
          created_time: camp.created_time ? new Date(camp.created_time) : undefined,
          updated_time: camp.updated_time ? new Date(camp.updated_time) : undefined,
          raw: camp,
        }

        await Campaign.findOneAndUpdate(
          { campaignId: campaignData.campaignId },
          campaignData,
          { upsert: true, new: true }
        )
      }

      // 3. 为每个 Campaign 推送广告抓取任务
      for (const camp of campaigns) {
        await adFetchQueue.add(
          'fetch-ads-for-campaign',
          {
            campaignId: camp.id,
            accountId: normalizeForStorage(accountId),
            token,
          },
          {
            priority: 1,
          }
        )
      }

      return { success: true, campaignsCount: campaigns.length }
    } catch (error: any) {
      logger.error(`[Worker] Account sync failed for ${accountId}:`, error)
      throw error
    }
  },
  workerOptions!
) : null

// ==================== 广告抓取 Worker ====================
export const adFetchWorker = (adFetchQueue && workerOptions) ? new Worker(
  'ad-fetch',
  async (job) => {
    const { campaignId, accountId, token } = job.data
    logger.info(`[Worker] Processing ad fetch for campaign: ${campaignId}`)

    try {
      const accountIdForApi = normalizeForApi(accountId)

      // 1. 抓取该 Campaign 下的所有 Ads
      const ads = await facebookApiService.fetchAds(accountIdForApi, token)
      const campaignAds = ads.filter((ad: any) => ad.campaign_id === campaignId)
      logger.info(`[Worker] Found ${campaignAds.length} ads for campaign ${campaignId}`)

      // 2. 保存 Ads
      for (const ad of campaignAds) {
        const adData = {
          adId: ad.id,
          adsetId: ad.adset_id,
          campaignId: ad.campaign_id,
          accountId: normalizeForStorage(accountId),
          channel: 'facebook',
          name: ad.name,
          status: ad.status,
          creativeId: ad.creative?.id,
          created_time: ad.created_time ? new Date(ad.created_time) : undefined,
          updated_time: ad.updated_time ? new Date(ad.updated_time) : undefined,
          raw: ad,
        }

        await Ad.findOneAndUpdate({ adId: adData.adId }, adData, { upsert: true, new: true })
      }

      // 3. 为每个 Ad 推送 Insights 抓取任务（多个 date_preset）
      const datePresets = ['yesterday', 'today', 'last_3d', 'last_7d']
      for (const ad of campaignAds) {
        for (const datePreset of datePresets) {
          await insightsQueue.add(
            'fetch-ad-insights',
            {
              adId: ad.id,
              campaignId: ad.campaign_id,
              adsetId: ad.adset_id,
              accountId: normalizeForStorage(accountId),
              token,
              datePreset,
              level: 'ad', // 关键：使用 ad 级别而不是 campaign 级别
            },
            {
              priority: datePreset === 'yesterday' ? 3 : datePreset === 'today' ? 2 : 1, // yesterday 优先级最高
            }
          )
        }
      }

      return { success: true, adsCount: campaignAds.length }
    } catch (error: any) {
      logger.error(`[Worker] Ad fetch failed for campaign ${campaignId}:`, error)
      throw error
    }
  },
  workerOptions!
) : null

// ==================== Insights 抓取 Worker ====================
export const insightsWorker = (insightsQueue && workerOptions) ? new Worker(
  'insights-fetch',
  async (job) => {
    const { adId, campaignId, adsetId, accountId, token, datePreset, level } = job.data
    logger.info(`[Worker] Processing insights fetch: ${level} ${adId || campaignId}, datePreset: ${datePreset}`)

    try {
      // 抓取 Insights（使用 ad 级别）
      const insights = await facebookApiService.fetchInsights(
        adId || campaignId,
        level || 'ad',
        datePreset,
        token,
        ['country'] // 按国家分组
      )

      if (!insights || insights.length === 0) {
        logger.warn(`[Worker] No insights found for ${level} ${adId || campaignId}, datePreset: ${datePreset}`)
        return { success: true, insightsCount: 0 }
      }

      // 保存 Insights 数据
      let savedCount = 0
      for (const insight of insights) {
        const country = insight.country || null
        const date = insight.date_start || dayjs().format('YYYY-MM-DD')

        // 根据 datePreset 确定实际日期
        let actualDate = date
        if (datePreset === 'yesterday') {
          actualDate = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
        } else if (datePreset === 'today') {
          actualDate = dayjs().format('YYYY-MM-DD')
        } else if (datePreset === 'last_3d' || datePreset === 'last_7d') {
          // 对于范围查询，使用 date_start
          actualDate = date
        }

        const metricsData: any = {
          date: actualDate,
          channel: 'facebook',
          accountId: normalizeForStorage(accountId),
          campaignId: campaignId,
          adsetId: adsetId,
          adId: adId, // 关键：保存 adId
          country: country,
          impressions: insight.impressions || 0,
          clicks: insight.clicks || 0,
          spendUsd: parseFloat(insight.spend || '0'),
          cpc: insight.cpc ? parseFloat(insight.cpc) : undefined,
          ctr: insight.ctr ? parseFloat(insight.ctr) : undefined,
          cpm: insight.cpm ? parseFloat(insight.cpm) : undefined,
          actions: insight.actions,
          action_values: insight.action_values,
          purchase_roas: insight.purchase_roas ? parseFloat(insight.purchase_roas) : undefined,
          purchase_value: getActionValue(insight.action_values, 'purchase'),
          mobile_app_install_count: getActionCount(insight.actions, 'mobile_app_install'),
          raw: insight,
        }

        // 保存到 MetricsDaily（使用 adId + date + country 作为唯一键）
        // 注意：这是 Ad 级别的数据，后续会通过聚合服务向上聚合
        await MetricsDaily.findOneAndUpdate(
          { adId: metricsData.adId, date: metricsData.date, country: country || null },
          { 
            $set: metricsData,
            $unset: { adsetId: '', campaignId: '' } // 确保是 Ad 级别数据
          },
          { upsert: true, new: true }
        )
        savedCount++
      }

      return { success: true, insightsCount: savedCount }
    } catch (error: any) {
      logger.error(`[Worker] Insights fetch failed for ${level} ${adId || campaignId}:`, error)
      throw error
    }
  },
  workerOptions!
) : null

// 初始化所有 Workers
export const initWorkers = () => {
  if (!accountSyncWorker || !adFetchWorker || !insightsWorker) {
    logger.warn('[Worker] Workers not available, Redis may not be configured. Queue features will be disabled.')
    return
  }

  accountSyncWorker.on('completed', (job) => {
    logger.info(`[Worker] Account sync job ${job.id} completed`)
  })

  accountSyncWorker.on('failed', (job, err) => {
    logger.error(`[Worker] Account sync job ${job?.id} failed:`, err)
  })

  adFetchWorker.on('completed', (job) => {
    logger.info(`[Worker] Ad fetch job ${job.id} completed`)
  })

  adFetchWorker.on('failed', (job, err) => {
    logger.error(`[Worker] Ad fetch job ${job?.id} failed:`, err)
  })

  insightsWorker.on('completed', (job) => {
    logger.info(`[Worker] Insights job ${job.id} completed`)
  })

  insightsWorker.on('failed', (job, err) => {
    logger.error(`[Worker] Insights job ${job?.id} failed:`, err)
  })

  logger.info('[Worker] Facebook workers initialized')
}

