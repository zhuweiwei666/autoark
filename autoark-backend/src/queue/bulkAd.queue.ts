import { Queue } from 'bullmq'
import { getRedisConnection, getRedisClient } from '../config/redis'
import logger from '../utils/logger'

/**
 * 批量广告创建任务队列
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

// 创建队列
export let bulkAdQueue: Queue | null = null

if (isRedisAvailable()) {
  try {
    bulkAdQueue = new Queue('bulk-ad-create', {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: {
          count: 100,  // 保留最近100个成功任务
          age: 86400,  // 或保留24小时
        },
        removeOnFail: {
          count: 500,  // 保留最近500个失败任务
          age: 604800, // 或保留7天
        },
      },
    })
    logger.info('[BulkAdQueue] Queue initialized')
  } catch (error) {
    logger.warn('[BulkAdQueue] Failed to create queue, Redis may not be configured:', error)
  }
}

/**
 * 添加批量创建任务到队列
 */
export const addBulkAdJob = async (taskId: string, accountId: string, priority: number = 1) => {
  if (!bulkAdQueue) {
    logger.warn('[BulkAdQueue] Queue not available, skipping job')
    return null
  }
  
  const jobId = `bulk-ad-${taskId}-${accountId}`
  
  try {
    const job = await bulkAdQueue.add(
      'create-ads',
      {
        taskId,
        accountId,
        timestamp: Date.now(),
      },
      {
        jobId,
        priority,
        delay: 0,
      }
    )
    
    logger.info(`[BulkAdQueue] Job added: ${jobId}`)
    return job
  } catch (error: any) {
    logger.error(`[BulkAdQueue] Failed to add job:`, error)
    throw error
  }
}

/**
 * 批量添加任务
 */
export const addBulkAdJobsBatch = async (
  taskId: string,
  accountIds: string[],
  basePriority: number = 1
) => {
  if (!bulkAdQueue) {
    logger.warn('[BulkAdQueue] Queue not available, skipping batch')
    return []
  }
  
  const jobs = accountIds.map((accountId, index) => ({
    name: 'create-ads',
    data: {
      taskId,
      accountId,
      timestamp: Date.now(),
    },
    opts: {
      jobId: `bulk-ad-${taskId}-${accountId}`,
      priority: basePriority + index,  // 按顺序优先级递增
    },
  }))
  
  try {
    const results = await bulkAdQueue.addBulk(jobs)
    logger.info(`[BulkAdQueue] ${results.length} jobs added for task ${taskId}`)
    return results
  } catch (error: any) {
    logger.error(`[BulkAdQueue] Failed to add batch jobs:`, error)
    throw error
  }
}

/**
 * 获取队列状态
 */
export const getQueueStatus = async () => {
  if (!bulkAdQueue) {
    return { available: false }
  }
  
  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      bulkAdQueue.getWaitingCount(),
      bulkAdQueue.getActiveCount(),
      bulkAdQueue.getCompletedCount(),
      bulkAdQueue.getFailedCount(),
      bulkAdQueue.getDelayedCount(),
    ])
    
    return {
      available: true,
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + delayed,
    }
  } catch (error: any) {
    logger.error('[BulkAdQueue] Failed to get queue status:', error)
    return { available: false, error: error.message }
  }
}

/**
 * 清理队列中的特定任务
 */
export const removeTaskJobs = async (taskId: string) => {
  if (!bulkAdQueue) {
    return false
  }
  
  try {
    // 获取所有等待中的任务
    const waiting = await bulkAdQueue.getJobs(['waiting', 'delayed'])
    
    let removed = 0
    for (const job of waiting) {
      if (job.data?.taskId === taskId) {
        await job.remove()
        removed++
      }
    }
    
    logger.info(`[BulkAdQueue] Removed ${removed} jobs for task ${taskId}`)
    return true
  } catch (error: any) {
    logger.error('[BulkAdQueue] Failed to remove task jobs:', error)
    return false
  }
}

export default bulkAdQueue

