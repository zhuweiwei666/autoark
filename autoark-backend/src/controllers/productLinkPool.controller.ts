import { randomBytes } from 'crypto'
import { Request, Response } from 'express'
import ProductLinkPool, {
  PRODUCT_LINK_PLATFORMS,
  PRODUCT_LINK_POOL_STATUSES,
  PRODUCT_LINK_WEIGHT_MAX,
} from '../models/ProductLinkPool'
import {
  detectDevicePlatform,
  getNextRoutingCursor,
  mergeForwardedQuery,
  pickWeightedDestination,
  type WeightedDestination,
} from '../services/productLinkRouting.service'
import { combineFilters, scopedOrgFilter } from '../utils/accessControl'
import logger from '../utils/logger'

const NAME_MAX_LENGTH = 120
const DESCRIPTION_MAX_LENGTH = 500
const URL_MAX_LENGTH = 2048
const MAX_DESTINATIONS = 50
const SHORT_CODE_ATTEMPTS = 8

type ProductLinkPlatform = (typeof PRODUCT_LINK_PLATFORMS)[number]
type ProductLinkPoolStatus = (typeof PRODUCT_LINK_POOL_STATUSES)[number]
type HttpError = Error & { statusCode: number }
type SanitizedDestination = WeightedDestination & { _id?: string }
type ProductLinkPoolUpdate = Partial<{
  name: string
  description: string
  fallbackUrl: string
  status: ProductLinkPoolStatus
  destinations: SanitizedDestination[]
}>
type RoutingPool = {
  _id: unknown
  fallbackUrl?: string
  updatedAt?: Date | string | number
  destinations?: WeightedDestination[]
}

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

const createHttpError = (message: string, statusCode = 400): HttpError => {
  const error = new Error(message) as HttpError
  error.statusCode = statusCode
  return error
}

const pickString = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().slice(0, maxLength)
  return trimmed || undefined
}

const pickHttpUrl = (
  value: unknown,
  { optional = false } = {},
): string | undefined => {
  if ((value === undefined || value === null || value === '') && optional)
    return ''
  const raw = pickString(value, URL_MAX_LENGTH)
  if (!raw) throw createHttpError('URL is required')

  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('unsupported protocol')
    }
  } catch {
    throw createHttpError('URL must be a valid http or https address')
  }

  return raw
}

const pickWeight = (value: unknown): number => {
  const weight = typeof value === 'number' ? value : Number(value)
  if (
    !Number.isInteger(weight) ||
    weight < 0 ||
    weight > PRODUCT_LINK_WEIGHT_MAX
  ) {
    throw createHttpError(
      `Weight must be an integer between 0 and ${PRODUCT_LINK_WEIGHT_MAX}`,
    )
  }
  return weight
}

const sanitizeDestinations = (value: unknown): SanitizedDestination[] => {
  if (!Array.isArray(value)) {
    throw createHttpError('destinations must be an array')
  }
  if (value.length > MAX_DESTINATIONS) {
    throw createHttpError(
      `A product link pool supports at most ${MAX_DESTINATIONS} destinations`,
    )
  }

  return value.map((raw, index) => {
    const destination = asRecord(raw)
    const destinationId = pickString(destination._id, 80)
    const name = pickString(destination.name, NAME_MAX_LENGTH)
    const platform = pickString(destination.platform, 20)?.toLowerCase()
    if (!name)
      throw createHttpError(`Destination ${index + 1} name is required`)
    if (
      !(PRODUCT_LINK_PLATFORMS as readonly string[]).includes(platform || '')
    ) {
      throw createHttpError(
        `Destination ${index + 1} platform must be ios or android`,
      )
    }

    return {
      ...(destinationId && { _id: destinationId }),
      name,
      platform: platform as ProductLinkPlatform,
      url: pickHttpUrl(destination.url) as string,
      weight: pickWeight(destination.weight ?? 100),
      enabled: destination.enabled !== false,
    }
  })
}

