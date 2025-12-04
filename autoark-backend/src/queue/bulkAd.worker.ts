import { Worker, WorkerOptions, Job } from 'bullmq'
import { getRedisConnection, getRedisClient } from '../config/redis'
import logger from '../utils/logger'
import AdTask from '../models/AdTask'
import { executeTaskForAccount } from '../services/bulkAd.service'
import { addBulkAdJobsBatch } from './bulkAd.queue'

/**
 * 批量广告创建 Worker
 */

// 检查 Redis 是否可用
const isRedisAvailable = (): boolean => {
  try {
    const client = getRedisClient()
    return client !== null
  } catch {
    return false
  }
}

// Worker 配置
let workerOptions: WorkerOptions | null = null
if (isRedisAvailable()) {
  try {
    workerOptions = {
      connection: getRedisConnection(),
      concurrency: 5,
      limiter: {
        max: 20,
        duration: 60000,
      },
    }
  } catch (error) {
    logger.warn('[BulkAdWorker] Failed to create worker options:', error)
  }
}

// 创建 Worker
export const bulkAdWorker = (workerOptions) ? new Worker(
  'bulk-ad-create',
  async (job: Job) => {
    const { taskId, accountId } = job.data
    
    logger.info(`[BulkAdWorker] Processing job: task=${taskId}, account=${accountId}`)
    
    try {
      const task: any = await AdTask.findById(taskId)
      if (!task) {
        throw new Error('Task not found')
      }
      
      if (task.status === 'cancelled') {
        logger.info(`[BulkAdWorker] Task ${taskId} was cancelled, skipping`)
        return { skipped: true, reason: 'cancelled' }
      }
      
      if (task.status === 'pending' || task.status === 'queued') {
        task.status = 'processing'
        if (!task.startedAt) {
          task.startedAt = new Date()
        }
        await task.save()
      }
      
      const result = await executeTaskForAccount(taskId, accountId)
      
      logger.info(`[BulkAdWorker] Job completed: task=${taskId}, account=${accountId}`)
      
      return {
        success: true,
        ...result,
      }
    } catch (error: any) {
      logger.error(`[BulkAdWorker] Job failed: task=${taskId}, account=${accountId}`, error)
      throw error
    }
  },
  workerOptions
) : null

// Worker 事件监听
if (bulkAdWorker) {
  bulkAdWorker.on('completed', async (job) => {
    logger.info(`[BulkAdWorker] Job ${job.id} completed`)
  })
  
  bulkAdWorker.on('failed', async (job, error) => {
    logger.error(`[BulkAdWorker] Job ${job?.id} failed:`, error)
  })
  
  bulkAdWorker.on('error', (error) => {
    logger.error(`[BulkAdWorker] Worker error:`, error)
  })
}

/**
 * 启动任务执行
 */
export const startTaskExecution = async (taskId: string) => {
  const task: any = await AdTask.findById(taskId)
  if (!task) {
    throw new Error('Task not found')
  }
  
  const pendingItems = task.items.filter((item: any) => item.status === 'pending')
  if (pendingItems.length === 0) {
    logger.warn(`[BulkAdWorker] No pending items for task ${taskId}`)
    return { queued: 0 }
  }
  
  task.status = 'queued'
  task.queuedAt = new Date()
  await task.save()
  
  const accountIds = pendingItems.map((item: any) => item.accountId)
  await addBulkAdJobsBatch(taskId, accountIds)
  
  logger.info(`[BulkAdWorker] Task ${taskId} started, ${accountIds.length} accounts queued`)
  
  return { queued: accountIds.length }
}

/**
 * 初始化 Worker
 */
export const initBulkAdWorker = () => {
  if (!bulkAdWorker) {
    logger.warn('[BulkAdWorker] Worker not initialized (Redis unavailable)')
    return
  }
  
  logger.info('[BulkAdWorker] Bulk ad worker initialized')
}

export default bulkAdWorker
