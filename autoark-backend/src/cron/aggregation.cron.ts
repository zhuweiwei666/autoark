/**
 * 📊 预聚合数据定时刷新
 *
 * - 服务启动时刷新今天一次
 * - 每 10 分钟刷新今天的数据
 * - 上一轮未结束时跳过，避免重叠放大 Meta 请求
 */

import cron from 'node-cron'
import dayjs from 'dayjs'
import logger from '../utils/logger'
import { isFacebookAggregationEnabled } from '../config/facebookSync'
import { refreshAggregation } from '../services/aggregation.service'

export function initAggregationCron() {
  if (!isFacebookAggregationEnabled()) {
    logger.warn(
      '[AggregationCron] Meta aggregation disabled; cron not scheduled',
    )
    return
  }

  let refreshInFlight = false
  const runRefresh = async (trigger: 'initial' | 'scheduled') => {
    if (refreshInFlight) {
      logger.warn(
        `[AggregationCron] Refresh already in progress; skipping ${trigger} refresh`,
      )
      return
    }

    refreshInFlight = true
    const date = dayjs().format('YYYY-MM-DD')
    logger.info(`[AggregationCron] Starting ${trigger} refresh for ${date}...`)
    try {
      await refreshAggregation(date)
      logger.info(`[AggregationCron] ${trigger} refresh for ${date} completed`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(
        `[AggregationCron] ${trigger} refresh for ${date} failed:`,
        message,
      )
    } finally {
      refreshInFlight = false
    }
  }

  // 🚀 服务启动时立即刷新一次（异步，不阻塞启动）
  setTimeout(() => runRefresh('initial'), 5000)

  // 每 10 分钟刷新一次
  cron.schedule('*/10 * * * *', () => runRefresh('scheduled'))

  logger.info(
    '[AggregationCron] Meta aggregation initialized (today only, every 10 minutes)',
  )
}

export default initAggregationCron
