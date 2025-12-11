/**
 * 📊 预聚合数据定时刷新
 * 
 * - 服务启动时立即刷新一次
 * - 每 10 分钟刷新最近 3 天的数据
 */

import cron from 'node-cron'
import logger from '../utils/logger'
import { refreshRecentDays } from '../services/aggregation.service'

export function initAggregationCron() {
  // 🚀 服务启动时立即刷新一次（异步，不阻塞启动）
  setTimeout(async () => {
    logger.info('[AggregationCron] Starting initial refresh...')
    try {
      await refreshRecentDays()
      logger.info('[AggregationCron] Initial refresh completed')
    } catch (error: any) {
      logger.error('[AggregationCron] Initial refresh failed:', error.message)
    }
  }, 5000)  // 延迟5秒启动，等待数据库连接稳定

  // 每 10 分钟刷新一次
  cron.schedule('*/10 * * * *', async () => {
    logger.info('[AggregationCron] Starting scheduled refresh...')
    try {
      await refreshRecentDays()
      logger.info('[AggregationCron] Scheduled refresh completed')
    } catch (error: any) {
      logger.error('[AggregationCron] Scheduled refresh failed:', error.message)
    }
  })

  logger.info('[AggregationCron] Aggregation cron initialized (runs every 10 minutes)')
}

export default initAggregationCron
