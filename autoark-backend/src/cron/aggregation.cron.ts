/**
 * 📊 预聚合数据定时刷新
 * 
 * 每 10 分钟刷新最近 3 天的数据
 */

import cron from 'node-cron'
import logger from '../utils/logger'
import { refreshRecentDays } from '../services/aggregation.service'

export function initAggregationCron() {
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
