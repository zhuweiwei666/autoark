import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import {
  createSafeMediaFilename,
  downloadRemoteMedia,
  isPublicIpAddress,
  RemoteMediaDownloadError,
  type RemoteMediaDownloadDependencies,
} from '../src/services/remoteMediaDownload.service'

type ResponseStep = {
  statusCode?: number
  headers?: Record<string, string | string[] | undefined>
  chunks?: Array<string | Buffer>
  end?: boolean
  error?: Error
  connect?: boolean
}

const createRequestSequence = (steps: ResponseStep[]) => {
  const requests: any[] = []
  const responses: PassThrough[] = []
  const request = jest.fn((options: any, onResponse: (response: any) => void) => {
    const step = steps[requests.length] || {}
    const req = new EventEmitter() as any
    req.destroyed = false
    req.destroy = jest.fn(() => {
      req.destroyed = true
    })
    req.end = jest.fn(() => {
      process.nextTick(() => {
        if (step.connect !== false) {
          const socket = new EventEmitter()
          req.emit('socket', socket)
          socket.emit('secureConnect')
        }
        if (step.error) {
          req.emit('error', step.error)
          return
        }
        if (step.statusCode === undefined) return

        const response = new PassThrough() as any
        response.statusCode = step.statusCode
        response.headers = step.headers || {}
        responses.push(response)
        onResponse(response)
        for (const chunk of step.chunks || []) response.write(chunk)
        if (step.end !== false) response.end()
      })
    })
    requests.push(req)
    return req
  })

  return { request, requests, responses }
}

const publicResolver = jest.fn(async () => [{ address: '93.184.216.34', family: 4 as const }])

const expectCategory = async (promise: Promise<unknown>, category: string, host?: string) => {
  try {
    await promise
    throw new Error('expected download to reject')
  } catch (error) {
    expect(error).toBeInstanceOf(RemoteMediaDownloadError)
    expect((error as RemoteMediaDownloadError).category).toBe(category)
    if (host !== undefined) expect((error as RemoteMediaDownloadError).host).toBe(host)
    return error as RemoteMediaDownloadError
  }
}

describe('remote media address policy', () => {
  it.each([
    '0.0.0.0',
    '0.1.2.3',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.1.1',
    '172.16.0.1',
    '192.0.0.1',
    '192.0.2.1',
    '192.31.196.1',
    '192.52.193.1',
    '192.88.99.1',
    '192.168.1.1',
    '192.175.48.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '239.255.255.255',
    '240.0.0.1',
    '255.255.255.255',
  ])('blocks special-use IPv4 address %s', (address) => {
    expect(isPublicIpAddress(address)).toBe(false)
  })

  it.each([
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
    '100::1',
    '2001::1',
    '2001:2::1',
    '2001:db8::1',
    '2002::1',
    '3fff::1',
    'fc00::1',
    'fd00::1',
    'fe80::1',
    'fec0::1',
    'ff02::1',
  ])('blocks special-use IPv6 address %s', (address) => {
    expect(isPublicIpAddress(address)).toBe(false)
  })

  it.each(['1.1.1.1', '8.8.8.8', '93.184.216.34', '2001:4860:4860::8888', '2606:4700:4700::1111'])(
    'accepts globally routable address %s',
    (address) => {
      expect(isPublicIpAddress(address)).toBe(true)
    },
  )

  it('rejects non-HTTPS, credentialed, malformed URL, and malformed hostname inputs', async () => {
    await expectCategory(downloadRemoteMedia('http://media.example/file.jpg'), 'protocol', 'media.example')
    const credentialError = await expectCategory(
      downloadRemoteMedia('https://user:SECRET@media.example/file.jpg?token=QUERY'),
      'credentials',
      'media.example',
    )
    expect(String(credentialError)).not.toContain('SECRET')
    expect(String(credentialError)).not.toContain('QUERY')
    await expectCategory(downloadRemoteMedia('https://[::1'), 'invalid_url', 'unknown')
    await expectCategory(downloadRemoteMedia('https://bad_host.example/file.jpg'), 'invalid_host', 'unknown')
  })

  it('rejects an IP literal in a blocked range, including mapped IPv6', async () => {
    await expectCategory(downloadRemoteMedia('https://127.0.0.1/file.jpg'), 'blocked_address', '127.0.0.1')
    await expectCategory(
      downloadRemoteMedia('https://[::ffff:127.0.0.1]/file.jpg'),
      'blocked_address',
      '::ffff:7f00:1',
    )
  })

  it('rejects the whole hostname when any A or AAAA result is blocked', async () => {
    const resolver = jest.fn(async () => [
      { address: '93.184.216.34', family: 4 as const },
      { address: '127.0.0.1', family: 4 as const },
    ])
    const transport = createRequestSequence([{ statusCode: 200 }])

    await expectCategory(
      downloadRemoteMedia('https://media.example/file.jpg', {}, { resolve: resolver, request: transport.request }),
      'blocked_address',
      'media.example',
    )
    expect(transport.request).not.toHaveBeenCalled()
  })

  it('pins the verified address while retaining the original hostname for Host, SNI, and certificate checks', async () => {
    const transport = createRequestSequence([{
      statusCode: 200,
      headers: { 'content-type': 'image/jpeg' },
      chunks: ['jpeg'],
    }])
    const resolver = jest.fn(async () => [
      { address: '93.184.216.34', family: 4 as const },
      { address: '2606:4700:4700::1111', family: 6 as const },
    ])

    await downloadRemoteMedia(
      'https://media.example:8443/file.jpg?source=facebook',
      {},
      { resolve: resolver, request: transport.request },
    )

    expect(resolver).toHaveBeenCalledWith('media.example')
    const options = transport.request.mock.calls[0][0]
    expect(options).toMatchObject({
      hostname: 'media.example',
      port: 8443,
      servername: 'media.example',
      path: '/file.jpg?source=facebook',
      agent: false,
      maxRedirects: 0,
    })
    const lookupResult = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      options.lookup('media.example', {}, (error: Error | null, address: string, family: number) => {
        if (error) reject(error)
        else resolve({ address, family })
      })
    })
    expect(lookupResult).toEqual({ address: '93.184.216.34', family: 4 })
  })
})

