import Redis from 'ioredis'
import { env } from './env'
import { log } from '../platform/logger'

let redis: Redis | null = null

export function initRedis(): Redis | null {
  if (redis) return redis
  if (!env.REDIS_URL) {
    log.warn('REDIS_URL not configured, Redis disabled')
    return null
  }
  try {
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    })
    redis.on('connect', () => log.info('Redis connected'))
    redis.on('error', (err) => log.error('Redis error:', err.message))
    return redis
  } catch (err: any) {
    log.error('Redis init failed:', err.message)
    return null
  }
}

export function getRedis(): Redis | null {
  return redis
}
