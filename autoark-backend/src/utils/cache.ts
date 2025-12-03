import { getRedisClient } from '../config/redis'
import logger from './logger'

const CACHE_TTL = {
  TODAY: 5 * 60, // 5 分钟（今天的数据）
  DATE_RANGE: 10 * 60, // 10 分钟（日期范围的数据）
}

/**
 * 生成缓存键
 */
export const getCacheKey = (prefix: string, params: Record<string, any>): string => {
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${key}:${params[key]}`)
    .join('|')
  return `cache:${prefix}:${sortedParams}`
}

/**
 * 从缓存获取数据
 */
export const getFromCache = async <T>(key: string): Promise<T | null> => {
  const redis = getRedisClient()
  if (!redis) {
    return null
  }

  try {
    const data = await redis.get(key)
    if (data) {
      return JSON.parse(data) as T
    }
    return null
  } catch (error) {
    logger.error(`Cache get error for key ${key}:`, error)
    return null
  }
}

/**
 * 设置缓存数据
 */
export const setToCache = async (
  key: string,
  data: any,
  ttl: number = CACHE_TTL.TODAY,
): Promise<boolean> => {
  const redis = getRedisClient()
  if (!redis) {
    return false
  }

  try {
    await redis.setex(key, ttl, JSON.stringify(data))
    return true
  } catch (error) {
    logger.error(`Cache set error for key ${key}:`, error)
    return false
  }
}

/**
 * 删除缓存
 */
export const deleteFromCache = async (pattern: string): Promise<number> => {
  const redis = getRedisClient()
  if (!redis) {
    return 0
  }

  try {
    const keys = await redis.keys(pattern)
    if (keys.length > 0) {
      return await redis.del(...keys)
    }
    return 0
  } catch (error) {
    logger.error(`Cache delete error for pattern ${pattern}:`, error)
    return 0
  }
}

/**
 * 清除所有缓存
 */
export const clearCache = async (prefix: string = 'cache:*'): Promise<number> => {
  return deleteFromCache(prefix)
}

export { CACHE_TTL }

