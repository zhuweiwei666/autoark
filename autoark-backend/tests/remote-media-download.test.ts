import dns from 'dns'
import { EventEmitter } from 'events'
import https from 'https'
import type { ClientRequest, IncomingMessage } from 'http'
import type { AddressInfo } from 'net'
import { PassThrough } from 'stream'
import type { TLSSocket } from 'tls'
import {
  createRemoteMediaDownloaderForTesting,
  createSafeMediaFilename,
  downloadRemoteMedia as defaultDownloadRemoteMedia,
  isPublicIpAddress,
  RemoteMediaDownloadError,
  type RemoteMediaDownloadDependencies,
} from '../src/services/remoteMediaDownload.service'

// TEST-ONLY certificate authority and server identity. These credentials protect no real system.
const TEST_ONLY_CA = `-----BEGIN CERTIFICATE-----
MIIDQTCCAimgAwIBAgIUHb+rkbv2tL14f9s9TyY0QGEglr0wDQYJKoZIhvcNAQEL
BQAwJzElMCMGA1UEAwwcQXV0b0FyayBSZW1vdGUgTWVkaWEgVGVzdCBDQTAgFw0y
NjA3MjIxMjA5MTdaGA8yMTI2MDYyODEyMDkxN1owJzElMCMGA1UEAwwcQXV0b0Fy
ayBSZW1vdGUgTWVkaWEgVGVzdCBDQTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCC
AQoCggEBALVUSNGD/Y93tPa59ogDRVfl2ycCHN3u5co8zRa9HZWvPOi3eJHK4pdG
7To++39vfMBvIEsHdZdJ17aWWSxuOCrFu8ud240qz6LWjx2d0uGpLN/Al932CUIW
QN3Ei2PgFyMOJIYHu6y+uh+G5UJFA1V+fwdLGDP5l1OhBqTnx1IcDSMjXBE2aTUC
b+BeG+de1j/DS3tr2wPpUMb5Nydx12AK00Ogjc0GM+mUHVlWwImkz+Nf2nq4qml5
XJy9Z0x7r1Lw2/vqQyuT/FRgYCbZoPoEw7wuzyWScxuiAL9Fiob3ducdDmRFdW5B
0P8mq1X7z0AuM+RnFoLBhAJCJICpjgUCAwEAAaNjMGEwHQYDVR0OBBYEFHjQEMUh
XHJBX5Nmh3s+ne3NNHiaMB8GA1UdIwQYMBaAFHjQEMUhXHJBX5Nmh3s+ne3NNHia
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMA0GCSqGSIb3DQEBCwUA
A4IBAQAcb6E4k+ASsgb5js/0GnI3gqbebVTZXI3iQ4DMf1+EmDOvjtu2lFLy6iR4
MDq6iMPrEVHBG44YwCJSQdDBWGLDFHns97xLiQ/8iKTdPRNs1EXRowGLPOmbmfFd
Yefns7UE3HvHIICOHgVm6OVhGxRO3IC4mEr9/gXNMeVXsi52RwT8yuoIXyZCV51f
bnG4kNP4J4LCC7Fp8MJbSrgV6FR4wwJvykX6xneRJOiiHBhHB5sY40l6q7t5gOkr
T04EoOXt/DlSydvLt0n+enokxny4yQ1YCuUwjI1eg+Gt9EGXudMo7fGCvZU7iX3a
RDsgFIqNiOwelyb8hSrWPp4roLUx
-----END CERTIFICATE-----`

