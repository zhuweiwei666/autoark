import cron from 'node-cron'
import { SCHEDULES } from './schedule'
import fetchFacebookMetrics from './fetchFacebookMetrics'
import { runRulesDaily } from '../rules'
import { runAiOptimizerDaily } from '../ai'
import logger from '../utils/logger'

const initCronJobs = () => {
  // Facebook Data Sync (Hourly)
  cron.schedule(SCHEDULES.FETCH_FB_HOURLY, () => {
    fetchFacebookMetrics().catch((err) =>
      logger.error('Unhandled error in Facebook fetch cron', err),
    )
  })

  // Rule Engine (Daily at 1 AM)
  cron.schedule('0 1 * * *', () => {
    runRulesDaily().catch((err) =>
      logger.error('Unhandled error in Rule Engine cron', err),
    )
  })

  // AI Optimizer (Daily at 3 AM)
  cron.schedule('0 3 * * *', () => {
    runAiOptimizerDaily().catch((err) =>
      logger.error('Unhandled error in AI Optimizer cron', err),
    )
  })

  logger.info('Cron jobs initialized')
}

export default initCronJobs
