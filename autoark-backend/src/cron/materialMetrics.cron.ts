import cron from 'node-cron'
import dayjs from 'dayjs'
import logger from '../utils/logger'
import { aggregateMaterialMetrics } from '../services/materialMetrics.service'

/**
 * 素材指标聚合定时任务
 * 每天凌晨 4:00 运行，聚合前一天的数据
 * 也可以手动触发聚合
 */

let cronJob: cron.ScheduledTask | null = null

export const initMaterialMetricsCron = () => {
  // 每天凌晨 4:00 执行
  cronJob = cron.schedule('0 4 * * *', async () => {
    logger.info('[MaterialMetricsCron] Starting daily material metrics aggregation')
    
    try {
      // 聚合昨天的数据
      const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
      const result = await aggregateMaterialMetrics(yesterday)
      
      logger.info(`[MaterialMetricsCron] Aggregation complete for ${yesterday}:`, result)
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

