import { getRedisClient } from '../config/redis'
import logger from '../utils/logger'

export type DevicePlatform = 'ios' | 'android' | 'unknown'

export type WeightedDestination = {
  _id?: unknown
  name: string
  platform: 'ios' | 'android'
  url: string
  weight: number
  enabled: boolean
}

const scheduleCache = new Map<string, number[]>()
const localCounters = new Map<string, number>()
const MAX_SCHEDULE_CACHE_ENTRIES = 64
const ROUTING_COUNTER_TTL_SECONDS = 30 * 24 * 60 * 60

const greatestCommonDivisor = (left: number, right: number): number => {
  let a = Math.abs(left)
  let b = Math.abs(right)
  while (b > 0) {
    const remainder = a % b
    a = b
    b = remainder
  }
  return a || 1
}

const normalizeWeights = (weights: number[]): number[] => {
  const integers = weights.map((weight) =>
    Math.max(0, Math.trunc(Number(weight) || 0)),
  )
  const positive = integers.filter((weight) => weight > 0)
  if (positive.length === 0) return integers

  const divisor = positive.reduce(greatestCommonDivisor)
  return integers.map((weight) => (weight > 0 ? weight / divisor : 0))
}

const buildSmoothWeightedSchedule = (weights: number[]): number[] => {
  const normalized = normalizeWeights(weights)
  const totalWeight = normalized.reduce((sum, weight) => sum + weight, 0)
  if (totalWeight <= 0) return []

  const currentWeights = normalized.map(() => 0)
  const schedule: number[] = []

  for (let slot = 0; slot < totalWeight; slot += 1) {
    let selectedIndex = -1
    for (let index = 0; index < normalized.length; index += 1) {
      if (normalized[index] <= 0) continue
      currentWeights[index] += normalized[index]
      if (
        selectedIndex === -1 ||
        currentWeights[index] > currentWeights[selectedIndex]
      ) {
        selectedIndex = index
      }
    }

    if (selectedIndex === -1) break
    currentWeights[selectedIndex] -= totalWeight
    schedule.push(selectedIndex)
  }

  return schedule
}

const getSchedule = (weights: number[]): number[] => {
  const normalized = normalizeWeights(weights)
  const cacheKey = normalized.join(',')
  const cached = scheduleCache.get(cacheKey)
  if (cached) return cached

  const schedule = buildSmoothWeightedSchedule(normalized)
  if (scheduleCache.size >= MAX_SCHEDULE_CACHE_ENTRIES) {
    scheduleCache.clear()
  }
  scheduleCache.set(cacheKey, schedule)
  return schedule
}

export const detectDevicePlatform = (
  userAgent = '',
  clientPlatform = '',
): DevicePlatform => {
  const platform = clientPlatform.replace(/"/g, '').trim().toLowerCase()
  if (platform.includes('android')) return 'android'
  if (platform.includes('ios')) return 'ios'

  if (/android/i.test(userAgent)) return 'android'
  if (/(iphone|ipad|ipod)/i.test(userAgent)) return 'ios'
  if (/macintosh/i.test(userAgent) && /mobile/i.test(userAgent)) return 'ios'
  return 'unknown'
}

export const pickWeightedDestination = <T extends WeightedDestination>(
  destinations: T[],
  cursor: number,
): T | null => {
  const eligible = destinations.filter(
    (destination) =>
      destination.enabled !== false &&
      Number.isFinite(Number(destination.weight)) &&
      Number(destination.weight) > 0,
  )
  if (eligible.length === 0) return null

  const schedule = getSchedule(
    eligible.map((destination) => destination.weight),
  )
  if (schedule.length === 0) return null

  const normalizedCursor = Math.abs(Math.trunc(cursor || 0)) % schedule.length
  return eligible[schedule[normalizedCursor]] || null
}

export const mergeForwardedQuery = (
  destinationUrl: string,
  query: Record<string, unknown>,
): string => {
  const destination = new URL(destinationUrl)

  for (const [key, rawValue] of Object.entries(query)) {
    if (typeof rawValue === 'string') {
      destination.searchParams.set(key, rawValue)
      continue
    }

    if (Array.isArray(rawValue)) {
      const values = rawValue.filter(
        (value): value is string => typeof value === 'string',
      )
      if (values.length === 0) continue
      destination.searchParams.delete(key)
      values.forEach((value) => destination.searchParams.append(key, value))
    }
  }

  return destination.toString()
}

export const getNextRoutingCursor = async (
  counterKey: string,
): Promise<number> => {
  const redis = getRedisClient()
  if (redis?.status === 'ready') {
    try {
      const value = await redis.incr(`product-link-routing:${counterKey}`)
      if (value === 1) {
        await redis.expire(
          `product-link-routing:${counterKey}`,
          ROUTING_COUNTER_TTL_SECONDS,
        )
      }
      return value - 1
    } catch (error) {
      logger.warn(
        '[ProductLinkRouting] Redis counter unavailable, using local counter',
        error,
      )
    }
  }

  const current = localCounters.get(counterKey) || 0
  localCounters.set(counterKey, current + 1)
  return current
}

export const resetProductLinkRoutingStateForTests = (): void => {
  localCounters.clear()
  scheduleCache.clear()
}
