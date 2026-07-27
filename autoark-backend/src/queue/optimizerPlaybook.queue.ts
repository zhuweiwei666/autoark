import { Queue } from 'bullmq'
import { getRedisConnection, getRedisClient } from '../config/redis'
import logger from '../utils/logger'

export let optimizerPlaybookQueue: Queue | null = null

try {
  if (getRedisClient()) {
    optimizerPlaybookQueue = new Queue('optimizer.playbook.generate', {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: 200, age: 86400 },
        removeOnFail: { count: 500, age: 86400 * 7 },
      },
    })
    logger.info('[OptimizerPlaybookQueue] Queue initialized')
  }
} catch (error) {
  logger.warn('[OptimizerPlaybookQueue] Queue unavailable:', error)
}

export const addOptimizerPlaybookJob = async (generationId: string) => {
  if (!optimizerPlaybookQueue) {
    logger.warn(
      '[OptimizerPlaybookQueue] Queue not available, skipping enqueue',
    )
    return null
  }

  return optimizerPlaybookQueue.add(
    'generate',
    { generationId },
    { jobId: `optimizer-playbook-${generationId}` },
  )
}