const sanitizeCreate = (body: unknown) => {
  const input = asRecord(body)
  const name = pickString(input.name, NAME_MAX_LENGTH)
  if (!name) throw createHttpError('name is required')

  return {
    name,
    description: pickString(input.description, DESCRIPTION_MAX_LENGTH) || '',
    fallbackUrl: pickHttpUrl(input.fallbackUrl, { optional: true }) || '',
    status: 'active' as const,
    destinations:
      input.destinations === undefined
        ? []
        : sanitizeDestinations(input.destinations),
  }
}

const sanitizeUpdate = (body: unknown): ProductLinkPoolUpdate => {
  const input = asRecord(body)
  const update: ProductLinkPoolUpdate = {}

  if (Object.prototype.hasOwnProperty.call(input, 'name')) {
    const name = pickString(input.name, NAME_MAX_LENGTH)
    if (!name) throw createHttpError('name is required')
    update.name = name
  }
  if (Object.prototype.hasOwnProperty.call(input, 'description')) {
    update.description =
      pickString(input.description, DESCRIPTION_MAX_LENGTH) || ''
  }
  if (Object.prototype.hasOwnProperty.call(input, 'fallbackUrl')) {
    update.fallbackUrl =
      pickHttpUrl(input.fallbackUrl, { optional: true }) || ''
  }
  if (Object.prototype.hasOwnProperty.call(input, 'status')) {
    const status = pickString(input.status, 20)?.toLowerCase()
    if (
      !(PRODUCT_LINK_POOL_STATUSES as readonly string[]).includes(status || '')
    ) {
      throw createHttpError('status must be active or inactive')
    }
    update.status = status as ProductLinkPoolStatus
  }
  if (Object.prototype.hasOwnProperty.call(input, 'destinations')) {
    update.destinations = sanitizeDestinations(input.destinations)
  }

  return update
}

const ownerData = (req: Request) => ({
  ...(req.user?.organizationId && { organizationId: req.user.organizationId }),
  ...(req.user?.userId && { createdBy: req.user.userId }),
})

const shortLinkBaseUrl = (req: Request): string => {
  const configured = pickString(process.env.SHORT_LINK_BASE_URL, URL_MAX_LENGTH)
  return (configured || `${req.protocol}://${req.get('host')}`).replace(
    /\/+$/,
    '',
  )
}

const serializePool = (pool: unknown, req: Request) => {
  const record = asRecord(pool)
  const toObject = record.toObject
  const data =
    typeof toObject === 'function' ? asRecord(toObject.call(pool)) : record
  return {
    ...data,
    shortUrl: `${shortLinkBaseUrl(req)}/r/${data.shortCode}`,
  }
}

const generateShortCode = async (): Promise<string> => {
  for (let attempt = 0; attempt < SHORT_CODE_ATTEMPTS; attempt += 1) {
    const shortCode = randomBytes(6).toString('base64url')
    const exists = await ProductLinkPool.exists({ shortCode })
    if (!exists) return shortCode
  }
  throw createHttpError('Unable to generate a unique short link', 503)
}

const sendError = (res: Response, error: unknown, context: string) => {
  logger.error(`[ProductLinkPool] ${context}:`, error)
  const details = asRecord(error)
  const errorName =
    error instanceof Error ? error.name : String(details.name || '')
  const errorMessage =
    error instanceof Error ? error.message : String(details.message || '')
  const statusCode =
    Number(details.statusCode) || (errorName === 'CastError' ? 404 : 500)
  return res.status(statusCode).json({
    success: false,
    error: errorMessage || 'Unexpected error',
  })
}

export const listProductLinkPools = async (req: Request, res: Response) => {
  try {
    const pools = await ProductLinkPool.find(scopedOrgFilter(req))
      .sort({ updatedAt: -1 })
      .lean()
    res.json({
      success: true,
      data: pools.map((pool) => serializePool(pool, req)),
    })
  } catch (error) {
    sendError(res, error, 'List pools failed')
  }
}

