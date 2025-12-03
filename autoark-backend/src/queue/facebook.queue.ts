import { Queue, QueueOptions } from 'bullmq'
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

// 队列配置（仅在 Redis 可用时创建）
let queueOptions: QueueOptions | null = null
let accountQueue: Queue | null = null
let campaignQueue: Queue | null = null
let adQueue: Queue | null = null

if (isRedisAvailable()) {
  try {
    queueOptions = {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 5, // 重试 5 次
        backoff: {
          type: 'exponential',
          delay: 1000, // 1s, 2s, 4s, 8s, 16s
        },
        removeOnComplete: {
          age: 3600, // 保留1小时
          count: 1000, // 最多保留1000个
        },
        removeOnFail: {
          age: 86400 * 3, // 失败任务保留3天，便于排查
        },
      },
    }

    // 1. 账户同步队列
    // 任务：{ accountId, token }
    accountQueue = new Queue('facebook.account.sync', queueOptions)

    // 2. 广告系列同步队列
    // 任务：{ accountId, campaignId, token }
    campaignQueue = new Queue('facebook.campaign.sync', queueOptions)

    // 3. 广告同步队列 (包含 Insights 拉取)
    // 任务：{ accountId, campaignId, adId, token }
    adQueue = new Queue('facebook.ad.sync', queueOptions)

  } catch (error) {
    logger.warn('[Queue] Failed to initialize queues, Redis may not be configured:', error)
  }
}

export const initQueues = () => {
  if (!accountQueue || !campaignQueue || !adQueue) return

  const queues = [
    { name: 'facebook.account.sync', queue: accountQueue },
    { name: 'facebook.campaign.sync', queue: campaignQueue },
    { name: 'facebook.ad.sync', queue: adQueue },
  ]

  queues.forEach(({ name, queue }) => {
    queue.on('error', (err) => {
      logger.error(`[Queue] ${name} error:`, err)
    })
    // 可以在这里添加更多全局事件监听
  })

  logger.info('[Queue] Facebook sync queues initialized')
}

export { accountQueue, campaignQueue, adQueue, queueOptions }
