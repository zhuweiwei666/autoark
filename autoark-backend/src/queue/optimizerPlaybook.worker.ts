import { Job, Worker, WorkerOptions } from 'bullmq'
import { getRedisClient } from '../config/redis'
import { processPlaybookGeneration } from '../services/optimizerPlaybookGeneration.service'
import logger from '../utils/logger'

let optimizerPlaybookWorker: Worker | null = null

const createWorkerOptions = (): WorkerOptions => {
  const client = getRedisClient()
  if (!client) throw new Error('Redis not configured')
  const connection = client.duplicate()
  connection.options.maxRetriesPerRequest = null
  const concurrency = Math.min(
    3,
    Math.max(1, Number(process.env.AI_OPTIMIZER_GENERATION_CONCURRENCY || 1)),
  )
  return {
    connection,
    concurrency,
    limiter: { max: 6, duration: 60000 },
  }
}

export const initOptimizerPlaybookWorker = () => {
  if (optimizerPlaybookWorker) return optimizerPlaybookWorker
  if (!getRedisClient()) {
    logger.warn(
      '[OptimizerPlaybookWorker] Worker not initialized (Redis not configured)',
    )
    return null
  }

  optimizerPlaybookWorker = new Worker(
    'optimizer.playbook.generate',
    async (job: Job) => {
      const { generationId } = job.data as { generationId: string }
      return processPlaybookGeneration(generationId)
    },
    createWorkerOptions(),
  )
  optimizerPlaybookWorker.on('failed', (job, error) => {
    logger.error(`[OptimizerPlaybookWorker] Job ${job?.id} failed:`, error)
  })
  optimizerPlaybookWorker.on('error', (error) => {
    logger.error('[OptimizerPlaybookWorker] Worker error:', error)
  })
  logger.info('[OptimizerPlaybookWorker] Worker initialized')
  return optimizerPlaybookWorker
}

export const closeOptimizerPlaybookWorker = async () => {
  const worker = optimizerPlaybookWorker
  optimizerPlaybookWorker = null
  if (worker) await worker.close()
}
