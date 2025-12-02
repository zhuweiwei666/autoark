import cron from 'node-cron'
import { checkAllTokensStatus } from '../services/fbToken.validation.service'
import logger from '../utils/logger'

/**
 * 每小时检查一次所有 token 的状态
 * Cron 表达式：0 * * * * (每小时的第 0 分钟执行)
 */
export default function initTokenValidationCron() {
  const schedule = '0 * * * *' // 每小时执行一次

  cron.schedule(schedule, async () => {
    logger.info('[Cron] Starting scheduled token validation...')
    try {
      await checkAllTokensStatus()
      logger.info('[Cron] Token validation completed')
    } catch (error: any) {
      logger.error('[Cron] Token validation failed:', error)
    }
  })

  logger.info(
    `[Cron] Token validation cron initialized with schedule: ${schedule}`,
  )
}