describe('remote media redirects', () => {
  beforeEach(() => publicResolver.mockClear())

  it('resolves relative redirects and independently validates and pins every hop', async () => {
    const transport = createRequestSequence([
      { statusCode: 302, headers: { location: '../assets/final.PNG?token=SECRET' } },
      {
        statusCode: 200,
        headers: { 'content-type': 'image/png; charset=binary' },
        chunks: ['png'],
      },
    ])

    const result = await downloadRemoteMedia(
      'https://media.example/original/start',
      {},
      { resolve: publicResolver, request: transport.request },
    )

    expect(publicResolver).toHaveBeenCalledTimes(2)
    expect(transport.request.mock.calls.map((call) => call[0].path)).toEqual([
      '/original/start',
      '/assets/final.PNG?token=SECRET',
    ])
    expect(transport.request.mock.calls.every((call) => call[0].maxRedirects === 0)).toBe(true)
    expect(result).toMatchObject({
      buffer: Buffer.from('png'),
      mimeType: 'image/png',
      filename: 'final.png',
      host: 'media.example',
      finalUrl: 'https://media.example/assets/final.PNG?token=SECRET',
    })
  })

  it.each([
    ['http://cdn.example/file.jpg', 'protocol'],
    ['https://user:SECRET@cdn.example/file.jpg', 'credentials'],
  ])('rejects an unsafe redirect target %s', async (location, category) => {
    const transport = createRequestSequence([{ statusCode: 302, headers: { location } }])
    await expectCategory(
      downloadRemoteMedia('https://media.example/start', {}, { resolve: publicResolver, request: transport.request }),
      category,
      'cdn.example',
    )
  })

  it('rejects a redirect hostname when DNS includes a blocked result', async () => {
    const resolver = jest.fn(async (hostname: string) => hostname === 'media.example'
      ? [{ address: '93.184.216.34', family: 4 as const }]
      : [
          { address: '93.184.216.35', family: 4 as const },
          { address: '10.0.0.5', family: 4 as const },
        ])
    const transport = createRequestSequence([{
      statusCode: 302,
      headers: { location: 'https://cdn.example/file.jpg' },
    }])

    await expectCategory(
      downloadRemoteMedia('https://media.example/start', {}, { resolve: resolver, request: transport.request }),
      'blocked_address',
      'cdn.example',
    )
    expect(transport.request).toHaveBeenCalledTimes(1)
  })

  it('enforces the redirect limit before starting another request', async () => {
    const transport = createRequestSequence([
      { statusCode: 302, headers: { location: '/second' } },
      { statusCode: 307, headers: { location: '/third' } },
    ])
    await expectCategory(
      downloadRemoteMedia(
        'https://media.example/first',
        { maxRedirects: 1 },
        { resolve: publicResolver, request: transport.request },
      ),
      'redirect_limit',
      'media.example',
    )
    expect(transport.request).toHaveBeenCalledTimes(2)
  })

  it.each([
    [{}, 'redirect_location'],
    [{ location: 'http://[' }, 'redirect_location'],
  ])('classifies missing or invalid redirect Location safely', async (headers, category) => {
    const transport = createRequestSequence([{ statusCode: 302, headers }])
    const error = await expectCategory(
      downloadRemoteMedia(
        'https://media.example/start?token=QUERY',
        {},
        { resolve: publicResolver, request: transport.request },
      ),
      category,
      'media.example',
    )
    expect(String(error)).not.toContain('QUERY')
  })
})

