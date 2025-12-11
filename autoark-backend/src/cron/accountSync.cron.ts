import cron from 'node-cron'
import logger from '../utils/logger'
import { syncAccountsFromTokens } from '../services/facebook.accounts.service'

/**
 * 📊 账户同步定时任务
 * 
 * - 每小时同步一次所有 token 下的广告账户
 * - 启动时立即执行一次同步
 */

export function initAccountSyncCron() {
  // 每小时整点同步账户
  cron.schedule('0 * * * *', async () => {
    logger.info('[AccountSyncCron] Starting scheduled account sync...')
    try {
      const result = await syncAccountsFromTokens()
      logger.info(`[AccountSyncCron] Sync completed. Synced: ${result.syncedCount}, Errors: ${result.errorCount}`)
    } catch (error: any) {
      logger.error('[AccountSyncCron] Sync failed:', error.message)
    }
  })
  
  // 启动时立即执行一次同步（延迟 30 秒，等待数据库连接稳定）
  setTimeout(async () => {
    logger.info('[AccountSyncCron] Running initial account sync...')
    try {
      const result = await syncAccountsFromTokens()
      logger.info(`[AccountSyncCron] Initial sync completed. Synced: ${result.syncedCount}, Errors: ${result.errorCount}`)
    } catch (error: any) {
      logger.error('[AccountSyncCron] Initial sync failed:', error.message)
    }
  }, 30000)
  
  logger.info('[AccountSyncCron] Account sync cron initialized (hourly + on startup)')
}

export default { initAccountSyncCron }
