import MetricsDaily from '../models/MetricsDaily'
import Campaign from '../models/Campaign'
import logger from '../utils/logger'
import dayjs from 'dayjs'
import { getWriteConnection } from '../config/db'
import { setToCache, getCacheKey, CACHE_TTL } from '../utils/cache'

/**
 * 预聚合常用日期范围的数据
 * 定期计算并缓存常用查询，减少实时查询压力
 */
export const preaggregateCampaignMetrics = async () => {
  const startTime = Date.now()
  logger.info('[Preaggregation] Starting campaign metrics preaggregation...')

  try {
    // 获取所有活跃的 campaignIds
    const campaigns = await Campaign.find({ status: { $in: ['ACTIVE', 'PAUSED'] } })
      .select('campaignId')
      .lean()
    
    const campaignIds = campaigns.map(c => c.campaignId)
    
    if (campaignIds.length === 0) {
      logger.info('[Preaggregation] No campaigns found, skipping preaggregation')
      return
    }

    logger.info(`[Preaggregation] Processing ${campaignIds.length} campaigns`)

    // 预聚合的日期范围配置
    const dateRanges = [
      {
        name: 'today',
        startDate: dayjs().format('YYYY-MM-DD'),
        endDate: dayjs().format('YYYY-MM-DD'),
        ttl: CACHE_TTL.TODAY,
      },
      {
        name: 'yesterday',
        startDate: dayjs().subtract(1, 'day').format('YYYY-MM-DD'),
        endDate: dayjs().subtract(1, 'day').format('YYYY-MM-DD'),
        ttl: CACHE_TTL.TODAY,
      },
      {
        name: 'last7days',
        startDate: dayjs().subtract(7, 'day').format('YYYY-MM-DD'),
        endDate: dayjs().format('YYYY-MM-DD'),
        ttl: CACHE_TTL.DATE_RANGE,
      },
      {
        name: 'last30days',
        startDate: dayjs().subtract(30, 'day').format('YYYY-MM-DD'),
        endDate: dayjs().format('YYYY-MM-DD'),
        ttl: CACHE_TTL.DATE_RANGE,
      },
    ]

    // 使用写连接进行聚合（预聚合是写操作）
    const writeConnection = getWriteConnection()
    const MetricsDailyWrite = writeConnection.model('MetricsDaily', MetricsDaily.schema)

    // 分批处理 campaignIds（每批 100 个）
    const BATCH_SIZE = 100
    let processedCount = 0

    for (const dateRange of dateRanges) {
      logger.info(`[Preaggregation] Processing date range: ${dateRange.name} (${dateRange.startDate} - ${dateRange.endDate})`)

      for (let i = 0; i < campaignIds.length; i += BATCH_SIZE) {
        const batchIds = campaignIds.slice(i, i + BATCH_SIZE)
        
        try {
          const dateQuery: any = {
            campaignId: { $in: batchIds },
          }

          if (dateRange.startDate === dateRange.endDate) {
            // 单日查询
            dateQuery.date = dateRange.startDate
            const metrics = await MetricsDailyWrite.find(dateQuery)
              .hint({ campaignId: 1, date: 1 })
              .lean()

            // 转换为聚合格式
            const metricsData = metrics.map((metric: any) => ({
              _id: metric.campaignId,
              spendUsd: metric.spendUsd || 0,
              impressions: metric.impressions || 0,
              clicks: metric.clicks || 0,
              cpc: metric.cpc,
              ctr: metric.ctr,
              cpm: metric.cpm,
              actions: metric.actions,
              action_values: metric.action_values,
              purchase_roas: metric.purchase_roas,
              raw: metric.raw,
            }))

            // 为每个 campaignId 生成缓存键并存储
            for (const campaignId of batchIds) {
              const cacheKey = getCacheKey('campaigns:metrics', {
                campaignIds: campaignId,
                startDate: dateRange.startDate,
                endDate: dateRange.endDate,
                page: 1,
                limit: 1,
              })
              const campaignMetrics = metricsData.find(m => m._id === campaignId)
              if (campaignMetrics) {
                await setToCache(cacheKey, [campaignMetrics], dateRange.ttl)
              }
            }
          } else {
            // 日期范围查询，使用聚合
            dateQuery.date = {
              $gte: dateRange.startDate,
              $lte: dateRange.endDate,
            }

            const metricsData = await MetricsDailyWrite.aggregate([
              { $match: dateQuery },
              { $sort: { date: -1 } },
              {
                $group: {
                  _id: '$campaignId',
                  spendUsd: { $sum: '$spendUsd' },
                  impressions: { $sum: '$impressions' },
                  clicks: { $sum: '$clicks' },
                  cpc: { $avg: '$cpc' },
                  ctr: { $avg: '$ctr' },
                  cpm: { $avg: '$cpm' },
                  actions: { $first: '$actions' },
                  action_values: { $first: '$action_values' },
                  purchase_roas: { $first: '$purchase_roas' },
                  raw: { $first: '$raw' },
                },
              },
            ])
              .hint({ campaignId: 1, date: 1 })
              .allowDiskUse(true)

            // 为每个 campaignId 生成缓存键并存储
            for (const campaignId of batchIds) {
              const cacheKey = getCacheKey('campaigns:metrics', {
                campaignIds: campaignId,
                startDate: dateRange.startDate,
                endDate: dateRange.endDate,
                page: 1,
                limit: 1,
              })
              const campaignMetrics = metricsData.find(m => m._id === campaignId)
              if (campaignMetrics) {
                await setToCache(cacheKey, [campaignMetrics], dateRange.ttl)
              }
            }
          }

          processedCount += batchIds.length
          logger.info(`[Preaggregation] Processed ${processedCount}/${campaignIds.length} campaigns for ${dateRange.name}`)
        } catch (error: any) {
          logger.error(`[Preaggregation] Error processing batch ${i}-${i + BATCH_SIZE}:`, error)
        }
      }
    }

    const duration = Date.now() - startTime
    logger.info(`[Preaggregation] Completed in ${duration}ms. Processed ${processedCount} campaigns across ${dateRanges.length} date ranges`)
  } catch (error: any) {
    logger.error('[Preaggregation] Failed:', error)
    throw error
  }
}

