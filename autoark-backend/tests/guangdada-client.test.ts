import {
  GUANGDADA_LIMITS,
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

const bodyResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  headers: headers(),
  json: async () => body,
})

const resolveLiveCanary = (env: NodeJS.ProcessEnv) => {
  if (env.GUANGDADA_LIVE_CANARY !== '1') return false
  if (!env.GUANGDADA_API_KEY?.trim()) {
    throw new Error('GUANGDADA_API_KEY is required when GUANGDADA_LIVE_CANARY=1')
  }
  return true
}

describe('Guangdada API client', () => {
  beforeEach(() => {
    process.env.GUANGDADA_API_KEY = 'unit-test-placeholder'
  })

  afterEach(() => {
    jest.useRealTimers()
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

  it('times out a stalled fetch with a retryable sanitized error', async () => {
    jest.useFakeTimers()
    let requestSignal: AbortSignal | undefined
    const fetchImpl = jest.fn((_input, init) => {
      requestSignal = init?.signal as AbortSignal
      return new Promise(() => {})
    })
    const request = fetchGuangdadaAdsPage({ timeoutMs: 25, fetchImpl } as any)
    const observed = Promise.race([
      request.then(
        () => ({ state: 'resolved' }),
        (error) => ({ state: 'rejected', error }),
      ),
      new Promise((resolve) => setTimeout(() => resolve({ state: 'stalled' }), 26)),
    ])

    await jest.advanceTimersByTimeAsync(26)

    await expect(observed).resolves.toMatchObject({
      state: 'rejected',
      error: {
        category: 'timeout',
        retryable: true,
        shouldPauseAuthentication: false,
      },
    })
    expect(requestSignal?.aborted).toBe(true)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('keeps the timeout active while reading a stalled response body', async () => {
    jest.useFakeTimers()
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: headers(),
      json: () => new Promise(() => {}),
    })
    const request = fetchGuangdadaAdsPage({ timeoutMs: 25, fetchImpl } as any)
    const observed = Promise.race([
      request.then(
        () => ({ state: 'resolved' }),
        (error) => ({ state: 'rejected', error }),
      ),
      new Promise((resolve) => setTimeout(() => resolve({ state: 'stalled' }), 26)),
    ])

    await jest.advanceTimersByTimeAsync(26)

    await expect(observed).resolves.toMatchObject({
      state: 'rejected',
      error: { category: 'timeout', retryable: true },
    })
    expect(jest.getTimerCount()).toBe(0)
  })

  it('keeps caller cancellation distinct and removes the external abort listener', async () => {
    jest.useFakeTimers()
    const controller = new AbortController()
    const removeListener = jest.spyOn(controller.signal, 'removeEventListener')
    const fetchImpl = jest.fn(() => new Promise(() => {}))
    const request = fetchGuangdadaAdsPage({
      signal: controller.signal,
      timeoutMs: 1000,
      fetchImpl,
    } as any)
    const observed = Promise.race([
      request.then(
        () => ({ state: 'resolved' }),
        (error) => ({ state: 'rejected', error }),
      ),
      new Promise((resolve) => setTimeout(() => resolve({ state: 'stalled' }), 1)),
    ])

    controller.abort()
    await jest.advanceTimersByTimeAsync(1)

    await expect(observed).resolves.toMatchObject({
      state: 'rejected',
      error: {
        category: 'cancelled',
        retryable: false,
        shouldPauseAuthentication: false,
      },
    })
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(jest.getTimerCount()).toBe(0)
  })

  it('short-circuits an already-aborted caller signal before invoking fetch', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchImpl = jest.fn(() => new Promise(() => {}))

    await expect(fetchGuangdadaAdsPage({
      signal: controller.signal,
      fetchImpl,
    })).rejects.toMatchObject({
      category: 'cancelled',
      retryable: false,
      shouldPauseAuthentication: false,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('requires an API key whenever the live canary flag is explicit', () => {
    expect(resolveLiveCanary({})).toBe(false)
    expect(() => resolveLiveCanary({ GUANGDADA_LIVE_CANARY: '1' })).toThrow(
      'GUANGDADA_API_KEY is required',
    )
    expect(resolveLiveCanary({
      GUANGDADA_LIVE_CANARY: '1',
      GUANGDADA_API_KEY: 'unit-test-placeholder',
    })).toBe(true)
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

  it('accepts a minimal successful envelope with plain data records', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(bodyResponse({ data: [{}] }))

    await expect(fetchGuangdadaAdsPage({ fetchImpl })).resolves.toEqual({
      data: [{}],
      pagination: {},
    })
  })

  it('rejects non-record data entries with a sanitized schema error', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(bodyResponse({
      data: [null, 7, 'bad'],
      pagination: {},
      private_url: 'https://private.example/media.mp4',
    }))

    let received: unknown
    try {
      await fetchGuangdadaAdsPage({ fetchImpl })
    } catch (error) {
      received = error
    }

    expect(received).toMatchObject({ category: 'response', retryable: false })
    expect(String(received)).not.toContain('private.example')
    expect(String(received)).not.toContain('unit-test-placeholder')
  })

  it.each([
    { has_more: 'true' },
    { hasMore: 1 },
    { page: -1 },
    { current_page: 1.5 },
    { total: Number.NaN },
    { total_pages: Number.POSITIVE_INFINITY },
  ])('rejects invalid pagination control fields: %p', async (pagination) => {
    const fetchImpl = jest.fn().mockResolvedValue(bodyResponse({ data: [], pagination }))

    await expect(fetchGuangdadaAdsPage({ fetchImpl })).rejects.toMatchObject({
      category: 'response',
      retryable: false,
      shouldPauseAuthentication: false,
    })
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

  it('stops at a calculated page limit even when every page claims more data', async () => {
    const fetchImpl = jest.fn().mockImplementation(async () => {
      if (fetchImpl.mock.calls.length > 10) throw new Error('page limit exceeded')
      return okResponse([{ id: fetchImpl.mock.calls.length }], { has_more: true })
    })

    const response = await fetchGuangdadaAds({
      pageSize: 100,
      maxItems: 1000,
      fetchImpl,
    })

    expect(response.data).toHaveLength(10)
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

  it('parses an HTTP-date Retry-After value', async () => {
    const now = Date.parse('Wed, 01 Jan 2025 00:00:00 GMT')
    jest.spyOn(Date, 'now').mockReturnValue(now)
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: headers({ 'retry-after': new Date(now + 5000).toUTCString() }),
    })

    await expect(fetchGuangdadaAdsPage({ fetchImpl })).rejects.toMatchObject({
      category: 'rate_limit',
      retryAfterMs: 5000,
    })
  })

  it.each(['-1', '1.5', '0x10', '1e3', 'invalid'])(
    'does not interpret invalid Retry-After value %s as delay seconds',
    async (retryAfter) => {
      const fetchImpl = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: headers({ 'retry-after': retryAfter }),
      })

      let received: any
      try {
        await fetchGuangdadaAdsPage({ fetchImpl })
      } catch (error) {
        received = error
      }
      expect(received).toMatchObject({ category: 'rate_limit', retryable: true })
      expect(received.retryAfterMs).toBeUndefined()
    },
  )

  it('clamps an excessive Retry-After delay to the operational maximum', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: headers({ 'retry-after': '999999999999999999999999' }),
    })

    await expect(fetchGuangdadaAdsPage({ fetchImpl })).rejects.toMatchObject({
      retryAfterMs: GUANGDADA_LIMITS.retryAfterMs,
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

const canary = process.env.GUANGDADA_LIVE_CANARY === '1' ? it : it.skip

// Canonical live invocation after securely injecting GUANGDADA_API_KEY (never print its value):
// GUANGDADA_LIVE_CANARY=1 GUANGDADA_API_KEY="$GUANGDADA_API_KEY" PATH=/Users/zww/.nvm/versions/node/v24.14.1/bin:$PATH npm test -- --runInBand tests/guangdada-client.test.ts -t "live response shape"
canary('live response shape: returns the documented Guangdada envelope', async () => {
  resolveLiveCanary(process.env)
  const response = await fetchGuangdadaAdsPage({
    page: 1,
    pageSize: 1,
    recentDays: 3,
    sortBy: 'estimated_value',
  })

  expect(Array.isArray(response.data)).toBe(true)
  expect(response.pagination).toEqual(expect.any(Object))
  expect(Array.isArray(response.data[0]?.videos)).toBe(true)
}, 20_000)