export const getProductLinkPool = async (req: Request, res: Response) => {
  try {
    const pool = await ProductLinkPool.findOne(
      combineFilters({ _id: req.params.id }, scopedOrgFilter(req)),
    ).lean()
    if (!pool) {
      return res
        .status(404)
        .json({ success: false, error: 'Product link pool not found' })
    }
    res.json({ success: true, data: serializePool(pool, req) })
  } catch (error) {
    sendError(res, error, 'Get pool failed')
  }
}

export const createProductLinkPool = async (req: Request, res: Response) => {
  try {
    const data = sanitizeCreate(req.body)
    const pool = await ProductLinkPool.create({
      ...data,
      shortCode: await generateShortCode(),
      ...ownerData(req),
    })
    res.status(201).json({ success: true, data: serializePool(pool, req) })
  } catch (error) {
    sendError(res, error, 'Create pool failed')
  }
}

export const updateProductLinkPool = async (req: Request, res: Response) => {
  try {
    const update = sanitizeUpdate(req.body)
    if (Object.keys(update).length === 0) {
      throw createHttpError('No valid product link pool fields to update')
    }

    const pool = await ProductLinkPool.findOneAndUpdate(
      combineFilters({ _id: req.params.id }, scopedOrgFilter(req)),
      { $set: update },
      { new: true, runValidators: true },
    )
    if (!pool) {
      return res
        .status(404)
        .json({ success: false, error: 'Product link pool not found' })
    }
    res.json({ success: true, data: serializePool(pool, req) })
  } catch (error) {
    sendError(res, error, 'Update pool failed')
  }
}

export const deleteProductLinkPool = async (req: Request, res: Response) => {
  try {
    const pool = await ProductLinkPool.findOneAndDelete(
      combineFilters({ _id: req.params.id }, scopedOrgFilter(req)),
    )
    if (!pool) {
      return res
        .status(404)
        .json({ success: false, error: 'Product link pool not found' })
    }
    res.json({ success: true, data: { id: String(pool._id) } })
  } catch (error) {
    sendError(res, error, 'Delete pool failed')
  }
}

const redirectToFallback = (
  pool: RoutingPool,
  req: Request,
  res: Response,
): boolean => {
  if (!pool.fallbackUrl) return false
  res.redirect(
    302,
    mergeForwardedQuery(pool.fallbackUrl, req.query as Record<string, unknown>),
  )
  return true
}

export const redirectProductLink = async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  res.vary('User-Agent')
  res.vary('Sec-CH-UA-Platform')

  try {
    const shortCode = pickString(req.params.shortCode, 32)
    if (!shortCode || !/^[A-Za-z0-9_-]{6,32}$/.test(shortCode)) {
      return res.status(404).type('text/plain').send('Short link not found')
    }

    const pool = (await ProductLinkPool.findOne({
      shortCode,
      status: 'active',
    }).lean()) as RoutingPool | null
    if (!pool) {
      return res.status(404).type('text/plain').send('Short link not found')
    }

    const userAgent = String(req.headers['user-agent'] || '')
    const clientPlatform = String(req.headers['sec-ch-ua-platform'] || '')
    const platform = detectDevicePlatform(userAgent, clientPlatform)
    if (platform === 'unknown') {
      if (redirectToFallback(pool, req, res)) return
      return res.status(400).type('text/plain').send('Unsupported device')
    }

    const destinations = (pool.destinations || []).filter(
      (destination) => destination.platform === platform,
    )
    const version = pool.updatedAt ? new Date(pool.updatedAt).getTime() : 0
    const cursor = await getNextRoutingCursor(
      `${String(pool._id)}:${platform}:${version}`,
    )
    const destination = pickWeightedDestination(destinations, cursor)
    if (!destination) {
      if (redirectToFallback(pool, req, res)) return
      return res.status(503).type('text/plain').send('No active destination')
    }

    return res.redirect(
      302,
      mergeForwardedQuery(
        destination.url,
        req.query as Record<string, unknown>,
      ),
    )
  } catch (error) {
    logger.error('[ProductLinkPool] Redirect failed:', error)
    return res.status(500).type('text/plain').send('Short link unavailable')
  }
}
