import { Queue, QueueOptions } from 'bullmq'
import { getRedisConnection } from '../config/redis'
import logger from '../utils/logger'

// 队列配置
const queueOptions: QueueOptions = {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000, // 2秒、4秒、8秒
    },
    removeOnComplete: {
      age: 3600, // 保留1小时
      count: 1000, // 最多保留1000个
    },
    removeOnFail: {
      age: 86400, // 失败任务保留24小时
    },
  },
}

// 账户同步队列：用于推送账户同步任务
export const accountSyncQueue = new Queue('account-sync', queueOptions)

// 广告抓取队列：用于推送广告抓取任务（账户、广告系列、广告等）
export const adFetchQueue = new Queue('ad-fetch', queueOptions)

// 洞察数据抓取队列：用于推送 Insights 抓取任务
export const insightsQueue = new Queue('insights-fetch', queueOptions)

// 初始化队列监听
export const initQueues = () => {
  // 监听队列事件
  accountSyncQueue.on('error', (error) => {
    logger.error('[Queue] Account sync queue error:', error)
  })

  adFetchQueue.on('error', (error) => {
    logger.error('[Queue] Ad fetch queue error:', error)
  })

  insightsQueue.on('error', (error) => {
    logger.error('[Queue] Insights queue error:', error)
  })

  logger.info('[Queue] Facebook queues initialized')
}

// 清理所有队列（用于测试或重置）
export const cleanAllQueues = async () => {
  await Promise.all([
    accountSyncQueue.obliterate({ force: true }),
    adFetchQueue.obliterate({ force: true }),
    insightsQueue.obliterate({ force: true }),
  ])
  logger.info('[Queue] All queues cleaned')
}

