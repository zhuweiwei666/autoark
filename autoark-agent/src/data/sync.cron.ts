import cron from 'node-cron'
import { log } from '../platform/logger'
import { syncAllMetrics } from './sync.service'

export function initSyncCron() {
  // 每 10 分钟同步最近 3 天的数据
  cron.schedule('*/10 * * * *', async () => {
    try {
      await syncAllMetrics(3)
    } catch (err: any) {
      log.error('[SyncCron] Failed:', err.message)
    }
  })

  // 启动 30 秒后立即同步一次
  setTimeout(() => syncAllMetrics(3).catch(() => {}), 30000)

  log.info('[SyncCron] Initialized (every 10 minutes)')
}
