import cron from 'node-cron'
import * as aggregationService from '../services/facebook.aggregation.service'
import * as purchaseCorrectionService from '../services/facebook.purchase.correction'
import logger from '../utils/logger'
import dayjs from 'dayjs'

/**
 * 数据聚合定时任务
 * 将 Ad 级别的数据向上聚合为 AdSet → Campaign → Account 级别
 */
const initAggregationCron = () => {
  // 每小时的第 10 分钟执行聚合（避免与其他任务冲突）
  cron.schedule('10 * * * *', async () => {
    const startTime = Date.now()
    const today = dayjs().format('YYYY-MM-DD')
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
    
    logger.info('[Aggregation Cron] Starting metrics aggregation...')

    try {
      // 聚合今天和昨天的数据
      await Promise.all([
        aggregationService.aggregateMetricsByLevel(today),
        aggregationService.aggregateMetricsByLevel(yesterday),
      ])
      
      const duration = Date.now() - startTime
      logger.info(`[Aggregation Cron] Metrics aggregation completed in ${duration}ms`)
    } catch (error) {
      const duration = Date.now() - startTime
      logger.error(`[Aggregation Cron] Metrics aggregation failed after ${duration}ms:`, error)
    }
  })

  // 每天凌晨 3 点执行 Purchase 值修正（在数据聚合之后）
  cron.schedule('0 3 * * *', async () => {
    const startTime = Date.now()
    const today = dayjs().format('YYYY-MM-DD')
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
    const last7dStart = dayjs().subtract(7, 'day').format('YYYY-MM-DD')
    
    logger.info('[Purchase Correction Cron] Starting purchase value correction...')

    try {
      // 修正最近 7 天的数据
      await purchaseCorrectionService.correctPurchaseValuesForDateRange(last7dStart, today)
      
      const duration = Date.now() - startTime
      logger.info(`[Purchase Correction Cron] Purchase correction completed in ${duration}ms`)
    } catch (error) {
      const duration = Date.now() - startTime
      logger.error(`[Purchase Correction Cron] Purchase correction failed after ${duration}ms:`, error)
    }
  })

  logger.info('[Aggregation Cron] Aggregation cron job initialized (runs at :10 every hour)')
  logger.info('[Purchase Correction Cron] Purchase correction cron job initialized (runs at 3:00 AM daily)')
}

export default initAggregationCron

