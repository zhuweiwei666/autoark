import cron from 'node-cron'
import logger from '../utils/logger'
import { syncAccountsFromTokens } from '../services/facebook.accounts.service'
import { runPendingAccountInsightsBackfill } from '../services/accountInsightsBackfill.service'
import { runPendingTokenInsightsBackfill } from '../services/tokenInsightsBackfill.service'

const syncAccountsAndBackfill = async (label: string) => {
  const result = await syncAccountsFromTokens()
  logger.info(
    `[AccountSyncCron] ${label} sync completed. `
      + `Synced: ${result.syncedCount}, Errors: ${result.errorCount}`,
  )
  const backfill = await runPendingAccountInsightsBackfill()
  logger.info(
    `[AccountSyncCron] ${label} finalization backfill completed. `
      + `Attempted: ${backfill.attemptedAccounts}, `
      + `Completed: ${backfill.completedAccounts}, Pending: ${backfill.pendingAccounts}`,
  )
  const tokenBackfill = await runPendingTokenInsightsBackfill()
  logger.info(
    `[AccountSyncCron] ${label} authorization backfill completed. `
      + `Attempted tokens: ${tokenBackfill.attemptedTokens}, `
      + `accounts: ${tokenBackfill.attemptedAccounts}, `
      + `completed: ${tokenBackfill.completedTokens}, pending: ${tokenBackfill.pendingTokens}`,
  )
}

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
      await syncAccountsAndBackfill('Scheduled')
    } catch (error: any) {
      logger.error('[AccountSyncCron] Sync failed:', error.message)
    }
  })
  
  // 启动时立即执行一次同步（延迟 30 秒，等待数据库连接稳定）
  setTimeout(async () => {
    logger.info('[AccountSyncCron] Running initial account sync...')
    try {
      await syncAccountsAndBackfill('Initial')
    } catch (error: any) {
      logger.error('[AccountSyncCron] Initial sync failed:', error.message)
    }
  }, 30000)
  
  logger.info('[AccountSyncCron] Account sync cron initialized (hourly + on startup)')
}

export default { initAccountSyncCron }
