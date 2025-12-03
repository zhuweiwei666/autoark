import cron from 'node-cron'
import * as facebookCampaignsV2Service from '../services/facebook.campaigns.v2.service'
import logger from '../utils/logger'

/**
 * 新版本的同步 Cron
 * 使用 BullMQ 队列 + 并发 Worker
 */
const initSyncCronV2 = () => {
  const interval = process.env.CRON_SYNC_INTERVAL || '10' // Default 10 mins
  const schedule = `*/${interval} * * * *`

  logger.info(`[Sync Cron V2] Initializing with schedule: ${schedule}`)

  cron.schedule(schedule, async () => {
    const startTime = Date.now()
    logger.cron(`[Sync Cron V2] Triggering Facebook Sync via Queue`)

    try {
      const result = await facebookCampaignsV2Service.syncCampaignsFromAdAccountsV2()
      const duration = Date.now() - startTime
      logger.cron(`[Sync Cron V2] Queued ${result.jobsQueued} jobs - ${duration}ms`)
    } catch (error) {
      const duration = Date.now() - startTime
      logger.cronError(`[Sync Cron V2] Failed - ${duration}ms`, error)
    }
  })
}

export default initSyncCronV2

