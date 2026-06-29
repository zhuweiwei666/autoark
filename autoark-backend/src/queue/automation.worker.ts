import { Worker, Job, WorkerOptions } from 'bullmq'
import { getRedisClient } from '../config/redis'
import logger from '../utils/logger'
import AutomationJob from '../models/AutomationJob'
import { executeAutomationJobInline } from '../services/automationJob.service'

let automationWorker: Worker | null = null

const createWorkerOptions = (concurrency: number): WorkerOptions => {
  const client = getRedisClient()
  if (!client) throw new Error('Redis not configured')
  const connection = client.duplicate()
  // BullMQ required
  connection.options.maxRetriesPerRequest = null
  return {
    connection,
    concurrency,
    limiter: { max: 50, duration: 60000 },
  }
}

export const initAutomationWorker = () => {
  const client = getRedisClient()
  if (!client) {
    logger.warn('[AutomationWorker] Worker not initialized (Redis not configured)')
    return
  }

  automationWorker = new Worker(
    'automation.jobs',
    async (job: Job) => {
      const { automationJobId } = job.data as { automationJobId: string }
      const doc: any = await AutomationJob.findById(automationJobId)
      if (!doc) throw new Error('AutomationJob not found')

      // 幂等：已完成则直接返回
      if (doc.status === 'completed') {
        return { skipped: true, reason: 'already_completed' }
      }
      if (doc.status === 'cancelled') {
        return { skipped: true, reason: 'cancelled' }
      }

      const result: any = await executeAutomationJobInline(automationJobId)
      return { success: true, automationJobId, status: result?.status }
    },
    createWorkerOptions(5),
  )

  automationWorker.on('failed', (job, err) => {
    logger.error(`[AutomationWorker] Job ${job?.id} failed:`, err)
  })
  automationWorker.on('error', (err) => {
    logger.error('[AutomationWorker] Worker error:', err)
  })

  logger.info('[AutomationWorker] Worker initialized')
}

export default automationWorker
