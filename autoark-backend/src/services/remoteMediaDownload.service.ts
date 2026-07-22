import dns from 'dns'
import https from 'https'
import net from 'net'
import type { ClientRequest, IncomingMessage } from 'http'
import type { TLSSocket } from 'tls'

export type RemoteMediaDownloadErrorCategory =
  | 'invalid_url'
  | 'invalid_host'
  | 'protocol'
  | 'credentials'
  | 'dns_resolution'
  | 'blocked_address'
  | 'redirect_location'
  | 'redirect_limit'
  | 'http_status'
  | 'mime_type'
  | 'invalid_response'
  | 'size_limit'
  | 'empty_body'
  | 'connect_timeout'
  | 'response_timeout'
  | 'total_timeout'
  | 'cancelled'
  | 'network'

export class RemoteMediaDownloadError extends Error {
  readonly category: RemoteMediaDownloadErrorCategory
  readonly host: string

  constructor(category: RemoteMediaDownloadErrorCategory, host: string) {
    const safeHost = sanitizeErrorHost(host)
    super(`remote_media_${category} host=${safeHost}`)
    this.name = 'RemoteMediaDownloadError'
    this.category = category
    this.host = safeHost
  }
}

export type RemoteMediaAddress = {
  address: string
  family: 4 | 6
}

type RemoteMediaRequestOptions = https.RequestOptions & { maxRedirects: 0 }

export type RemoteMediaDownloadDependencies = {
  resolve?: (hostname: string) => Promise<ReadonlyArray<RemoteMediaAddress>>
  /** Trusted injection seam for tests; never populate this from caller input. */
  isPublicAddress?: (address: string) => boolean
  request?: (
    options: RemoteMediaRequestOptions,
    onResponse: (response: IncomingMessage) => void,
  ) => ClientRequest
}

export type RemoteMediaDownloadOptions = {
  maxBytes?: number
  maxRedirects?: number
  connectTimeoutMs?: number
  responseTimeoutMs?: number
  totalTimeoutMs?: number
  signal?: AbortSignal
}

export type RemoteMediaDownloadResult = {
  buffer: Buffer
  mimeType: string
  filename: string
  finalUrl: string
  host: string
}

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024
const ABSOLUTE_MAX_BYTES = 512 * 1024 * 1024
const DEFAULT_MAX_REDIRECTS = 3
const MAX_REDIRECTS = 10
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000
const DEFAULT_RESPONSE_TIMEOUT_MS = 10_000
const DEFAULT_TOTAL_TIMEOUT_MS = 30_000
const MAX_CONNECT_TIMEOUT_MS = 30_000
const MAX_RESPONSE_TIMEOUT_MS = 60_000
const MAX_TOTAL_TIMEOUT_MS = 5 * 60_000
const MAX_FILENAME_BYTES = 120

const MIME_EXTENSIONS = new Map<string, string>([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/avif', '.avif'],
  ['image/heic', '.heic'],
  ['image/heif', '.heif'],
  ['image/bmp', '.bmp'],
  ['image/tiff', '.tiff'],
  ['video/mp4', '.mp4'],
  ['video/webm', '.webm'],
  ['video/quicktime', '.mov'],
  ['video/mpeg', '.mpeg'],
  ['video/ogg', '.ogv'],
  ['video/x-msvideo', '.avi'],
  ['video/x-matroska', '.mkv'],
])

const BLOCKED_IPV4_CIDRS: Array<[number, number]> = [
  [ipv4ToNumber('0.0.0.0'), 8],
  [ipv4ToNumber('10.0.0.0'), 8],
  [ipv4ToNumber('100.64.0.0'), 10],
  [ipv4ToNumber('127.0.0.0'), 8],
  [ipv4ToNumber('169.254.0.0'), 16],
  [ipv4ToNumber('172.16.0.0'), 12],
  [ipv4ToNumber('192.0.0.0'), 24],
  [ipv4ToNumber('192.0.2.0'), 24],
  [ipv4ToNumber('192.31.196.0'), 24],
  [ipv4ToNumber('192.52.193.0'), 24],
  [ipv4ToNumber('192.88.99.0'), 24],
  [ipv4ToNumber('192.168.0.0'), 16],
  [ipv4ToNumber('192.175.48.0'), 24],
  [ipv4ToNumber('198.18.0.0'), 15],
  [ipv4ToNumber('198.51.100.0'), 24],
  [ipv4ToNumber('203.0.113.0'), 24],
  [ipv4ToNumber('224.0.0.0'), 4],
  [ipv4ToNumber('240.0.0.0'), 4],
]

