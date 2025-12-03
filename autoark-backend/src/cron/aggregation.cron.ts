import cron from 'node-cron'
import * as aggregationService from '../services/facebook.aggregation.service'
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

  logger.info('[Aggregation Cron] Aggregation cron job initialized (runs at :10 every hour)')
}

export default initAggregationCron

