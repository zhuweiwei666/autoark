import cron, { ScheduledTask } from 'node-cron'
import dayjs from 'dayjs'
import logger from '../utils/logger'
import { aggregateMaterialMetrics } from '../services/materialMetrics.service'
import { aggregateMetricsToMaterials } from '../services/materialTracking.service'

/**
 * 素材指标聚合定时任务
 * 每天凌晨 4:00 运行：
 * 1. 聚合 Facebook 指标到 MaterialMetrics（按素材维度）
 * 2. 将 MaterialMetrics 数据归因到 Material 素材库（全链路追踪）
 */

let cronJob: ScheduledTask | null = null

export const initMaterialMetricsCron = () => {
  // 每天凌晨 4:00 执行
  cronJob = cron.schedule('0 4 * * *', async () => {
    logger.info('[MaterialMetricsCron] Starting daily material metrics aggregation')
    
    try {
      const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
      
      // 1. 聚合 Facebook 指标到 MaterialMetrics
      const metricsResult = await aggregateMaterialMetrics(yesterday)
      logger.info(`[MaterialMetricsCron] MaterialMetrics aggregation for ${yesterday}:`, metricsResult)
      
      // 2. 将指标归因到素材库（Material 表）
      const attributionResult = await aggregateMetricsToMaterials(yesterday)
      logger.info(`[MaterialMetricsCron] Material attribution for ${yesterday}:`, attributionResult)
      
    } catch (error) {
      logger.error('[MaterialMetricsCron] Daily aggregation failed:', error)
    }
  }, {
    timezone: 'Asia/Shanghai'
  })
  
  logger.info('[MaterialMetricsCron] Material metrics cron initialized (runs at 4:00 AM daily)')
}

export const stopMaterialMetricsCron = () => {
  if (cronJob) {
    cronJob.stop()
    cronJob = null
    logger.info('[MaterialMetricsCron] Cron job stopped')
  }
}

// 手动触发聚合（用于补数据或测试）
export const runManualAggregation = async (date?: string) => {
  const targetDate = date || dayjs().format('YYYY-MM-DD')
  logger.info(`[MaterialMetricsCron] Manual aggregation triggered for ${targetDate}`)
  return aggregateMaterialMetrics(targetDate)
}

// 批量补数据
export const backfillMaterialMetrics = async (startDate: string, endDate: string) => {
  logger.info(`[MaterialMetricsCron] Backfilling material metrics from ${startDate} to ${endDate}`)
  
  const results: Array<{ date: string; result: any }> = []
  let currentDate = dayjs(startDate)
  const end = dayjs(endDate)
  
  while (currentDate.isBefore(end) || currentDate.isSame(end, 'day')) {
    const dateStr = currentDate.format('YYYY-MM-DD')
    try {
      const result = await aggregateMaterialMetrics(dateStr)
      results.push({ date: dateStr, result })
      logger.info(`[MaterialMetricsCron] Backfill complete for ${dateStr}`)
    } catch (error) {
      logger.error(`[MaterialMetricsCron] Backfill failed for ${dateStr}:`, error)
      results.push({ date: dateStr, result: { error: String(error) } })
    }
    currentDate = currentDate.add(1, 'day')
  }
  
  return results
}