const TEST_ONLY_SERVER_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQC2sPSJGrF7jCj4
iQsZt5/XOte0DO8reTuD1lWwyP5s2beknF7gGlas/Atcnq/fFGhQVYJB9rpYeh7t
uY4Dh312SF0Iui1muIpQ7RD/YMQx2BDo0Tv55ZG2p6slQhWcmrAoKPQCEiMcrl3v
cXyd9nFHxWzfvdrq7RSizfhYnJF/NU526JXjPrZ9YmZiuJNnZT6wmP6fli2Cd07a
3kp4PrEPRgSz+G8X2DMFyWKw4WYdAdzhsgv/rDn/pCNagROSbifqkfB+7odyRBFJ
Y++ZuNWRvxzBzU9pNnc9owIl6WiXRLg7cihUKVx2aMqyKPK9YDIGzMoyqaVcO81z
xQ+PamatAgMBAAECggEAPZXMcVV+xAu9Gf80r0Av0WHEKi18CJcvIWPE8jnnTrFc
D1EpSHmIg3rZp6jU16os+fvBU9RFACN2vqOhBH6NpCyDtDfyqyCFe/9WjghESxsv
pBQ4mCaz5rOB5abv2yFoRbl8fCA6FuaOwvNqU2Oqz0t1xrzdCfnOzY0KbXCmOY+e
ipn3pDmQF98NULNVXRdh+KqyalL1S874Yx8zsXOmKbF29mk2+UcXsq7FsJ4xYC/B
c4xzVd2rDhSEI8h5tT40htDBvbz4+jJDK1ICBlIoazPJj23YfaKMVYupJI4aJSg2
FNC4YzyC4o0a9wMbRJlIa3x9AwJczywebtpgNpEjvwKBgQD95fjLd+WGAru4St1I
uciusnmgxildDqswLIb/7AS82+kz/yWG0Z/5KzsP7niS7hBxvkLMnd+qX5XAdHsx
jPbqAUQ8u4aGFsiFXxsfkZohA+4o3AH2Mnep14/xel4wE7FKE9UpRWw+X2Vz7CQv
WGLSdmQioPFPAJaXGSDzXZorMwKBgQC4NBcxEPTlBuUH71+avm2dSfYx20lNc3Da
cjS0SIEVVN9fFcx9NdnwCA4f91xN96mknwYRYZcnjcCwSfcOfgBfZ7oq7MWMwrJe
hoHI+hFb/cGaEtG3gi4wXKXiWJLO75p2ExgGmIjMRNGxBz6fdvG3Rg1NrBzFAI/A
M3QwTMAmnwKBgHhTi9RJzxHyq6pMeJCl03DPjorePu4mLIUZJSWWYixrABsvWUaK
hAkfLs9/Ec94WXy+UYQNcdmZkSvzSAsUplQCI6ewq7FSjNeAWidc5rGs3iqpEZjv
E/z+9u3XM1oPix7zRTtY9lKc/USx7fguKC9cAlrS8WmiervDIfWUL6M3AoGAat+O
NSGpdNgzOg9gYN/rqT6oYPTh6tX3vEZW3eLTQhUkJH75TgxYjjOePl2+aF4xRxoc
4yjEEmbkTWQcu4PPo4sDMLR/SdQMuVtBIeI1ADKSiVox407cjaKzfEf3pajO7YLW
hb0qYZnsL9IMO2k/hR5XyaD6cDKLNPClkQB22/ECgYBE9ulGpFBNGYMfgQ8F1KPV
MVfSNFDvlaUVyWA1o/KcQSAWLzXmWXRS2OWVmGEN2lBL80+WWQmV37Naqtnm/EDO
EWY4v3t1mHIuLyaCzpULmXN2WlGpfX/Uc5ouZ1met17U6ewPEZmXtcXvzI+kEoM7
5mzpfCEHiNzvmR+9s6VXyQ==
-----END PRIVATE KEY-----`

const TEST_ONLY_SERVER_CERT = `-----BEGIN CERTIFICATE-----
MIIDbTCCAlWgAwIBAgIUWIx5+SrS9+OfFM3UkzhEt9mNeRswDQYJKoZIhvcNAQEL
BQAwJzElMCMGA1UEAwwcQXV0b0FyayBSZW1vdGUgTWVkaWEgVGVzdCBDQTAgFw0y
NjA3MjIxMjA5MTdaGA8yMTI2MDYyODEyMDkxN1owHDEaMBgGA1UEAwwRbWVkaWEt
b25lLmludmFsaWQwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC2sPSJ
GrF7jCj4iQsZt5/XOte0DO8reTuD1lWwyP5s2beknF7gGlas/Atcnq/fFGhQVYJB
9rpYeh7tuY4Dh312SF0Iui1muIpQ7RD/YMQx2BDo0Tv55ZG2p6slQhWcmrAoKPQC
EiMcrl3vcXyd9nFHxWzfvdrq7RSizfhYnJF/NU526JXjPrZ9YmZiuJNnZT6wmP6f
li2Cd07a3kp4PrEPRgSz+G8X2DMFyWKw4WYdAdzhsgv/rDn/pCNagROSbifqkfB+
7odyRBFJY++ZuNWRvxzBzU9pNnc9owIl6WiXRLg7cihUKVx2aMqyKPK9YDIGzMoy
qaVcO81zxQ+PamatAgMBAAGjgZkwgZYwLwYDVR0RBCgwJoIRbWVkaWEtb25lLmlu
dmFsaWSCEW1lZGlhLXR3by5pbnZhbGlkMA4GA1UdDwEB/wQEAwIFoDATBgNVHSUE
DDAKBggrBgEFBQcDATAdBgNVHQ4EFgQU3izeqvkKV0ESxZFCoIk6ckl8B/4wHwYD
VR0jBBgwFoAUeNAQxSFcckFfk2aHez6d7c00eJowDQYJKoZIhvcNAQELBQADggEB
AHNdOoDpmiDZBm/fi3lvy9/PbcASmrTMndoF4/Hh4Y9brUuwRe8iiYuoEBnVx1/L
JqzKsdWse5N8YfLk/nBcsxRLaIhBJ4/1TYTqi7ujuXfP/kaB96tu9qdu+tYIQCOL
S0BVsPGSIyzrLUmnpfkfpXySIuHmKnW5o0Rri+O31RVygR+/XdAbWUXe9oHHrKuv
AfuA8V915fFaCRWQ9bilzCPlzRsbBiKO6z15eno3wCCJhffUSjVYSHjKLnBCAZo4
DqyyxYilESl1qd8gzbeyhIN89eqvppbFNFRoHqVJQdTWwWXjsoaQsGdbvLj95PDo
hutJp47alfNpTF3CeoWTIVo=
-----END CERTIFICATE-----`

const isoBmffPayload = (brand: string, compatibleBrands: string[] = []) =>
  Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x10 + compatibleBrands.length * 4]),
    Buffer.from('ftyp'),
    Buffer.from(brand, 'ascii'),
    Buffer.alloc(4),
    ...compatibleBrands.map((compatibleBrand) =>
      Buffer.from(compatibleBrand, 'ascii'),
    ),
  ])

const VALID_MEDIA_PAYLOADS = [
  { mimeType: 'image/jpeg', bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
  {
    mimeType: 'image/png',
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  { mimeType: 'image/gif', bytes: Buffer.from('GIF89a', 'ascii') },
  {
    mimeType: 'image/webp',
    bytes: Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.alloc(4),
      Buffer.from('WEBP', 'ascii'),
    ]),
  },
  { mimeType: 'image/avif', bytes: isoBmffPayload('avif') },
  { mimeType: 'image/heic', bytes: isoBmffPayload('heic') },
  { mimeType: 'image/heif', bytes: isoBmffPayload('mif1') },
  { mimeType: 'image/bmp', bytes: Buffer.from('BM', 'ascii') },
  { mimeType: 'image/tiff', bytes: Buffer.from([0x49, 0x49, 0x2a, 0x00]) },
  { mimeType: 'video/mp4', bytes: isoBmffPayload('isom') },
  {
    mimeType: 'video/webm',
    bytes: Buffer.from([
      0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d,
    ]),
  },
  { mimeType: 'video/quicktime', bytes: isoBmffPayload('qt  ') },
  { mimeType: 'video/mpeg', bytes: Buffer.from([0x00, 0x00, 0x01, 0xb3]) },
  { mimeType: 'video/ogg', bytes: Buffer.from('OggS', 'ascii') },
  {
    mimeType: 'video/x-msvideo',
    bytes: Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.alloc(4),
      Buffer.from('AVI ', 'ascii'),
    ]),
  },
  {
    mimeType: 'video/x-matroska',
    bytes: Buffer.concat([
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x82, 0x88]),
      Buffer.from('matroska', 'ascii'),
    ]),
  },
] as const

const payloadFor = (mimeType: string): Buffer => {
  const fixture = VALID_MEDIA_PAYLOADS.find(
    (entry) => entry.mimeType === mimeType,
  )
  if (!fixture) throw new Error(`missing test payload for ${mimeType}`)
  return fixture.bytes
}

const downloadRemoteMedia = (
  input: string,
  options: Parameters<typeof defaultDownloadRemoteMedia>[1] = {},
  dependencies?: RemoteMediaDownloadDependencies,
) =>
  dependencies
    ? createRemoteMediaDownloaderForTesting(dependencies)(input, options)
    : defaultDownloadRemoteMedia(input, options)

type ResponseStep = {
  statusCode?: number
  headers?: Record<string, string | string[] | undefined>
  chunks?: Array<string | Buffer>
  end?: boolean
  error?: Error
  connect?: boolean
}

const createRequestSequence = (steps: ResponseStep[]) => {
  type FakeRequest = EventEmitter & {
    destroyed: boolean
    destroy: jest.Mock
    end: jest.Mock
  }
  type FakeResponse = PassThrough & IncomingMessage

  const requests: FakeRequest[] = []
  const responses: FakeResponse[] = []
  const requestImplementation: NonNullable<
    RemoteMediaDownloadDependencies['request']
  > = (_options, onResponse) => {
    const step = steps[requests.length] || {}
    const req = new EventEmitter() as FakeRequest
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

        const response = new PassThrough() as FakeResponse
        response.statusCode = step.statusCode
        response.headers = step.headers || {}
        responses.push(response)
        onResponse(response)
        for (const chunk of step.chunks || []) response.write(chunk)
        if (step.end !== false) response.end()
      })
    })
    requests.push(req)
    return req as unknown as ClientRequest
  }
  const request = jest.fn(requestImplementation)

  return { request, requests, responses }
}

const publicResolver = jest.fn(async () => [
  { address: '93.184.216.34', family: 4 as const },
])

const expectCategory = async (
  promise: Promise<unknown>,
  category: string,
  host?: string,
) => {
  try {
    await promise
    throw new Error('expected download to reject')
  } catch (error) {
    expect(error).toBeInstanceOf(RemoteMediaDownloadError)
    expect((error as RemoteMediaDownloadError).category).toBe(category)
    if (host !== undefined)
      expect((error as RemoteMediaDownloadError).host).toBe(host)
    return error as RemoteMediaDownloadError
  }
}

describe('remote media real TLS pinning', () => {
  const firstHostname = 'media-one.invalid'
  const secondHostname = 'media-two.invalid'
  const wrongHostname = 'media-wrong.invalid'
  const received: Array<{
    host: string | undefined
    servername: string | false
  }> = []
  let server: https.Server
  let port: number

  beforeAll(async () => {
    server = https.createServer(
      { key: TEST_ONLY_SERVER_KEY, cert: TEST_ONLY_SERVER_CERT },
      (request, response) => {
        received.push({
          host: request.headers.host,
          servername: (request.socket as TLSSocket).servername,
        })
        if (
          request.headers.host === `${firstHostname}:${port}` &&
          request.url === '/start'
        ) {
          response.writeHead(302, {
            location: `https://${secondHostname}:${port}/final.png`,
          })
          response.end()
          return
        }
        if (request.url?.startsWith('/encoded.png')) {
          response.writeHead(200, {
            'content-type': 'image/png',
            'content-encoding': 'gzip',
          })
          response.end('not-actually-compressed')
          return
        }
        if (request.url === '/premature.png') {
          response.writeHead(200, {
            'content-type': 'image/png',
            'content-length': String(payloadFor('image/png').length + 20),
          })
          response.write(payloadFor('image/png').subarray(0, 4))
          response.socket?.destroy()
          return
        }
        response.writeHead(200, { 'content-type': 'image/png' })
        response.end(payloadFor('image/png'))
      },
    )
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  })

  beforeEach(() => {
    received.length = 0
  })

  const createRealTlsDependencies = () => {
    const resolve = jest.fn(async () => [
      { address: '127.0.0.1', family: 4 as const },
    ])
    const dependencies = {
      resolve,
      isPublicAddress: () => true,
      request: ((
        options: https.RequestOptions,
        onResponse: (response: IncomingMessage) => void,
      ) =>
        https.request(
          { ...options, ca: TEST_ONLY_CA },
          onResponse,
        )) as NonNullable<RemoteMediaDownloadDependencies['request']>,
    } as RemoteMediaDownloadDependencies
    return { dependencies, resolve }
  }

  it('uses the pinned lookup with original Host and SNI on every real TLS redirect hop', async () => {
    await expect(dns.promises.lookup(firstHostname)).rejects.toMatchObject({
      code: 'ENOTFOUND',
    })
    await expect(dns.promises.lookup(secondHostname)).rejects.toMatchObject({
      code: 'ENOTFOUND',
    })
    const { dependencies, resolve } = createRealTlsDependencies()

    const result = await downloadRemoteMedia(
      `https://${firstHostname}:${port}/start`,
      {},
      dependencies,
    )

    expect(result).toMatchObject({
      buffer: payloadFor('image/png'),
      mimeType: 'image/png',
      filename: 'final.png',
      host: secondHostname,
    })
    expect(resolve.mock.calls).toEqual([[firstHostname], [secondHostname]])
    expect(received).toEqual([
      { host: `${firstHostname}:${port}`, servername: firstHostname },
      { host: `${secondHostname}:${port}`, servername: secondHostname },
    ])
  })

  it('rejects a CA-trusted certificate whose hostname does not match', async () => {
    const { dependencies } = createRealTlsDependencies()

    await expectCategory(
      downloadRemoteMedia(
        `https://${wrongHostname}:${port}/file.png`,
        {},
        dependencies,
      ),
      'network',
      wrongHostname,
    )
    expect(received).toEqual([])
  })

  it('rejects hostile Content-Encoding through the real Node HTTPS stack', async () => {
    const { dependencies } = createRealTlsDependencies()

    await expectCategory(
      downloadRemoteMedia(
        `https://${firstHostname}:${port}/encoded.png?token=QUERY`,
        {},
        dependencies,
      ),
      'content_encoding',
      firstHostname,
    )
  })

  it('rejects a premature close through the real Node HTTPS stack', async () => {
    const { dependencies } = createRealTlsDependencies()

    await expectCategory(
      downloadRemoteMedia(
        `https://${firstHostname}:${port}/premature.png`,
        {},
        dependencies,
      ),
      'network',
      firstHostname,
    )
  })
})

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

  it.each([
    '1.1.1.1',
    '8.8.8.8',
    '93.184.216.34',
    '2001:4860:4860::8888',
    '2606:4700:4700::1111',
  ])('accepts globally routable address %s', (address) => {
    expect(isPublicIpAddress(address)).toBe(true)
  })

  it('rejects non-HTTPS, credentialed, malformed URL, and malformed hostname inputs', async () => {
    await expectCategory(
      downloadRemoteMedia('http://media.example/file.jpg'),
      'protocol',
      'media.example',
    )
    const credentialError = await expectCategory(
      downloadRemoteMedia(
        'https://user:SECRET@media.example/file.jpg?token=QUERY',
      ),
      'credentials',
      'media.example',
    )
    expect(String(credentialError)).not.toContain('SECRET')
    expect(String(credentialError)).not.toContain('QUERY')
    await expectCategory(
      downloadRemoteMedia('https://[::1'),
      'invalid_url',
      'unknown',
    )
    await expectCategory(
      downloadRemoteMedia('https://bad_host.example/file.jpg'),
      'invalid_host',
      'unknown',
    )
  })

  it('rejects an IP literal in a blocked range, including mapped IPv6', async () => {
    await expectCategory(
      downloadRemoteMedia('https://127.0.0.1/file.jpg'),
      'blocked_address',
      '127.0.0.1',
    )
    await expectCategory(
      downloadRemoteMedia('https://[::ffff:127.0.0.1]/file.jpg'),
      'blocked_address',
      '::ffff:7f00:1',
    )
  })

  it('does not allow the normal downloader entrypoint to accept trusted dependency seams', async () => {
    const transport = createRequestSequence([
      {
        statusCode: 200,
        headers: { 'content-type': 'image/jpeg' },
        chunks: [payloadFor('image/jpeg')],
      },
    ])
    const unsafeThirdArgument = {
      isPublicAddress: () => true,
      request: transport.request,
    }
    const invokeWithExtraArguments = defaultDownloadRemoteMedia as unknown as (
      input: string,
      options: Record<string, never>,
      dependencies: typeof unsafeThirdArgument,
    ) => Promise<unknown>

    await expectCategory(
      invokeWithExtraArguments(
        'https://127.0.0.1/file.jpg',
        {},
        unsafeThirdArgument,
      ),
      'blocked_address',
      '127.0.0.1',
    )
    expect(transport.request).not.toHaveBeenCalled()
  })

  it('rejects the whole hostname when any A or AAAA result is blocked', async () => {
    const resolver = jest.fn(async () => [
      { address: '93.184.216.34', family: 4 as const },
      { address: '127.0.0.1', family: 4 as const },
    ])
    const transport = createRequestSequence([{ statusCode: 200 }])

    await expectCategory(
      downloadRemoteMedia(
        'https://media.example/file.jpg',
        {},
        { resolve: resolver, request: transport.request },
      ),
      'blocked_address',
      'media.example',
    )
    expect(transport.request).not.toHaveBeenCalled()
  })

  it('pins the verified address while retaining the original hostname for Host, SNI, and certificate checks', async () => {
    const transport = createRequestSequence([
      {
        statusCode: 200,
        headers: { 'content-type': 'image/jpeg' },
        chunks: [payloadFor('image/jpeg')],
      },
    ])
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
    const lookupResult = await new Promise<{ address: string; family: number }>(
      (resolve, reject) => {
        options.lookup(
          'media.example',
          {},
          (error: Error | null, address: string, family: number) => {
            if (error) reject(error)
            else resolve({ address, family })
          },
        )
      },
    )
    expect(lookupResult).toEqual({ address: '93.184.216.34', family: 4 })
  })
})

