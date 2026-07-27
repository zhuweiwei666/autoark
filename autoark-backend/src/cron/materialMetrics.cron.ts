import cron from 'node-cron'
import dayjs from 'dayjs'
import logger from '../utils/logger'
import { aggregateMaterialMetrics } from '../services/materialMetrics.service'

let aggregationRunning = false

export const refreshRecentMaterialMetrics = async (dayCount = 2) => {
  if (aggregationRunning) {
    logger.info('[MaterialMetricsCron] Skipping overlapping refresh')
    return
  }

  aggregationRunning = true
  try {
    for (let daysAgo = Math.max(1, dayCount) - 1; daysAgo >= 0; daysAgo--) {
      const date = dayjs().subtract(daysAgo, 'day').format('YYYY-MM-DD')
      const result = await aggregateMaterialMetrics(date)
      logger.info('[MaterialMetricsCron] Refreshed material metrics', { date, ...result })
    }
  } finally {
    aggregationRunning = false
  }
}

export const initMaterialMetricsCron = () => {
  setTimeout(() => {
    void refreshRecentMaterialMetrics(7).catch((error: any) => {
      logger.error('[MaterialMetricsCron] Initial refresh failed:', error.message)
    })
  }, 15000)

  cron.schedule('15 * * * *', () => {
    void refreshRecentMaterialMetrics().catch((error: any) => {
      logger.error('[MaterialMetricsCron] Scheduled refresh failed:', error.message)
    })
  })

  logger.info('[MaterialMetricsCron] Material metrics cron initialized (runs hourly)')
}

export default initMaterialMetricsCron
