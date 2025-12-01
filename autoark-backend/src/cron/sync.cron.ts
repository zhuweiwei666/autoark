import cron from 'node-cron'
import * as fbSyncService from '../services/facebook.sync.service'
import logger from '../utils/logger'

const initSyncCron = () => {
  const interval = process.env.CRON_SYNC_INTERVAL || '10' // Default 10 mins
  const schedule = `*/${interval} * * * *`

  logger.info(`Initializing Facebook Sync Cron with schedule: ${schedule}`)

  cron.schedule(schedule, async () => {
    logger.info('Cron: Triggering Full Facebook Sync')
    await fbSyncService.runFullSync()
  })
}

export default initSyncCron
