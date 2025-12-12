// 🔥 Must be first: load environment variables
import './config/env'

import app from './app'
import connectDB from './config/db'
import { initRedis } from './config/redis'
import logger from './utils/logger'
import { tokenPool } from './services/facebook.token.pool'

// Queues & Workers
import { initQueues } from './queue/facebook.queue'
import { initWorkers } from './queue/facebook.worker'
import { initBulkAdWorker } from './queue/bulkAd.worker'

// Cron Jobs
import initCronJobs from './cron'
// V1 Sync 已废弃，改用 V2 Queue-based Sync
// import initSyncCron from './cron/sync.cron'
import initSyncCronV2 from './cron/sync.cron.v2'
import initPreaggregationCron from './cron/preaggregation.cron'
import initTokenValidationCron from './cron/tokenValidation.cron'

const PORT = process.env.PORT || 3001

// Handle Uncaught Exceptions
process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION! Shutting down...', err)
  process.exit(1)
})

// Handle Unhandled Rejections
process.on('unhandledRejection', (err: any) => {
  logger.error('UNHANDLED REJECTION! Shutting down...', err)
  // Ideally we should close the server gracefully, but process.exit is acceptable here
  process.exit(1)
})

async function bootstrap() {
  // 1) DB
  await connectDB()

  // 2) Redis (optional)
  initRedis()

  // 3) Token Pool
  tokenPool.initialize().catch((error) => {
    logger.error('[Bootstrap] Failed to initialize token pool:', error)
  })

  // 4) Queues & Workers (only if Redis is configured)
  initQueues()
  initWorkers()
  initBulkAdWorker()

  // 5) Cron Jobs (start once per process)
  initCronJobs()
  // V2 Queue-based Sync（替代 V1 串行同步）
  initSyncCronV2()
  initPreaggregationCron()
  initTokenValidationCron()

  // 6) HTTP Server
  app.listen(PORT, () => {
    logger.info(`AutoArk backend running on port ${PORT}`)
  })
}

bootstrap().catch((err) => {
  logger.error('[Bootstrap] Failed to start server:', err)
  process.exit(1)
})
