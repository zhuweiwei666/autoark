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
  // 每小时的第 30 分钟执行 (避免与其他整点任务冲突)
  cronJob = cron.schedule('30 * * * *', async () => {
    logger.info('[MaterialMetricsCron] Starting hourly material metrics aggregation')
    
    try {
      const today = dayjs().format('YYYY-MM-DD')
      const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
      
      // 1. 聚合昨天的数据 (确保最终数据一致性)
      const yesterdayResult = await aggregateMaterialMetrics(yesterday)
      await aggregateMetricsToMaterials(yesterday)
      logger.info(`[MaterialMetricsCron] Aggregated yesterday (${yesterday})`)
      
      // 2. 聚合今天的数据 (实时更新)
      const todayResult = await aggregateMaterialMetrics(today)
      await aggregateMetricsToMaterials(today)
      logger.info(`[MaterialMetricsCron] Aggregated today (${today})`)
      
    } catch (error) {
      logger.error('[MaterialMetricsCron] Hourly aggregation failed:', error)
    }
  }, {
    timezone: 'Asia/Shanghai'
  })
  
  logger.info('[MaterialMetricsCron] Material metrics cron initialized (runs hourly at :30)')
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

