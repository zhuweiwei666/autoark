import cron from 'node-cron'
import { preaggregateCampaignMetrics } from '../services/preaggregation.service'
import logger from '../utils/logger'

/**
 * 初始化预聚合定时任务
 * - 每小时执行一次预聚合（在每小时的第 5 分钟执行，避免与其他任务冲突）
 * - 每天凌晨 2 点执行一次完整预聚合
 */
const initPreaggregationCron = () => {
  // 每小时的第 5 分钟执行预聚合（更新今天的数据）
  cron.schedule('5 * * * *', async () => {
    const startTime = Date.now()
    logger.info('[Preaggregation Cron] Starting hourly preaggregation...')
    
    try {
      await preaggregateCampaignMetrics()
      const duration = Date.now() - startTime
      logger.info(`[Preaggregation Cron] Hourly preaggregation completed in ${duration}ms`)
    } catch (error) {
      const duration = Date.now() - startTime
      logger.error(`[Preaggregation Cron] Hourly preaggregation failed after ${duration}ms:`, error)
    }
  })

  // 每天凌晨 2 点执行完整预聚合（更新所有日期范围）
  cron.schedule('0 2 * * *', async () => {
    const startTime = Date.now()
    logger.info('[Preaggregation Cron] Starting daily full preaggregation...')
    
    try {
      await preaggregateCampaignMetrics()
      const duration = Date.now() - startTime
      logger.info(`[Preaggregation Cron] Daily full preaggregation completed in ${duration}ms`)
    } catch (error) {
      const duration = Date.now() - startTime
      logger.error(`[Preaggregation Cron] Daily full preaggregation failed after ${duration}ms:`, error)
    }
  })

  logger.info('[Preaggregation Cron] Preaggregation cron jobs initialized')
}

export default initPreaggregationCron