const BLOCKED_GLOBAL_IPV6_CIDRS: Array<[bigint, number]> = [
  [parseIpv6('2001::')!, 23],
  [parseIpv6('2001:db8::')!, 32],
  [parseIpv6('2002::')!, 16],
  [parseIpv6('3fff::')!, 20],
]

function ipv4ToNumber(address: string): number {
  return (
    address
      .split('.')
      .reduce((value, octet) => value * 256 + Number(octet), 0) >>> 0
  )
}

function ipv4InCidr(address: number, network: number, prefix: number): boolean {
  const mask = (0xffffffff << (32 - prefix)) >>> 0
  return (address & mask) >>> 0 === (network & mask) >>> 0
}

function parseIpv6(input: string): bigint | null {
  const address = stripIpv6Brackets(input).toLowerCase()
  if (!address || address.includes('%') || address.split('::').length > 2)
    return null

  const expandIpv4Tail = (parts: string[]): string[] | null => {
    if (!parts.length || !parts[parts.length - 1].includes('.')) return parts
    const ipv4 = parts[parts.length - 1]
    if (net.isIP(ipv4) !== 4) return null
    const value = ipv4ToNumber(ipv4)
    return [
      ...parts.slice(0, -1),
      ((value >>> 16) & 0xffff).toString(16),
      (value & 0xffff).toString(16),
    ]
  }

  const halves = address.split('::')
  const left = expandIpv4Tail(halves[0] ? halves[0].split(':') : [])
  const right = expandIpv4Tail(
    halves.length === 2 && halves[1] ? halves[1].split(':') : [],
  )
  if (!left || !right) return null
  if (left.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null
  if (right.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null

  const missing = 8 - left.length - right.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null
  const words =
    halves.length === 1
      ? left
      : [...left, ...Array(missing).fill('0'), ...right]
  if (words.length !== 8) return null

  return words.reduce((value, word) => (value << 16n) | BigInt(`0x${word}`), 0n)
}

function ipv6InCidr(address: bigint, network: bigint, prefix: number): boolean {
  const shift = BigInt(128 - prefix)
  return address >> shift === network >> shift
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
}

export const isPublicIpAddress = (input: string): boolean => {
  const address = stripIpv6Brackets(input)
  const family = net.isIP(address)
  if (family === 4) {
    const numeric = ipv4ToNumber(address)
    return !BLOCKED_IPV4_CIDRS.some(([network, prefix]) =>
      ipv4InCidr(numeric, network, prefix),
    )
  }
  if (family !== 6) return false

  const numeric = parseIpv6(address)
  if (numeric === null) return false
  const globalUnicast = ipv6InCidr(numeric, parseIpv6('2000::')!, 3)
  if (!globalUnicast) return false
  return !BLOCKED_GLOBAL_IPV6_CIDRS.some(([network, prefix]) =>
    ipv6InCidr(numeric, network, prefix),
  )
}

const sanitizeErrorHost = (host: string): string => {
  const normalized = stripIpv6Brackets(String(host || '')).toLowerCase()
  if (!normalized || normalized.length > 253) return 'unknown'
  if (net.isIP(normalized)) return normalized
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(
    normalized,
  )
    ? normalized
    : 'unknown'
}

const normalizeAndValidateHostname = (hostname: string): string => {
  const normalized = stripIpv6Brackets(hostname)
    .replace(/\.$/, '')
    .toLowerCase()
  if (net.isIP(normalized)) return normalized
  if (
    !normalized ||
    normalized.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(
      normalized,
    )
  ) {
    throw new RemoteMediaDownloadError('invalid_host', 'unknown')
  }
  return normalized
}

const parseDownloadUrl = (input: string): { url: URL; hostname: string } => {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new RemoteMediaDownloadError('invalid_url', 'unknown')
  }

  const tentativeHost = sanitizeErrorHost(url.hostname)
  if (url.protocol !== 'https:') {
    throw new RemoteMediaDownloadError('protocol', tentativeHost)
  }
  if (url.username || url.password) {
    throw new RemoteMediaDownloadError('credentials', tentativeHost)
  }
  const hostname = normalizeAndValidateHostname(url.hostname)
  return { url, hostname }
}

const positiveInteger = (
  value: number | undefined,
  fallback: number,
  maximum: number,
): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    return fallback
  return Math.min(maximum, Math.max(1, Math.floor(value)))
}

