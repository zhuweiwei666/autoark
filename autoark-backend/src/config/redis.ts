import Redis from 'ioredis'
import logger from '../utils/logger'

let redisClient: Redis | null = null

export const initRedis = (): Redis | null => {
  if (redisClient) {
    return redisClient
  }

  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    logger.warn('REDIS_URL not configured, Redis caching will be disabled')
    return null
  }

  try {
    redisClient = new Redis(redisUrl, {
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000)
        return delay
      },
      maxRetriesPerRequest: 3,
    })

    redisClient.on('connect', () => {
      logger.info('Redis Connected')
    })

    redisClient.on('error', (err) => {
      logger.error('Redis connection error:', err)
    })

    redisClient.on('ready', () => {
      logger.info('Redis Ready')
    })

    return redisClient
  } catch (error) {
    logger.error('Failed to initialize Redis:', error)
    return null
  }
}

export const getRedisClient = (): Redis | null => {
  if (!redisClient) {
    return initRedis()
  }
  return redisClient
}

// BullMQ 需要的连接函数
export const getRedisConnection = (): Redis => {
  const client = getRedisClient()
  if (!client) {
    throw new Error('Redis connection not available. Please configure REDIS_URL environment variable.')
  }
  return client
}

export default getRedisClient

