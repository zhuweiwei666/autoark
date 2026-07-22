import {
  GuangdadaApiError,
  fetchGuangdadaAds,
  fetchGuangdadaAdsPage,
} from '../src/integration/guangdada/client'

const originalApiKey = process.env.GUANGDADA_API_KEY

const headers = (values: Record<string, string> = {}) => ({
  get: (name: string) => values[name.toLowerCase()] ?? null,
})

const okResponse = (data: unknown[], pagination: Record<string, unknown> = {}) => ({
  ok: true,
  status: 200,
  headers: headers(),
  json: async () => ({ data, pagination }),
})

describe('Guangdada API client', () => {
  beforeEach(() => {
    process.env.GUANGDADA_API_KEY = 'unit-test-placeholder'
  })

  afterEach(() => {
    jest.restoreAllMocks()
    if (originalApiKey === undefined) delete process.env.GUANGDADA_API_KEY
    else process.env.GUANGDADA_API_KEY = originalApiKey
  })

  it('sends a Bearer request and the documented query parameters', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse([], {
      page: 3,
      page_size: 25,
      total: 0,
    }))

    await fetchGuangdadaAdsPage({
      page: 3,
      pageSize: 25,
      recentDays: 14,
      sortBy: 'heat',
      packageName: 'Demo Package',
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [requestUrl, requestInit] = fetchImpl.mock.calls[0]
    const url = new URL(requestUrl)
    const authorization = requestInit.headers.Authorization

    expect(url.origin + url.pathname).toBe('https://4437799.com/api/v1/ads')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page: '3',
      page_size: '25',
      recent_days: '14',
      sort_by: 'heat',
      package_name: 'Demo Package',
    })
    expect(authorization.replace(/\S+$/, '[redacted]')).toBe('Bearer [redacted]')
  })

  it('reads the API key only when a request is made', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse([]))
    delete process.env.GUANGDADA_API_KEY

    await expect(fetchGuangdadaAdsPage({ fetchImpl })).rejects.toMatchObject({
      category: 'configuration',
      retryable: false,
      shouldPauseAuthentication: true,
    })
    expect(fetchImpl).not.toHaveBeenCalled()

    process.env.GUANGDADA_API_KEY = 'unit-test-placeholder'
    await expect(fetchGuangdadaAdsPage({ fetchImpl })).resolves.toMatchObject({ data: [] })
  })

  it('clamps page size and recent-day boundaries and omits an empty package filter', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse([]))

    await fetchGuangdadaAdsPage({
      page: 0,
      pageSize: 999,
      recentDays: -10,
      sortBy: 'recent',
      packageName: '   ',
      fetchImpl,
    })

    const url = new URL(fetchImpl.mock.calls[0][0])
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page: '1',
      page_size: '100',
      recent_days: '1',
      sort_by: 'recent',
    })
  })

  it('caps recent days at 365', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse([]))

    await fetchGuangdadaAdsPage({ recentDays: 999, fetchImpl })

    const url = new URL(fetchImpl.mock.calls[0][0])
    expect(url.searchParams.get('recent_days')).toBe('365')
  })

  it('keeps remote page size fixed while slicing the merged result to maxItems', async () => {
    const records = Array.from({ length: 5 }, (_, id) => ({ id }))
    const fetchImpl = jest.fn().mockImplementation(async (requestUrl: string | URL) => {
      const url = new URL(requestUrl)
      const page = Number(url.searchParams.get('page'))
      const pageSize = Number(url.searchParams.get('page_size'))
      const offset = (page - 1) * pageSize
      return okResponse(records.slice(offset, offset + pageSize), {
        page,
        page_size: pageSize,
        total_pages: Math.ceil(records.length / pageSize),
      })
    })

    const response = await fetchGuangdadaAds({
      page: 1,
      pageSize: 2,
      maxItems: 3,
      fetchImpl,
    })

    expect(response.data.map((record) => record.id)).toEqual([0, 1, 2])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const urls = fetchImpl.mock.calls.map(([value]) => new URL(value))
    expect(urls.map((url) => url.searchParams.get('page'))).toEqual(['1', '2'])
    expect(urls.map((url) => url.searchParams.get('page_size'))).toEqual(['2', '2'])
  })

  it('caps a multi-page pull at 1000 records', async () => {
    const page = Array.from({ length: 100 }, (_, index) => ({ id: String(index) }))
    const fetchImpl = jest.fn().mockResolvedValue(okResponse(page, { has_more: true }))

    const response = await fetchGuangdadaAds({
      pageSize: 100,
      maxItems: 50_000,
      fetchImpl,
    })

    expect(response.data).toHaveLength(1000)
    expect(fetchImpl).toHaveBeenCalledTimes(10)
  })

  it.each([401, 403])('classifies HTTP %s as an authentication pause', async (status) => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status,
      headers: headers(),
    })

    await expect(fetchGuangdadaAdsPage({ fetchImpl })).rejects.toMatchObject({
      name: 'GuangdadaApiError',
      status,
      category: 'authentication',
      retryable: false,
      shouldPauseAuthentication: true,
    })
  })

  it('classifies HTTP 429 and parses Retry-After seconds', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: headers({ 'retry-after': '7' }),
    })

    await expect(fetchGuangdadaAdsPage({ fetchImpl })).rejects.toMatchObject({
      status: 429,
      category: 'rate_limit',
      retryable: true,
      shouldPauseAuthentication: false,
      retryAfterMs: 7000,
    })
  })

  it('classifies 5xx responses as retryable server errors', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: headers(),
    })

    await expect(fetchGuangdadaAdsPage({ fetchImpl })).rejects.toMatchObject({
      status: 503,
      category: 'server',
      retryable: true,
      shouldPauseAuthentication: false,
    })
  })

  it('keeps HTTP and network error messages free of secrets and response data', async () => {
    const sensitiveFragments = [
      'unit-test-placeholder',
      'private.example/media.mp4',
      'raw-ad-record',
    ]
    const httpFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: sensitiveFragments.join(' '),
      headers: headers({ authorization: 'Bearer unit-test-placeholder' }),
      json: async () => ({ record: 'raw-ad-record', url: 'https://private.example/media.mp4' }),
    })

    let httpError: unknown
    try {
      await fetchGuangdadaAdsPage({ fetchImpl: httpFetch })
    } catch (error) {
      httpError = error
    }

    expect(httpError).toBeInstanceOf(GuangdadaApiError)
    for (const fragment of sensitiveFragments) {
      expect(String(httpError)).not.toContain(fragment)
    }

    const networkFetch = jest.fn().mockRejectedValue(
      new Error('unit-test-placeholder https://private.example/media.mp4 raw-ad-record'),
    )
    let networkError: unknown
    try {
      await fetchGuangdadaAdsPage({ fetchImpl: networkFetch })
    } catch (error) {
      networkError = error
    }
    for (const fragment of sensitiveFragments) {
      expect(String(networkError)).not.toContain(fragment)
    }
  })
})

const canary = originalApiKey ? it : it.skip

canary('canary: returns the documented Guangdada response shape', async () => {
  const response = await fetchGuangdadaAdsPage({
    page: 1,
    pageSize: 1,
    recentDays: 3,
    sortBy: 'estimated_value',
  })

  expect(Array.isArray(response.data)).toBe(true)
  expect(response.pagination).toEqual(expect.any(Object))
  expect(Array.isArray(response.data[0]?.videos)).toBe(true)
}, 15_000)
