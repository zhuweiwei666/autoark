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
  totalPages: 50,
  timeoutMs: 60_000,
  retryAfterMs: 60 * 60 * 1000,
})

const DEFAULTS = Object.freeze({
  page: 1,
  pageSize: 20,
  recentDays: 30,
  timeoutMs: 15_000,
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
  const normalized = value.trim()
  if (/^\d+$/.test(normalized)) {
    const seconds = Number(normalized)
    if (!Number.isFinite(seconds)) return GUANGDADA_LIMITS.retryAfterMs
    return Math.min(seconds * 1000, GUANGDADA_LIMITS.retryAfterMs)
  }

  const httpDatePattern = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/
  if (!httpDatePattern.test(normalized)) return undefined
  const date = Date.parse(normalized)
  if (!Number.isFinite(date)) return undefined
  if (new Date(date).toUTCString() !== normalized) return undefined
  return Math.min(Math.max(0, date - Date.now()), GUANGDADA_LIMITS.retryAfterMs)
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
  timeoutMs: clampInteger(options.timeoutMs, DEFAULTS.timeoutMs, 1, GUANGDADA_LIMITS.timeoutMs),
  sortBy: validSortBy(options.sortBy),
  packageName: typeof options.packageName === 'string' ? options.packageName.trim() : '',
})

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const paginationBooleanFields = ['has_more', 'hasMore']
const paginationIntegerFields = [
  'page',
  'current_page',
  'currentPage',
  'page_size',
  'pageSize',
  'per_page',
  'perPage',
  'total',
  'total_pages',
  'totalPages',
]

const validPagination = (value: unknown): value is GuangdadaPagination => {
  if (!isPlainRecord(value)) return false
  for (const field of paginationBooleanFields) {
    if (Object.prototype.hasOwnProperty.call(value, field) && typeof value[field] !== 'boolean') {
      return false
    }
  }
  for (const field of paginationIntegerFields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) continue
    const fieldValue = value[field]
    if (
      typeof fieldValue !== 'number' ||
      !Number.isFinite(fieldValue) ||
      !Number.isInteger(fieldValue) ||
      fieldValue < 0
    ) {
      return false
    }
  }
  return true
}

const responseError = () => new GuangdadaApiError({
  message: 'Guangdada returned an invalid response',
  category: 'response',
})

const cancellationError = () => new GuangdadaApiError({
  message: 'Guangdada request was cancelled',
  category: 'cancelled',
})

export const fetchGuangdadaAdsPage = async (
  options: GuangdadaFetchOptions = {},
): Promise<GuangdadaAdsPage> => {
  if (options.signal?.aborted) throw cancellationError()

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
  const controller = new AbortController()
  let abortCategory: 'timeout' | 'cancelled' | undefined
  let rejectAbort: (error: Error) => void = () => undefined
  const abortPromise = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject
  })
  const onControlledAbort = () => rejectAbort(new Error('controlled abort'))
  const abortRequest = (category: 'timeout' | 'cancelled') => {
    if (controller.signal.aborted) return
    abortCategory = category
    controller.abort()
  }
  const onExternalAbort = () => abortRequest('cancelled')
  controller.signal.addEventListener('abort', onControlledAbort, { once: true })
  if (options.signal) {
    options.signal.addEventListener('abort', onExternalAbort, { once: true })
    if (options.signal.aborted) onExternalAbort()
  }
  const timeout = setTimeout(() => abortRequest('timeout'), request.timeoutMs)
  let phase: 'fetch' | 'body' = 'fetch'

  try {
    const response = await Promise.race([fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    }), abortPromise])

    if (!response.ok) throw classifyHttpError(response)

    phase = 'body'
    const body = await Promise.race([response.json(), abortPromise])
    if (!isPlainRecord(body) || !Array.isArray(body.data)) throw responseError()
    if (!body.data.every(isPlainRecord)) throw responseError()
    const pagination = body.pagination === undefined ? {} : body.pagination
    if (!validPagination(pagination)) throw responseError()

    return {
      data: body.data as GuangdadaAdRecord[],
      pagination,
    }
  } catch (error) {
    if (error instanceof GuangdadaApiError) throw error
    if (abortCategory === 'timeout') {
      throw new GuangdadaApiError({
        message: 'Guangdada request timed out',
        category: 'timeout',
        retryable: true,
      })
    }
    if (abortCategory === 'cancelled') {
      throw cancellationError()
    }
    if (phase === 'body') throw responseError()
    throw new GuangdadaApiError({
      message: 'Guangdada network request failed',
      category: 'network',
      retryable: true,
    })
  } finally {
    clearTimeout(timeout)
    controller.signal.removeEventListener('abort', onControlledAbort)
    options.signal?.removeEventListener('abort', onExternalAbort)
  }
}

const finiteNumber = (value: unknown): number | undefined => {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
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
  const calculatedMaxPages = Math.min(
    Math.ceil(maxItems / request.pageSize),
    GUANGDADA_LIMITS.totalPages,
  )
  const maxPages = clampInteger(
    options.maxPages,
    calculatedMaxPages,
    1,
    GUANGDADA_LIMITS.totalPages,
  )
  const data: GuangdadaAdRecord[] = []
  let pagination: GuangdadaPagination = {}
  let page = request.page
  let pagesFetched = 0

  while (data.length < maxItems && pagesFetched < maxPages) {
    const response = await fetchGuangdadaAdsPage({
      ...options,
      page,
      pageSize: request.pageSize,
    })
    pagesFetched += 1
    pagination = response.pagination
    data.push(...response.data.slice(0, maxItems - data.length))

    if (
      response.data.length === 0 ||
      data.length >= maxItems ||
      !hasAnotherPage(pagination, page, request.pageSize, response.data.length)
    ) {
      break
    }
    page += 1
  }

  return { data, pagination }
}