const redirectLimit = (value: number | undefined): number => {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return DEFAULT_MAX_REDIRECTS
  return Math.min(MAX_REDIRECTS, Math.max(0, Math.floor(value)))
}

const normalizeOptions = (options: RemoteMediaDownloadOptions) => ({
  maxBytes: positiveInteger(
    options.maxBytes,
    DEFAULT_MAX_BYTES,
    ABSOLUTE_MAX_BYTES,
  ),
  maxRedirects: redirectLimit(options.maxRedirects),
  connectTimeoutMs: positiveInteger(
    options.connectTimeoutMs,
    DEFAULT_CONNECT_TIMEOUT_MS,
    MAX_CONNECT_TIMEOUT_MS,
  ),
  responseTimeoutMs: positiveInteger(
    options.responseTimeoutMs,
    DEFAULT_RESPONSE_TIMEOUT_MS,
    MAX_RESPONSE_TIMEOUT_MS,
  ),
  totalTimeoutMs: positiveInteger(
    options.totalTimeoutMs,
    DEFAULT_TOTAL_TIMEOUT_MS,
    MAX_TOTAL_TIMEOUT_MS,
  ),
})

const defaultResolve = async (
  hostname: string,
): Promise<ReadonlyArray<RemoteMediaAddress>> => {
  const addresses = await dns.promises.lookup(hostname, {
    all: true,
    verbatim: true,
  })
  return addresses.map(({ address, family }) => ({
    address,
    family: family as 4 | 6,
  }))
}

const abortError = (category: 'total_timeout' | 'cancelled', host: string) =>
  new RemoteMediaDownloadError(category, host)

