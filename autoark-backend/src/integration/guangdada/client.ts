import {
  GuangdadaAdRecord,
  GuangdadaAdsPage,
  GuangdadaErrorCategory,
  GuangdadaFetchAllOptions,
  GuangdadaFetchOptions,
  GuangdadaPagination,
  GuangdadaSortBy,
} from './types'

const GUANGDADA_ADS_URL = 'https://4437799.com/api/v1/ads'

export const GUANGDADA_LIMITS = Object.freeze({
  pageSize: 100,
  recentDays: 365,
  totalItems: 1000,
})

const DEFAULTS = Object.freeze({
  page: 1,
  pageSize: 20,
  recentDays: 30,
  sortBy: 'estimated_value' as GuangdadaSortBy,
})

export class GuangdadaApiError extends Error {
  readonly category: GuangdadaErrorCategory
  readonly status?: number
  readonly retryable: boolean
  readonly shouldPauseAuthentication: boolean
  readonly retryAfterMs?: number

  constructor(options: {
    message: string
    category: GuangdadaErrorCategory
    status?: number
    retryable?: boolean
    shouldPauseAuthentication?: boolean
    retryAfterMs?: number
  }) {
    super(options.message)
    this.name = 'GuangdadaApiError'
    this.category = options.category
    this.status = options.status
    this.retryable = options.retryable ?? false
    this.shouldPauseAuthentication = options.shouldPauseAuthentication ?? false
    this.retryAfterMs = options.retryAfterMs
  }
}

const clampInteger = (value: unknown, fallback: number, minimum: number, maximum: number) => {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)))
}

const validSortBy = (value: unknown): GuangdadaSortBy => {
  if (value === 'recent' || value === 'heat' || value === 'estimated_value') return value
  return DEFAULTS.sortBy
}

const parseRetryAfterMs = (value: string | null): number | undefined => {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000)

  const date = Date.parse(value)
  if (!Number.isFinite(date)) return undefined
  return Math.max(0, date - Date.now())
}

const classifyHttpError = (response: Response): GuangdadaApiError => {
  const status = response.status
  if (status === 401 || status === 403) {
    return new GuangdadaApiError({
      message: 'Guangdada authentication failed',
      category: 'authentication',
      status,
      shouldPauseAuthentication: true,
    })
  }
  if (status === 429) {
    return new GuangdadaApiError({
      message: 'Guangdada rate limit reached',
      category: 'rate_limit',
      status,
      retryable: true,
      retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
    })
  }
  if (status >= 500) {
    return new GuangdadaApiError({
      message: 'Guangdada service is temporarily unavailable',
      category: 'server',
      status,
      retryable: true,
    })
  }
  return new GuangdadaApiError({
    message: 'Guangdada request was rejected',
    category: 'request',
    status,
  })
}

const normalizedPageOptions = (options: GuangdadaFetchOptions) => ({
  page: clampInteger(options.page, DEFAULTS.page, 1, Number.MAX_SAFE_INTEGER),
  pageSize: clampInteger(options.pageSize, DEFAULTS.pageSize, 1, GUANGDADA_LIMITS.pageSize),
  recentDays: clampInteger(options.recentDays, DEFAULTS.recentDays, 1, GUANGDADA_LIMITS.recentDays),
  sortBy: validSortBy(options.sortBy),
  packageName: typeof options.packageName === 'string' ? options.packageName.trim() : '',
})

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
)

export const fetchGuangdadaAdsPage = async (
  options: GuangdadaFetchOptions = {},
): Promise<GuangdadaAdsPage> => {
  const apiKey = process.env.GUANGDADA_API_KEY?.trim()
  if (!apiKey) {
    throw new GuangdadaApiError({
      message: 'Guangdada API key is not configured',
      category: 'configuration',
      shouldPauseAuthentication: true,
    })
  }

  const request = normalizedPageOptions(options)
  const url = new URL(GUANGDADA_ADS_URL)
  url.searchParams.set('page', String(request.page))
  url.searchParams.set('page_size', String(request.pageSize))
  url.searchParams.set('recent_days', String(request.recentDays))
  url.searchParams.set('sort_by', request.sortBy)
  if (request.packageName) url.searchParams.set('package_name', request.packageName)

  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    })
  } catch {
    throw new GuangdadaApiError({
      message: 'Guangdada network request failed',
      category: 'network',
      retryable: true,
    })
  }

  if (!response.ok) throw classifyHttpError(response)

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new GuangdadaApiError({
      message: 'Guangdada returned an invalid response',
      category: 'response',
    })
  }

  if (!isRecord(body) || !Array.isArray(body.data) || !isRecord(body.pagination)) {
    throw new GuangdadaApiError({
      message: 'Guangdada returned an invalid response',
      category: 'response',
    })
  }

  return {
    data: body.data as GuangdadaAdRecord[],
    pagination: body.pagination as GuangdadaPagination,
  }
}

const finiteNumber = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const hasAnotherPage = (
  pagination: GuangdadaPagination,
  currentPage: number,
  pageSize: number,
  receivedCount: number,
) => {
  const explicitHasMore = pagination.has_more ?? pagination.hasMore
  if (typeof explicitHasMore === 'boolean') return explicitHasMore

  const totalPages = finiteNumber(pagination.total_pages ?? pagination.totalPages)
  if (totalPages !== undefined) return currentPage < totalPages

  const total = finiteNumber(pagination.total)
  if (total !== undefined) return currentPage * pageSize < total

  return receivedCount >= pageSize
}

export const fetchGuangdadaAds = async (
  options: GuangdadaFetchAllOptions = {},
): Promise<GuangdadaAdsPage> => {
  const request = normalizedPageOptions(options)
  const maxItems = clampInteger(
    options.maxItems,
    request.pageSize,
    1,
    GUANGDADA_LIMITS.totalItems,
  )
  const data: GuangdadaAdRecord[] = []
  let pagination: GuangdadaPagination = {}
  let page = request.page

  while (data.length < maxItems) {
    const pageSize = Math.min(request.pageSize, maxItems - data.length)
    const response = await fetchGuangdadaAdsPage({
      ...options,
      page,
      pageSize,
    })
    pagination = response.pagination
    data.push(...response.data.slice(0, maxItems - data.length))

    if (
      response.data.length === 0 ||
      data.length >= maxItems ||
      !hasAnotherPage(pagination, page, pageSize, response.data.length)
    ) {
      break
    }
    page += 1
  }

  return { data, pagination }
}
