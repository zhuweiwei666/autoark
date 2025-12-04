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
      concurrency: 5,  // 同时处理5个账户
      limiter: {
        max: 20,  // 每分钟最多处理20个任务（防止 API 限流）
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
      // 更新任务状态
      const task = await AdTask.findById(taskId)
      if (!task) {
        throw new Error('Task not found')
      }
      
      // 检查任务是否已取消
      if (task.status === 'cancelled') {
        logger.info(`[BulkAdWorker] Task ${taskId} was cancelled, skipping`)
        return { skipped: true, reason: 'cancelled' }
      }
      
      // 如果任务还是 pending，更新为 processing
      if (task.status === 'pending' || task.status === 'queued') {
        task.status = 'processing'
        if (!task.startedAt) {
          task.startedAt = new Date()
        }
        await task.save()
      }
      
      // 执行广告创建
      const result = await executeTaskForAccount(taskId, accountId)
      
      logger.info(`[BulkAdWorker] Job completed: task=${taskId}, account=${accountId}`)
      
      return {
        success: true,
        ...result,
      }
    } catch (error: any) {
      logger.error(`[BulkAdWorker] Job failed: task=${taskId}, account=${accountId}`, error)
      
      // 错误已经在 executeTaskForAccount 中记录到任务项
      // 这里只需要重新抛出让 BullMQ 处理重试
      throw error
    }
  },
  workerOptions
) : null

// Worker 事件监听
if (bulkAdWorker) {
  bulkAdWorker.on('completed', async (job) => {
    logger.info(`[BulkAdWorker] Job ${job.id} completed`)
    
    // 检查任务是否全部完成
    const { taskId } = job.data
    try {
      const task = await AdTask.findById(taskId)
      if (task) {
        task.updateProgress()
        await task.save()
        
        if (task.isCompleted) {
          logger.info(`[BulkAdWorker] Task ${taskId} completed with status: ${task.status}`)
        }
      }
    } catch (error) {
      logger.error(`[BulkAdWorker] Failed to update task progress:`, error)
    }
  })
  
  bulkAdWorker.on('failed', async (job, error) => {
    logger.error(`[BulkAdWorker] Job ${job?.id} failed:`, error)
    
    // 检查是否需要更新任务状态
    if (job?.data?.taskId) {
      try {
        const task = await AdTask.findById(job.data.taskId)
        if (task) {
          task.updateProgress()
          await task.save()
        }
      } catch (err) {
        logger.error(`[BulkAdWorker] Failed to update task on failure:`, err)
      }
    }
  })
  
  bulkAdWorker.on('error', (error) => {
    logger.error(`[BulkAdWorker] Worker error:`, error)
  })
  
  bulkAdWorker.on('stalled', (jobId) => {
    logger.warn(`[BulkAdWorker] Job ${jobId} stalled`)
  })
}

/**
 * 启动任务执行
 * 将任务的所有账户加入队列
 */
export const startTaskExecution = async (taskId: string) => {
  const task = await AdTask.findById(taskId)
  if (!task) {
    throw new Error('Task not found')
  }
  
  // 获取待处理的账户
  const pendingItems = task.items.filter((item: any) => item.status === 'pending')
  if (pendingItems.length === 0) {
    logger.warn(`[BulkAdWorker] No pending items for task ${taskId}`)
    return { queued: 0 }
  }
  
  // 更新任务状态
  task.status = 'queued'
  task.queuedAt = new Date()
  await task.save()
  
  // 批量添加到队列
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

