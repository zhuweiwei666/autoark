import cron from 'node-cron'
import * as fbSyncService from '../services/facebook.sync.service'
import logger from '../utils/logger'

const initSyncCron = () => {
  const interval = process.env.CRON_SYNC_INTERVAL || '10' // Default 10 mins
  const schedule = `*/${interval} * * * *`

  logger.info(`Initializing Facebook Sync Cron with schedule: ${schedule}`)

  cron.schedule(schedule, async () => {
    const startTime = Date.now()
    logger.cron(`[Sync] Triggering Full Facebook Sync`)

    try {
      await fbSyncService.runFullSync()
      const duration = Date.now() - startTime
      logger.cron(`[Sync] Full Facebook Sync Completed - ${duration}ms`)
    } catch (error) {
      const duration = Date.now() - startTime
      logger.cronError(
        `[Sync] Full Facebook Sync Failed - ${duration}ms`,
        error,
      )
    }
  })
}

export default initSyncCron
