import { timingSafeEqual } from 'crypto'
import { NextFunction, Request, Response } from 'express'

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>()

const readPositiveInteger = (value: string | undefined, fallback: number) => {
  if (!value || !/^\d+$/.test(value)) return fallback
  return Math.max(Number(value), 1)
}

export const rateLimitAiAdsIntegration = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const windowMs = readPositiveInteger(
    process.env.AI_ADS_INTEGRATION_RATE_LIMIT_WINDOW_MS,
    60_000,
  )
  const maximum = readPositiveInteger(
    process.env.AI_ADS_INTEGRATION_RATE_LIMIT_MAX,
    60,
  )
  const now = Date.now()
  const key = req.ip || req.socket.remoteAddress || 'unknown'
  const bucket = rateLimitBuckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs })
    next()
    return
  }

  bucket.count += 1
  if (bucket.count > maximum) {
    res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000))
    res.status(429).json({
      success: false,
      error: 'Too many requests',
    })
    return
  }

  next()
}

const readBearerToken = (req: Request): string => {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) return ''
  return header.slice('Bearer '.length).trim()
}

const safeEqual = (actual: string, expected: string): boolean => {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  if (actualBuffer.length !== expectedBuffer.length) return false
  return timingSafeEqual(actualBuffer, expectedBuffer)
}

export const authenticateAiAdsIntegration = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const configuredKey = (process.env.AI_ADS_INTEGRATION_API_KEY || '').trim()
  const configuredOrganizationId = (
    process.env.AI_ADS_INTEGRATION_ORGANIZATION_ID || ''
  ).trim()

  if (!configuredKey || !configuredOrganizationId) {
    res.status(503).json({
      success: false,
      error: 'AI ads integration is not configured',
    })
    return
  }

  const providedKey = readBearerToken(req)
  if (!providedKey || !safeEqual(providedKey, configuredKey)) {
    res.status(401).json({
      success: false,
      error: 'Unauthorized',
    })
    return
  }

  next()
}