const raceWithAbort = async <T>(
  promise: Promise<T>,
  signal: AbortSignal,
  getAbortError: () => RemoteMediaDownloadError,
): Promise<T> => {
  if (signal.aborted) throw getAbortError()
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const onAbort = () => {
      if (settled) return
      settled = true
      reject(getAbortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

const validateAndPinAddress = async (
  hostname: string,
  resolve: NonNullable<RemoteMediaDownloadDependencies['resolve']>,
  isPublicAddress: NonNullable<
    RemoteMediaDownloadDependencies['isPublicAddress']
  >,
  signal: AbortSignal,
  getAbortError: () => RemoteMediaDownloadError,
): Promise<RemoteMediaAddress> => {
  const literalFamily = net.isIP(hostname)
  let resolved: ReadonlyArray<RemoteMediaAddress>
  if (literalFamily) {
    resolved = [{ address: hostname, family: literalFamily as 4 | 6 }]
  } else {
    try {
      resolved = await raceWithAbort(
        Promise.resolve(resolve(hostname)),
        signal,
        getAbortError,
      )
    } catch (error) {
      if (error instanceof RemoteMediaDownloadError) throw error
      throw new RemoteMediaDownloadError('dns_resolution', hostname)
    }
  }

  if (!Array.isArray(resolved) || resolved.length === 0) {
    throw new RemoteMediaDownloadError('dns_resolution', hostname)
  }

  const validated = resolved.map((entry) => {
    const family =
      typeof entry?.address === 'string'
        ? net.isIP(stripIpv6Brackets(entry.address))
        : 0
    if (
      (family !== 4 && family !== 6) ||
      (entry.family !== 4 && entry.family !== 6) ||
      family !== entry.family
    ) {
      throw new RemoteMediaDownloadError('dns_resolution', hostname)
    }
    const address = stripIpv6Brackets(entry.address)
    if (!isPublicAddress(address)) {
      throw new RemoteMediaDownloadError('blocked_address', hostname)
    }
    return { address, family: family as 4 | 6 }
  })

  return validated[0]
}

const normalizeMimeType = (header: string | undefined): string | null => {
  const mimeType = String(header || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase()
  return MIME_EXTENSIONS.has(mimeType) ? mimeType : null
}

const trimToUtf8Bytes = (value: string, maximum: number): string => {
  let result = ''
  let length = 0
  for (const character of value) {
    const bytes = Buffer.byteLength(character)
    if (length + bytes > maximum) break
    result += character
    length += bytes
  }
  return result
}

const removeControlCharacters = (value: string): string =>
  Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0) || 0
      return !(codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    })
    .join('')

export const createSafeMediaFilename = (url: URL, mimeType: string): string => {
  const extension = MIME_EXTENSIONS.get(mimeType)
  if (!extension)
    throw new RemoteMediaDownloadError(
      'mime_type',
      sanitizeErrorHost(url.hostname),
    )

  const encodedBasename = url.pathname.split('/').pop() || ''
  let decodedBasename: string
  try {
    decodedBasename = decodeURIComponent(encodedBasename)
  } catch {
    decodedBasename = encodedBasename
  }

  const withoutControls = removeControlCharacters(
    decodedBasename.normalize('NFC'),
  ).replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '')
  const finalDot = withoutControls.lastIndexOf('.')
  const withoutExtension =
    finalDot > 0 ? withoutControls.slice(0, finalDot) : withoutControls
  const safeStem = withoutExtension
    .replace(/\.+/g, '_')
    .replace(/[\s\u00a0]+/g, '_')
    .replace(/[^\p{L}\p{N}\p{M}_-]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
  const stem = trimToUtf8Bytes(
    safeStem || 'media',
    MAX_FILENAME_BYTES - Buffer.byteLength(extension),
  )
  return `${stem || 'media'}${extension}`
}

const headerValue = (
  response: IncomingMessage,
  name: string,
): string | undefined => {
  const headers = response.headers as Record<
    string,
    string | string[] | undefined
  >
  const key = Object.keys(headers).find(
    (candidate) => candidate.toLowerCase() === name,
  )
  const value = key ? headers[key] : undefined
  return Array.isArray(value) ? value[0] : value
}

type RequestResult =
  | { kind: 'redirect'; location: string }
  | { kind: 'success'; buffer: Buffer; mimeType: string }

const requestPinnedMedia = (
  url: URL,
  hostname: string,
  pinnedAddress: RemoteMediaAddress,
  config: ReturnType<typeof normalizeOptions>,
  signal: AbortSignal,
  getAbortError: () => RemoteMediaDownloadError,
  request: NonNullable<RemoteMediaDownloadDependencies['request']>,
): Promise<RequestResult> =>
  new Promise((resolve, reject) => {
    let req: ClientRequest | undefined
    let response: IncomingMessage | undefined
    let settled = false
    let completed = false
    let responseTimer: NodeJS.Timeout | undefined

    const clearTimers = () => {
      if (connectTimer) clearTimeout(connectTimer)
      if (responseTimer) clearTimeout(responseTimer)
    }

    const cleanup = () => {
      clearTimers()
      signal.removeEventListener('abort', onAbort)
    }

    const finishReject = (
      error: RemoteMediaDownloadError,
      destroyResponse = true,
    ) => {
      if (settled) return
      settled = true
      cleanup()
      if (destroyResponse && response && !response.destroyed) response.destroy()
      if (req && !req.destroyed) req.destroy()
      reject(error)
    }

    const finishResolve = (result: RequestResult) => {
      if (settled) return
      settled = true
      completed = true
      cleanup()
      resolve(result)
    }

    const onAbort = () => finishReject(getAbortError())
    const startResponseTimer = () => {
      if (settled || responseTimer) return
      responseTimer = setTimeout(() => {
        finishReject(new RemoteMediaDownloadError('response_timeout', hostname))
      }, config.responseTimeoutMs)
    }
    const connectTimer = setTimeout(() => {
      finishReject(new RemoteMediaDownloadError('connect_timeout', hostname))
    }, config.connectTimeoutMs)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }

    const lookup: NonNullable<https.RequestOptions['lookup']> = ((
      requestedHostname: string,
      _options: unknown,
      callback: (
        error: NodeJS.ErrnoException | null,
        address: string,
        family: number,
      ) => void,
    ) => {
      if (requestedHostname.replace(/\.$/, '').toLowerCase() !== hostname) {
        callback(
          Object.assign(new Error('pinned hostname mismatch'), {
            code: 'EPERM',
          }),
          '',
          0,
        )
        return
      }
      callback(null, pinnedAddress.address, pinnedAddress.family)
    }) as NonNullable<https.RequestOptions['lookup']>

    const requestOptions: RemoteMediaRequestOptions = {
      protocol: 'https:',
      hostname,
      port: url.port ? Number(url.port) : 443,
      method: 'GET',
      path: `${url.pathname}${url.search}`,
      headers: {
        accept:
          'image/avif,image/webp,image/png,image/jpeg,image/gif,video/*;q=0.9',
        connection: 'close',
        'user-agent': 'AutoArk-Remote-Media/1.0',
      },
      lookup,
      family: pinnedAddress.family,
      agent: false,
      rejectUnauthorized: true,
      maxRedirects: 0,
      ...(net.isIP(hostname) ? {} : { servername: hostname }),
    }

    try {
      req = request(requestOptions, (incoming) => {
        if (settled) {
          incoming.destroy()
          return
        }
        response = incoming
        if (connectTimer) clearTimeout(connectTimer)
        if (responseTimer) clearTimeout(responseTimer)

        const statusCode = incoming.statusCode || 0
        if ([301, 302, 303, 307, 308].includes(statusCode)) {
          const location = headerValue(incoming, 'location')?.trim()
          incoming.destroy()
          if (!location) {
            finishReject(
              new RemoteMediaDownloadError('redirect_location', hostname),
              false,
            )
            return
          }
          finishResolve({ kind: 'redirect', location })
          return
        }
        if (statusCode < 200 || statusCode >= 300) {
          finishReject(new RemoteMediaDownloadError('http_status', hostname))
          return
        }

        const mimeType = normalizeMimeType(
          headerValue(incoming, 'content-type'),
        )
        if (!mimeType) {
          finishReject(new RemoteMediaDownloadError('mime_type', hostname))
          return
        }

        const contentLengthHeader = headerValue(incoming, 'content-length')
        if (contentLengthHeader !== undefined) {
          if (!/^\d+$/.test(contentLengthHeader)) {
            finishReject(
              new RemoteMediaDownloadError('invalid_response', hostname),
            )
            return
          }
          const declaredLength = Number(contentLengthHeader)
          if (!Number.isSafeInteger(declaredLength)) {
            finishReject(
              new RemoteMediaDownloadError('invalid_response', hostname),
            )
            return
          }
          if (declaredLength > config.maxBytes) {
            finishReject(new RemoteMediaDownloadError('size_limit', hostname))
            return
          }
        }

        const chunks: Buffer[] = []
        let received = 0
        incoming.on('data', (chunk: Buffer | string) => {
          if (settled) return
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          received += buffer.length
          if (received > config.maxBytes) {
            finishReject(new RemoteMediaDownloadError('size_limit', hostname))
            return
          }
          chunks.push(buffer)
        })
        incoming.once('end', () => {
          if (settled) return
          completed = true
          if (received === 0) {
            finishReject(
              new RemoteMediaDownloadError('empty_body', hostname),
              false,
            )
            return
          }
          finishResolve({
            kind: 'success',
            buffer: Buffer.concat(chunks, received),
            mimeType,
          })
        })
        incoming.once('aborted', () => {
          if (!settled)
            finishReject(new RemoteMediaDownloadError('network', hostname))
        })
        incoming.once('error', () => {
          if (!settled)
            finishReject(new RemoteMediaDownloadError('network', hostname))
        })
        incoming.once('close', () => {
          if (!settled && !completed)
            finishReject(
              new RemoteMediaDownloadError('network', hostname),
              false,
            )
        })
      })
    } catch {
      finishReject(new RemoteMediaDownloadError('network', hostname))
      return
    }

    req.once('socket', (socket) => {
      const tlsSocket = socket as TLSSocket & { secureConnecting?: boolean }
      if (tlsSocket.encrypted && tlsSocket.secureConnecting === false) {
        if (connectTimer) clearTimeout(connectTimer)
        startResponseTimer()
        return
      }
      socket.once('secureConnect', () => {
        if (connectTimer) clearTimeout(connectTimer)
        startResponseTimer()
      })
    })
    req.once('error', () => {
      if (!settled)
        finishReject(new RemoteMediaDownloadError('network', hostname))
    })

    req.end()
  })

export const downloadRemoteMedia = async (
  input: string,
  options: RemoteMediaDownloadOptions = {},
  dependencies: RemoteMediaDownloadDependencies = {},
): Promise<RemoteMediaDownloadResult> => {
  const config = normalizeOptions(options)
  const resolve = dependencies.resolve || defaultResolve
  const isPublicAddress = dependencies.isPublicAddress || isPublicIpAddress
  const request = dependencies.request || https.request
  const controller = new AbortController()
  let abortCategory: 'total_timeout' | 'cancelled' = 'total_timeout'
  let currentHost = sanitizeErrorHost(
    (() => {
      try {
        return new URL(input).hostname
      } catch {
        return 'unknown'
      }
    })(),
  )

  const onCallerAbort = () => {
    if (controller.signal.aborted) return
    abortCategory = 'cancelled'
    controller.abort()
  }
  if (options.signal)
    options.signal.addEventListener('abort', onCallerAbort, { once: true })
  if (options.signal?.aborted) onCallerAbort()
  const totalTimer = setTimeout(() => {
    if (controller.signal.aborted) return
    abortCategory = 'total_timeout'
    controller.abort()
  }, config.totalTimeoutMs)
  const getAbortError = () => abortError(abortCategory, currentHost)

  try {
    let parsed = parseDownloadUrl(input)
    for (let redirects = 0; redirects <= config.maxRedirects; redirects += 1) {
      currentHost = parsed.hostname
      if (controller.signal.aborted) throw getAbortError()
      const pinnedAddress = await validateAndPinAddress(
        parsed.hostname,
        resolve,
        isPublicAddress,
        controller.signal,
        getAbortError,
      )
      const result = await requestPinnedMedia(
        parsed.url,
        parsed.hostname,
        pinnedAddress,
        config,
        controller.signal,
        getAbortError,
        request,
      )

      if (result.kind === 'success') {
        return {
          buffer: result.buffer,
          mimeType: result.mimeType,
          filename: createSafeMediaFilename(parsed.url, result.mimeType),
          finalUrl: parsed.url.toString(),
          host: parsed.hostname,
        }
      }

      if (redirects >= config.maxRedirects) {
        throw new RemoteMediaDownloadError('redirect_limit', parsed.hostname)
      }
      let redirectUrl: URL
      try {
        redirectUrl = new URL(result.location, parsed.url)
      } catch {
        throw new RemoteMediaDownloadError('redirect_location', parsed.hostname)
      }
      parsed = parseDownloadUrl(redirectUrl.toString())
    }
    throw new RemoteMediaDownloadError('redirect_limit', parsed.hostname)
  } finally {
    clearTimeout(totalTimer)
    if (options.signal)
      options.signal.removeEventListener('abort', onCallerAbort)
  }
}