describe('remote media response policy', () => {
  beforeEach(() => publicResolver.mockClear())

  it.each(['text/html', 'image/svg+xml', 'application/octet-stream'])('rejects disallowed MIME type %s', async (mimeType) => {
    const transport = createRequestSequence([{
      statusCode: 200,
      headers: { 'content-type': mimeType },
      chunks: ['not-safe-media'],
    }])
    await expectCategory(
      downloadRemoteMedia('https://media.example/file', {}, { resolve: publicResolver, request: transport.request }),
      'mime_type',
      'media.example',
    )
    expect(transport.responses[0].destroyed).toBe(true)
  })

  it('normalizes Content-Type parameters and accepts approved image and video formats', async () => {
    const imageTransport = createRequestSequence([{
      statusCode: 200,
      headers: { 'content-type': ' IMAGE/WEBP ; charset=binary' },
      chunks: ['webp'],
    }])
    const image = await downloadRemoteMedia(
      'https://media.example/file',
      {},
      { resolve: publicResolver, request: imageTransport.request },
    )
    expect(image).toMatchObject({ mimeType: 'image/webp', filename: 'file.webp' })

    const videoTransport = createRequestSequence([{
      statusCode: 200,
      headers: { 'content-type': 'video/mp4; codecs=avc1' },
      chunks: ['mp4'],
    }])
    const video = await downloadRemoteMedia(
      'https://media.example/movie.anything',
      {},
      { resolve: publicResolver, request: videoTransport.request },
    )
    expect(video).toMatchObject({ mimeType: 'video/mp4', filename: 'movie.mp4' })
  })

  it('rejects an oversized declared Content-Length before consuming the body', async () => {
    const transport = createRequestSequence([{
      statusCode: 200,
      headers: { 'content-type': 'image/jpeg', 'content-length': '6' },
      end: false,
    }])
    await expectCategory(
      downloadRemoteMedia(
        'https://media.example/file.jpg',
        { maxBytes: 5 },
        { resolve: publicResolver, request: transport.request },
      ),
      'size_limit',
      'media.example',
    )
    expect(transport.responses[0].destroyed).toBe(true)
  })

  it('streams and aborts as soon as an absent or forged length exceeds maxBytes', async () => {
    const transport = createRequestSequence([{
      statusCode: 200,
      headers: { 'content-type': 'image/jpeg', 'content-length': '2' },
      chunks: ['abc', 'def'],
    }])
    await expectCategory(
      downloadRemoteMedia(
        'https://media.example/file.jpg',
        { maxBytes: 5 },
        { resolve: publicResolver, request: transport.request },
      ),
      'size_limit',
      'media.example',
    )
    expect(transport.responses[0].destroyed).toBe(true)
    expect(transport.requests[0].destroy).toHaveBeenCalled()
  })

  it('returns a Buffer only after the response completes', async () => {
    const transport = createRequestSequence([{
      statusCode: 200,
      headers: { 'content-type': 'image/png' },
      chunks: ['partial'],
      end: false,
    }])
    let settled = false
    const pending = downloadRemoteMedia(
      'https://media.example/file.png',
      { totalTimeoutMs: 200 },
      { resolve: publicResolver, request: transport.request },
    ).finally(() => { settled = true })
    await new Promise((resolve) => setImmediate(resolve))
    expect(settled).toBe(false)
    transport.responses[0].end('-complete')
    await expect(pending).resolves.toMatchObject({ buffer: Buffer.from('partial-complete') })
  })

  it('redacts transport details and never exposes query strings, response bodies, or tokens in errors', async () => {
    const transport = createRequestSequence([{
      error: new Error('Authorization: Bearer TOKEN response=SECRET_BODY url=https://media.example/file?token=QUERY'),
    }])
    const error = await expectCategory(
      downloadRemoteMedia(
        'https://media.example/file?token=QUERY',
        {},
        { resolve: publicResolver, request: transport.request },
      ),
      'network',
      'media.example',
    )
    expect(String(error)).toBe('RemoteMediaDownloadError: remote_media_network host=media.example')
    expect(JSON.stringify(error)).not.toMatch(/TOKEN|SECRET_BODY|QUERY|Authorization/)
  })
})