describe('remote media redirects', () => {
  beforeEach(() => publicResolver.mockClear())

  it('resolves relative redirects and independently validates and pins every hop', async () => {
    const transport = createRequestSequence([
      {
        statusCode: 302,
        headers: {
          location: '../assets/final.PNG?token=SECRET#signed-fragment',
        },
      },
      {
        statusCode: 200,
        headers: { 'content-type': 'image/png; charset=binary' },
        chunks: [payloadFor('image/png')],
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
    expect(
      transport.request.mock.calls.every((call) => call[0].maxRedirects === 0),
    ).toBe(true)
    expect(result).toMatchObject({
      buffer: payloadFor('image/png'),
      mimeType: 'image/png',
      filename: 'final.png',
      host: 'media.example',
    })
    expect(result).not.toHaveProperty('finalUrl')
    expect(JSON.stringify(result)).not.toMatch(/SECRET|signed-fragment/)
  })

  it.each([
    ['http://cdn.example/file.jpg', 'protocol'],
    ['https://user:SECRET@cdn.example/file.jpg', 'credentials'],
  ])('rejects an unsafe redirect target %s', async (location, category) => {
    const transport = createRequestSequence([
      { statusCode: 302, headers: { location } },
    ])
    await expectCategory(
      downloadRemoteMedia(
        'https://media.example/start',
        {},
        { resolve: publicResolver, request: transport.request },
      ),
      category,
      'cdn.example',
    )
  })

  it('rejects a redirect hostname when DNS includes a blocked result', async () => {
    const resolver = jest.fn(async (hostname: string) =>
      hostname === 'media.example'
        ? [{ address: '93.184.216.34', family: 4 as const }]
        : [
            { address: '93.184.216.35', family: 4 as const },
            { address: '10.0.0.5', family: 4 as const },
          ],
    )
    const transport = createRequestSequence([
      {
        statusCode: 302,
        headers: { location: 'https://cdn.example/file.jpg' },
      },
    ])

    await expectCategory(
      downloadRemoteMedia(
        'https://media.example/start',
        {},
        { resolve: resolver, request: transport.request },
      ),
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
  ])(
    'classifies missing or invalid redirect Location safely',
    async (headers, category) => {
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
    },
  )
})

describe('remote media response policy', () => {
  beforeEach(() => publicResolver.mockClear())

  it.each([
    'gzip',
    'br',
    'deflate',
    'GZIP',
    'gzip, br',
    'identity, gzip',
    'identity; q=1',
  ])(
    'rejects non-identity Content-Encoding %s before reading the body',
    async (encoding) => {
      const transport = createRequestSequence([
        {
          statusCode: 200,
          headers: {
            'content-type': 'image/jpeg',
            'content-encoding': encoding,
          },
          chunks: [payloadFor('image/jpeg')],
          end: false,
        },
      ])
      const error = await expectCategory(
        downloadRemoteMedia(
          'https://media.example/file.jpg?token=QUERY',
          { totalTimeoutMs: 30 },
          { resolve: publicResolver, request: transport.request },
        ),
        'content_encoding',
        'media.example',
      )
      expect(transport.responses[0].destroyed).toBe(true)
      expect(String(error)).not.toMatch(/QUERY|gzip|br|deflate/i)
    },
  )

  it.each([undefined, '', '   ', 'identity', 'IDENTITY'])(
    'allows absent, empty, or identity Content-Encoding %s',
    async (encoding) => {
      const transport = createRequestSequence([
        {
          statusCode: 200,
          headers: {
            'content-type': 'image/jpeg',
            ...(encoding === undefined ? {} : { 'content-encoding': encoding }),
          },
          chunks: [payloadFor('image/jpeg')],
        },
      ])
      await expect(
        downloadRemoteMedia(
          'https://media.example/file.jpg',
          {},
          { resolve: publicResolver, request: transport.request },
        ),
      ).resolves.toMatchObject({ mimeType: 'image/jpeg' })
    },
  )

  it.each(['text/html', 'image/svg+xml', 'application/octet-stream'])(
    'rejects disallowed MIME type %s',
    async (mimeType) => {
      const transport = createRequestSequence([
        {
          statusCode: 200,
          headers: { 'content-type': mimeType },
          chunks: ['not-safe-media'],
        },
      ])
      await expectCategory(
        downloadRemoteMedia(
          'https://media.example/file',
          {},
          { resolve: publicResolver, request: transport.request },
        ),
        'mime_type',
        'media.example',
      )
      expect(transport.responses[0].destroyed).toBe(true)
    },
  )

  it('normalizes Content-Type parameters and accepts approved image and video formats', async () => {
    const imageTransport = createRequestSequence([
      {
        statusCode: 200,
        headers: { 'content-type': ' IMAGE/WEBP ; charset=binary' },
        chunks: [payloadFor('image/webp')],
      },
    ])
    const image = await downloadRemoteMedia(
      'https://media.example/file',
      {},
      { resolve: publicResolver, request: imageTransport.request },
    )
    expect(image).toMatchObject({
      mimeType: 'image/webp',
      filename: 'file.webp',
    })

    const videoTransport = createRequestSequence([
      {
        statusCode: 200,
        headers: { 'content-type': 'video/mp4; codecs=avc1' },
        chunks: [payloadFor('video/mp4')],
      },
    ])
    const video = await downloadRemoteMedia(
      'https://media.example/movie.anything',
      {},
      { resolve: publicResolver, request: videoTransport.request },
    )
    expect(video).toMatchObject({
      mimeType: 'video/mp4',
      filename: 'movie.mp4',
    })
  })

  it.each(VALID_MEDIA_PAYLOADS)(
    'accepts a valid minimal magic signature for $mimeType',
    async ({ mimeType, bytes }) => {
      const transport = createRequestSequence([
        {
          statusCode: 200,
          headers: { 'content-type': mimeType },
          chunks: [bytes],
        },
      ])

      await expect(
        downloadRemoteMedia(
          'https://media.example/file',
          {},
          { resolve: publicResolver, request: transport.request },
        ),
      ).resolves.toMatchObject({ buffer: bytes, mimeType })
    },
  )

  it.each([
    ['image/heic', 'heic major brand', isoBmffPayload('heic')],
    ['image/heic', 'heix major brand', isoBmffPayload('heix')],
    ['image/heic', 'heim major brand', isoBmffPayload('heim')],
    ['image/heic', 'heis major brand', isoBmffPayload('heis')],
    ['image/heic', 'heic compatible brand', isoBmffPayload('mif1', ['heic'])],
    ['image/heic', 'heix compatible brand', isoBmffPayload('mif1', ['heix'])],
    ['image/heic', 'heim compatible brand', isoBmffPayload('mif1', ['heim'])],
    ['image/heic', 'heis compatible brand', isoBmffPayload('mif1', ['heis'])],
    ['image/heif', 'mif1 major brand', isoBmffPayload('mif1')],
    ['image/heif', 'mif1 compatible brand', isoBmffPayload('zzzz', ['mif1'])],
    ['image/avif', 'AVIF compatible brand', isoBmffPayload('mif1', ['avif'])],
    ['video/mp4', 'MP4 compatible brand', isoBmffPayload('zzzz', ['mp42'])],
  ])('accepts %s: %s', async (mimeType, _brandCase, bytes) => {
    const transport = createRequestSequence([
      {
        statusCode: 200,
        headers: { 'content-type': mimeType },
        chunks: [bytes],
      },
    ])

    await expect(
      downloadRemoteMedia(
        'https://media.example/file',
        {},
        { resolve: publicResolver, request: transport.request },
      ),
    ).resolves.toMatchObject({ buffer: bytes, mimeType })
  })

  it.each([
    ['image/heic', 'hevc major sequence brand', isoBmffPayload('hevc')],
    ['image/heic', 'hevx major sequence brand', isoBmffPayload('hevx')],
    [
      'image/heic',
      'hevc compatible sequence brand',
      isoBmffPayload('mif1', ['hevc']),
    ],
    [
      'image/heic',
      'hevx compatible sequence brand',
      isoBmffPayload('mif1', ['hevx']),
    ],
    ['image/heif', 'msf1 major sequence brand', isoBmffPayload('msf1')],
    [
      'image/heif',
      'msf1 compatible sequence brand',
      isoBmffPayload('zzzz', ['msf1']),
    ],
  ])('rejects %s: %s', async (mimeType, _brandCase, bytes) => {
    const transport = createRequestSequence([
      {
        statusCode: 200,
        headers: { 'content-type': mimeType },
        chunks: [bytes],
      },
    ])

    await expectCategory(
      downloadRemoteMedia(
        'https://media.example/file',
        {},
        { resolve: publicResolver, request: transport.request },
      ),
      'media_signature',
      'media.example',
    )
  })

  it('ignores compatible brands beyond the documented bounded ftyp scan window', async () => {
    const oversizedFtyp = Buffer.alloc(2 * 1024 * 1024)
    oversizedFtyp.writeUInt32BE(oversizedFtyp.length, 0)
    oversizedFtyp.write('ftyp', 4, 'ascii')
    oversizedFtyp.write('zzzz', 8, 'ascii')
    oversizedFtyp.write('avif', oversizedFtyp.length - 4, 'ascii')
    const transport = createRequestSequence([
      {
        statusCode: 200,
        headers: { 'content-type': 'image/avif' },
        chunks: [oversizedFtyp],
      },
    ])

    await expectCategory(
      downloadRemoteMedia(
        'https://media.example/large.avif',
        {},
        { resolve: publicResolver, request: transport.request },
      ),
      'media_signature',
      'media.example',
    )
  })

  it.each([
    {
      name: 'JPEG prefix followed by non-JPEG bytes',
      mimeType: 'image/jpeg',
      bytes: Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        Buffer.from('not-jpeg'),
      ]),
    },
    {
      name: 'MIME and signature mismatch',
      mimeType: 'image/png',
      bytes: payloadFor('image/jpeg'),
    },
    {
      name: 'truncated signature',
      mimeType: 'image/png',
      bytes: payloadFor('image/png').subarray(0, 7),
    },
  ])(
    'rejects $name after fully collecting the body',
    async ({ mimeType, bytes }) => {
      const transport = createRequestSequence([
        {
          statusCode: 200,
          headers: { 'content-type': mimeType },
          chunks: [bytes],
        },
      ])

      await expectCategory(
        downloadRemoteMedia(
          'https://media.example/file?signature=SECRET',
          {},
          { resolve: publicResolver, request: transport.request },
        ),
        'media_signature',
        'media.example',
      )
    },
  )

  it('rejects an oversized declared Content-Length before consuming the body', async () => {
    const transport = createRequestSequence([
      {
        statusCode: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': '6' },
        end: false,
      },
    ])
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
    const transport = createRequestSequence([
      {
        statusCode: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': '2' },
        chunks: ['abc', 'def'],
      },
    ])
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
    const transport = createRequestSequence([
      {
        statusCode: 200,
        headers: { 'content-type': 'image/png' },
        chunks: [payloadFor('image/png').subarray(0, 4)],
        end: false,
      },
    ])
    let settled = false
    const pending = downloadRemoteMedia(
      'https://media.example/file.png',
      { totalTimeoutMs: 200 },
      { resolve: publicResolver, request: transport.request },
    ).finally(() => {
      settled = true
    })
    await new Promise((resolve) => setImmediate(resolve))
    expect(settled).toBe(false)
    transport.responses[0].end(payloadFor('image/png').subarray(4))
    await expect(pending).resolves.toMatchObject({
      buffer: payloadFor('image/png'),
    })
  })

  it('redacts transport details and never exposes query strings, response bodies, or tokens in errors', async () => {
    const transport = createRequestSequence([
      {
        error: new Error(
          'Authorization: Bearer TOKEN response=SECRET_BODY url=https://media.example/file?token=QUERY',
        ),
      },
    ])
    const error = await expectCategory(
      downloadRemoteMedia(
        'https://media.example/file?token=QUERY',
        {},
        { resolve: publicResolver, request: transport.request },
      ),
      'network',
      'media.example',
    )
    expect(String(error)).toBe(
      'RemoteMediaDownloadError: remote_media_network host=media.example',
    )
    expect(JSON.stringify(error)).not.toMatch(
      /TOKEN|SECRET_BODY|QUERY|Authorization/,
    )
  })
})

describe('remote media timeouts and cancellation', () => {
  beforeEach(() => publicResolver.mockClear())

  it.each([
    ['malformed URL', 'https://[::1', 'unknown'],
    ['HTTP URL', 'http://media.example/file.jpg', 'unknown'],
    ['valid HTTPS URL', 'https://media.example/file.jpg', 'unknown'],
  ])(
    'honors a pre-aborted caller before parsing or I/O for %s',
    async (_name, url, host) => {
      const controller = new AbortController()
      controller.abort()
      const resolver = jest.fn(async () => [
        { address: '93.184.216.34', family: 4 as const },
      ])
      const transport = createRequestSequence([
        {
          statusCode: 200,
          headers: { 'content-type': 'image/jpeg' },
          chunks: [payloadFor('image/jpeg')],
        },
      ])

      await expectCategory(
        downloadRemoteMedia(
          url,
          { signal: controller.signal },
          { resolve: resolver, request: transport.request },
        ),
        'cancelled',
        host,
      )
      expect(resolver).not.toHaveBeenCalled()
      expect(transport.request).not.toHaveBeenCalled()
    },
  )

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
    const transport = createRequestSequence([
      {
        statusCode: 200,
        headers: { 'content-type': 'image/jpeg' },
        chunks: ['partial'],
        end: false,
      },
    ])
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
        {
          maxRedirects: Number.POSITIVE_INFINITY,
          maxBytes: 0,
          totalTimeoutMs: Number.POSITIVE_INFINITY,
        },
        { resolve: publicResolver, request: transport.request },
      ),
      'redirect_limit',
      'media.example',
    )
    expect(transport.request).toHaveBeenCalledTimes(4)

    const bodyTransport = createRequestSequence([
      {
        statusCode: 200,
        headers: { 'content-type': 'image/jpeg' },
        chunks: [payloadFor('image/jpeg')],
      },
    ])
    await expect(
      downloadRemoteMedia(
        'https://media.example/file.jpg',
        { maxBytes: 0 },
        { resolve: publicResolver, request: bodyTransport.request },
      ),
    ).resolves.toMatchObject({ buffer: payloadFor('image/jpeg') })
  })
})

