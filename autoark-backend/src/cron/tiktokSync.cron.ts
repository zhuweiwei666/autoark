import cron from 'node-cron'
import logger from '../utils/logger'
import { runTiktokFullSync } from '../services/tiktok.sync.service'

/**
 * TikTok 资产同步定时任务 (Hourly)
 */
export const initTiktokSyncCron = () => {
  // 每小时执行一次同步
  cron.schedule('0 * * * *', async () => {
    try {
      logger.info('[TiktokSyncCron] Starting scheduled sync')
      await runTiktokFullSync()
    } catch (error: any) {
      logger.error('[TiktokSyncCron] Scheduled sync failed:', error.message)
    }
  })

  // 启动时立即执行一次同步
  runTiktokFullSync().catch(err => {
    logger.error('[TiktokSyncCron] Initial sync failed:', err.message)
  })
}
