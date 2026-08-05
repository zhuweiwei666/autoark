import './config/env'
import os from 'os'
import connectDB from './config/db'
import logger from './utils/logger'
import { processNextTemplateJob } from './services/creativeFactoryTemplateWorker.service'

const workerId = `creative-factory-${os.hostname()}-${process.pid}`
const idlePollMs = Math.max(
  5_000,
  Number(process.env.CREATIVE_FACTORY_TEMPLATE_POLL_MS) || 15_000,
)
let stopping = false

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref()
  })

async function main() {
  await connectDB()
  logger.info('[CreativeFactoryTemplateWorker] Started', {
    workerId,
    concurrency: 1,
    generationPriority: 20,
  })
  while (!stopping) {
    const processed = await processNextTemplateJob(workerId).catch((error) => {
      logger.error('[CreativeFactoryTemplateWorker] Poll failed', error)
      return false
    })
    await wait(processed ? 1_000 : idlePollMs)
  }
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    stopping = true
  })
}

main().catch((error) => {
  logger.error('[CreativeFactoryTemplateWorker] Fatal startup error', error)
  process.exitCode = 1
})
