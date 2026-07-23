// 🔥 Must be first: load environment variables
import './config/env'

import app from './app'
import connectDB from './config/db'
import { initRedis } from './config/redis'
import logger from './utils/logger'
import { tokenPool } from './services/facebook.token.pool'
import { ensureMetricsDailyIndexCompatibility } from './services/facebook.upsert.service'

// Queues & Workers
import { initQueues } from './queue/facebook.queue'
import { initWorkers } from './queue/facebook.worker'
import { initBulkAdWorker } from './queue/bulkAd.worker'
import { initAutomationWorker } from './queue/automation.worker'
import {
  closeExternalMaterialQueue,
  initExternalMaterialQueue,
} from './queue/externalMaterial.queue'
import {
  closeExternalMaterialWorker,
  initExternalMaterialWorker,
} from './queue/externalMaterial.worker'

// Agent System V2
import { initializeAgentSystem } from './agent'

// Cron Jobs
import initCronJobs from './cron'
// V1 Sync 已废弃，改用 V2 Queue-based Sync
// import initSyncCron from './cron/sync.cron'
import initSyncCronV2 from './cron/sync.cron.v2'
import initPreaggregationCron from './cron/preaggregation.cron'
import initTokenValidationCron from './cron/tokenValidation.cron'
import { closeExternalMaterialCron } from './cron/externalMaterial.cron'

const PORT = process.env.PORT || 3001

let httpServer: ReturnType<typeof app.listen> | null = null
let shuttingDown: Promise<void> | null = null
let processHandlersRegistered = false

export const shutdown = async (): Promise<void> => {
  if (shuttingDown) return shuttingDown
  shuttingDown = (async () => {
    closeExternalMaterialCron()
    await closeExternalMaterialWorker()
    await closeExternalMaterialQueue()
    const server = httpServer
    httpServer = null
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    }
  })()
  return shuttingDown
}

const registerProcessHandlers = () => {
  if (processHandlersRegistered) return
  processHandlersRegistered = true

  process.on('uncaughtException', (err) => {
    logger.error('UNCAUGHT EXCEPTION! Shutting down...', err)
    void shutdown().finally(() => process.exit(1))
  })

  process.on('unhandledRejection', (err: unknown) => {
    logger.error('UNHANDLED REJECTION! Shutting down...', err)
    void shutdown().finally(() => process.exit(1))
  })

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void shutdown().finally(() => process.exit(0))
    })
  }
}

export async function bootstrap() {
  // 1) DB
  await connectDB()
  await ensureMetricsDailyIndexCompatibility()

  // 2) Redis (optional)
  const redis = initRedis()

  // 3) Token Pool
  tokenPool.initialize().catch((error) => {
    logger.error('[Bootstrap] Failed to initialize token pool:', error)
  })

  // 4) Queues & Workers (only if Redis is configured)
  initQueues()
  await initWorkers()
  initBulkAdWorker()
  initAutomationWorker()
  await initExternalMaterialQueue(redis)
  await initExternalMaterialWorker(redis)

  // 5) Agent System V2 (register all tools)
  initializeAgentSystem()

  // 6) Cron Jobs (start once per process)
  initCronJobs()
  // V2 Queue-based Sync（替代 V1 串行同步）
  initSyncCronV2()
  initPreaggregationCron()
  initTokenValidationCron()

  // 7) HTTP Server
  httpServer = app.listen(PORT, () => {
    logger.info(`AutoArk backend running on port ${PORT}`)
  })
  return httpServer
}

if (require.main === module) {
  registerProcessHandlers()
  bootstrap().catch((err) => {
    logger.error('[Bootstrap] Failed to start server:', err)
    void shutdown().finally(() => process.exit(1))
  })
}
