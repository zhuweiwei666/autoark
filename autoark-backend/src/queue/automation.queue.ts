import { Queue } from 'bullmq'
import { getRedisConnection, getRedisClient } from '../config/redis'
import logger from '../utils/logger'

// 检查 Redis 是否可用
const isRedisAvailable = (): boolean => {
  try {
    const client = getRedisClient()
    return client !== null
  } catch {
    return false
  }
}

export let automationQueue: Queue | null = null

if (isRedisAvailable()) {
  try {
    automationQueue = new Queue('automation.jobs', {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 200, age: 86400 },
        removeOnFail: { count: 500, age: 86400 * 7 },
      },
    })
    logger.info('[AutomationQueue] Queue initialized')
  } catch (e) {
    logger.warn('[AutomationQueue] Failed to create queue, Redis may not be configured:', e)
  }
}

export const addAutomationJob = async (automationJobId: string, priority = 1) => {
  if (!automationQueue) {
    logger.warn('[AutomationQueue] Queue not available, skipping enqueue')
    return null
  }

  const jobId = `automation-${automationJobId}`
  return automationQueue.add(
    'run',
    { automationJobId },
    { jobId, priority },
  )
}