describe('safe media filename', () => {
  it('removes traversal, controls, query strings, and dangerous extension chains', () => {
    const filename = createSafeMediaFilename(
      new URL('https://media.example/path/%00secret.php.exe?token=SECRET'),
      'image/jpeg',
    )
    expect(filename).toBe('secret_php.jpg')
    expect(filename).not.toMatch(/[\\/?]/)
    expect(
      Array.from(filename).some((character) => {
        const codePoint = character.codePointAt(0) || 0
        return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
      }),
    ).toBe(false)
    expect(filename).not.toContain('SECRET')
  })

  it('provides a fallback for an empty path and forces the approved MIME extension', () => {
    expect(
      createSafeMediaFilename(new URL('https://media.example/'), 'image/png'),
    ).toBe('media.png')
    expect(
      createSafeMediaFilename(
        new URL('https://media.example/avatar.svg'),
        'image/webp',
      ),
    ).toBe('avatar.webp')
  })

  it('preserves safe Unicode, normalizes whitespace, and handles multi-dot names', () => {
    expect(
      createSafeMediaFilename(
        new URL(
          'https://media.example/%E7%B4%A0%E6%9D%90%20%E6%9C%80%E7%BB%88%E7%89%88.PNG',
        ),
        'image/png',
      ),
    ).toBe('素材_最终版.png')
    expect(
      createSafeMediaFilename(
        new URL('https://media.example/avatar.php.exe'),
        'image/jpeg',
      ),
    ).toBe('avatar_php.jpg')
  })

  it('limits the UTF-8 filename length without splitting Unicode characters', () => {
    const filename = createSafeMediaFilename(
      new URL(
        `https://media.example/${encodeURIComponent('图'.repeat(200))}.png`,
      ),
      'image/png',
    )
    expect(Buffer.byteLength(filename)).toBeLessThanOrEqual(120)
    expect(filename).toMatch(/\.png$/)
    expect(filename).not.toContain('\uFFFD')
  })

  it.each([
    'CON',
    'con.jpg',
    'PrN.tar.gz',
    'AUX.',
    'nul.txt',
    'COM1.png',
    'com9.any',
    'COM¹.jpg',
    'Lpt².mov',
    'lPt³.foo.bar',
  ])(
    'prefixes Windows reserved filename %s regardless of case or extensions',
    (basename) => {
      const filename = createSafeMediaFilename(
        new URL(`https://media.example/${encodeURIComponent(basename)}`),
        'image/jpeg',
      )
      expect(filename).toMatch(/^file_/)
      expect(filename.split('.')[0]).not.toMatch(
        /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/iu,
      )
    },
  )
})
