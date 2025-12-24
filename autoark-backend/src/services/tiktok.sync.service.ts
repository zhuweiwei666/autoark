import * as tiktokApi from '../integration/tiktok/insights.api'
import { IFbToken } from '../models/FbToken'
import { ITiktokToken } from '../models/TiktokToken'
import { Campaign, AdSet, Ad, MetricsDaily, SyncLog, Creative, TiktokToken } from '../models'
import logger from '../utils/logger'
import { normalizeForStorage } from '../utils/accountId'
import dayjs from 'dayjs'

/**
 * TikTok 资产同步服务
 */

// 1. 获取所有活跃的 TikTok Advertiser IDs
export const getEffectiveTiktokAdvertisers = async (): Promise<Array<{ advertiserId: string, token: string, userId: string }>> => {
  const tokens = await TiktokToken.find({ status: 'active' }).lean()
  const effectiveAdvertisers: Array<{ advertiserId: string, token: string, userId: string }> = []

  for (const tokenDoc of tokens) {
    for (const advId of tokenDoc.advertiserIds) {
      effectiveAdvertisers.push({
        advertiserId: advId,
        token: tokenDoc.accessToken,
        userId: tokenDoc.userId
      })
    }
  }

  return effectiveAdvertisers
}

// 2. 通用 Mongo 写入器
const writeToMongo = async (model: any, filter: any, data: any) => {
  try {
    await model.findOneAndUpdate(filter, data, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    })
  } catch (error) {
    logger.error(`[TikTokSync] Mongo Write Error: ${(error as Error).message}`)
  }
}

// 3. 同步单个广告主的所有资产
export const syncTiktokAdvertiser = async (advertiserId: string, token: string) => {
  logger.info(`[TikTokSync] Syncing Advertiser: ${advertiserId}`)
  
  const today = dayjs().format('YYYY-MM-DD')

  // 1. 同步报表 (Hourly)
  try {
    const insightsData = await tiktokApi.fetchTiktokInsights(
      advertiserId,
      'AUCTION_AD',
      'BASIC',
      {
        start_date: today,
        end_date: today,
        time_granularity: 'STAT_TIME_GRANULARITY_HOURLY',
        dimensions: ['stat_time_hour', 'ad_id']
      },
      token
    )

    const list = insightsData.list || []
    logger.info(`[TikTokSync] Found ${list.length} hourly insight records for ${advertiserId}`)

    for (const i of list) {
      const spend = parseFloat(i.metrics?.spend || '0')
      if (spend <= 0) continue

      const impressions = parseInt(i.metrics?.impressions || '0')
      const clicks = parseInt(i.metrics?.clicks || '0')
      const conversions = parseInt(i.metrics?.conversions || '0')
      const purchaseValue = parseFloat(i.metrics?.purchase || '0')
      
      // TikTok 特有指标
      const video2s = parseInt(i.metrics?.video_watched_2s || '0')
      const atc = parseInt(i.metrics?.add_to_cart || '0')

      const date = i.dimensions?.stat_time_hour?.split(' ')[0] || today
      const hour = i.dimensions?.stat_time_hour?.split(' ')[1] || '00'

      await writeToMongo(
        MetricsDaily,
        {
          date,
          level: 'ad',
          entityId: i.dimensions?.ad_id,
          channel: 'tiktok',
          // 使用 hour 作为一个区分标记，或者直接存入每日聚合，
          // 因为现有 MetricsDaily 是按天存的。
          // 这里的策略是更新当天的每日汇总。
        },
        {
          date,
          channel: 'tiktok',
          accountId: advertiserId,
          adId: i.dimensions?.ad_id,
          level: 'ad',
          entityId: i.dimensions?.ad_id,
          impressions,
          clicks,
          spendUsd: spend,
          conversions,
          purchase_value: purchaseValue,
          // 存入原始数据供后续提取 hookRate/atcRate
          raw: i,
          updatedAt: new Date()
        }
      )
    }
  } catch (err) {
    logger.error(`[TikTokSync] Failed to sync insights for ${advertiserId}`, err)
  }
}

// 4. 全量同步执行器
export const runTiktokFullSync = async () => {
  const startTime = new Date()
  logger.info('[TikTokSync] Starting Full TikTok Sync...')

  let syncLog: any
  try {
    syncLog = new SyncLog({ startTime, status: 'RUNNING', channel: 'tiktok' })
    await syncLog.save()

    const advertisers = await getEffectiveTiktokAdvertisers()
    logger.info(`[TikTokSync] Syncing ${advertisers.length} advertisers`)

    for (const adv of advertisers) {
      await syncTiktokAdvertiser(adv.advertiserId, adv.token)
    }

    syncLog.endTime = new Date()
    syncLog.status = 'SUCCESS'
    syncLog.details = { advertisersSynced: advertisers.length }
    await syncLog.save()
    logger.info('[TikTokSync] Full TikTok Sync Completed Successfully.')
  } catch (error) {
    const msg = (error as Error).message
    logger.error(`[TikTokSync] Full TikTok Sync Failed: ${msg}`)
    if (syncLog) {
      syncLog.endTime = new Date()
      syncLog.status = 'FAILED'
      syncLog.error = msg
      await syncLog.save()
    }
  }
}