describe('remote media timeouts and cancellation', () => {
  beforeEach(() => publicResolver.mockClear())

  it('bounds connection time and destroys the request', async () => {
    const transport = createRequestSequence([{ connect: false }])
    await expectCategory(
      downloadRemoteMedia(
        'https://media.example/file.jpg',
        { connectTimeoutMs: 15, responseTimeoutMs: 100, totalTimeoutMs: 200 },
        { resolve: publicResolver, request: transport.request },
      ),
      'connect_timeout',
      'media.example',
    )
    expect(transport.requests[0].destroy).toHaveBeenCalled()
  })

  it('bounds time to response after connection', async () => {
    const transport = createRequestSequence([{}])
    await expectCategory(
      downloadRemoteMedia(
        'https://media.example/file.jpg',
        { connectTimeoutMs: 100, responseTimeoutMs: 15, totalTimeoutMs: 200 },
        { resolve: publicResolver, request: transport.request },
      ),
      'response_timeout',
      'media.example',
    )
    expect(transport.requests[0].destroy).toHaveBeenCalled()
  })

  it('bounds total body time and destroys both response and request', async () => {
    const transport = createRequestSequence([{
      statusCode: 200,
      headers: { 'content-type': 'image/jpeg' },
      chunks: ['partial'],
      end: false,
    }])
    await expectCategory(
      downloadRemoteMedia(
        'https://media.example/file.jpg',
        { connectTimeoutMs: 100, responseTimeoutMs: 100, totalTimeoutMs: 20 },
        { resolve: publicResolver, request: transport.request },
      ),
      'total_timeout',
      'media.example',
    )
    expect(transport.requests[0].destroy).toHaveBeenCalled()
    expect(transport.responses[0].destroyed).toBe(true)
  })

  it('supports caller cancellation and cleans up active resources', async () => {
    const controller = new AbortController()
    const transport = createRequestSequence([{ connect: false }])
    const pending = downloadRemoteMedia(
      'https://media.example/file.jpg',
      { signal: controller.signal, totalTimeoutMs: 200 },
      { resolve: publicResolver, request: transport.request },
    )
    await new Promise((resolve) => setImmediate(resolve))
    controller.abort()
    await expectCategory(pending, 'cancelled', 'media.example')
    expect(transport.requests[0].destroy).toHaveBeenCalled()
  })

  it('clamps zero and non-finite limits instead of disabling protection', async () => {
    const transport = createRequestSequence([
      { statusCode: 302, headers: { location: '/second' } },
      { statusCode: 302, headers: { location: '/third' } },
      { statusCode: 302, headers: { location: '/fourth' } },
      { statusCode: 302, headers: { location: '/fifth' } },
    ])
    await expectCategory(
      downloadRemoteMedia(
        'https://media.example/start',
        { maxRedirects: Number.POSITIVE_INFINITY, maxBytes: 0, totalTimeoutMs: Number.POSITIVE_INFINITY },
        { resolve: publicResolver, request: transport.request },
      ),
      'redirect_limit',
      'media.example',
    )
    expect(transport.request).toHaveBeenCalledTimes(4)

    const bodyTransport = createRequestSequence([{
      statusCode: 200,
      headers: { 'content-type': 'image/jpeg' },
      chunks: ['not-zero'],
    }])
    await expect(downloadRemoteMedia(
      'https://media.example/file.jpg',
      { maxBytes: 0 },
      { resolve: publicResolver, request: bodyTransport.request },
    )).resolves.toMatchObject({ buffer: Buffer.from('not-zero') })
  })
})

describe('safe media filename', () => {
  it('removes traversal, controls, query strings, and dangerous extension chains', () => {
    const filename = createSafeMediaFilename(
      new URL('https://media.example/path/%00secret.php.exe?token=SECRET'),
      'image/jpeg',
    )
    expect(filename).toBe('secret_php.jpg')
    expect(filename).not.toMatch(/[\\/?\u0000-\u001f]/)
    expect(filename).not.toContain('SECRET')
  })

  it('provides a fallback for an empty path and forces the approved MIME extension', () => {
    expect(createSafeMediaFilename(new URL('https://media.example/'), 'image/png')).toBe('media.png')
    expect(createSafeMediaFilename(new URL('https://media.example/avatar.svg'), 'image/webp')).toBe('avatar.webp')
  })

  it('preserves safe Unicode, normalizes whitespace, and handles multi-dot names', () => {
    expect(createSafeMediaFilename(
      new URL('https://media.example/%E7%B4%A0%E6%9D%90%20%E6%9C%80%E7%BB%88%E7%89%88.PNG'),
      'image/png',
    )).toBe('素材_最终版.png')
    expect(createSafeMediaFilename(new URL('https://media.example/avatar.php.exe'), 'image/jpeg')).toBe('avatar_php.jpg')
  })

  it('limits the UTF-8 filename length without splitting Unicode characters', () => {
    const filename = createSafeMediaFilename(
      new URL(`https://media.example/${encodeURIComponent('图'.repeat(200))}.png`),
      'image/png',
    )
    expect(Buffer.byteLength(filename)).toBeLessThanOrEqual(120)
    expect(filename).toMatch(/\.png$/)
    expect(filename).not.toContain('\uFFFD')
  })
})
