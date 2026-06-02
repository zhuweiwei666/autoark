import winston from 'winston'
// Import winston-daily-rotate-file as a side-effect to extend winston.transports
// Use require() to ensure it works in all environments
let hasDailyRotateFile = false
try {
  require('winston-daily-rotate-file')
  hasDailyRotateFile = true
} catch (e) {
  console.warn('winston-daily-rotate-file not found, using File transport instead')
}

const { combine, timestamp, printf, json, colorize } = winston.format
const SENSITIVE_LOG_KEY_PATTERN =
  /^(access[_-]?token|refresh[_-]?token|fb[_-]?token|bearer[_-]?token|token|password|secret|client[_-]?secret|app[_-]?secret|api[_-]?key|authorization|cookie|jwt)$/i
const MAX_LOG_DEPTH = 5
const MAX_LOG_ARRAY_LENGTH = 20
const MAX_LOG_STRING_LENGTH = 1000

const redactSensitiveString = (value: string) => {
  const redacted = value
    .replace(/(access_token=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(refresh_token=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(client_secret=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(app_secret=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(authorization:\s*bearer\s+)[^\s,]+/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+[^\s,]+/g, 'Bearer [REDACTED]')

  return redacted.length > MAX_LOG_STRING_LENGTH
    ? `${redacted.slice(0, MAX_LOG_STRING_LENGTH)}...`
    : redacted
}

const sanitizeUrl = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const original = value

  try {
    const isRelative = original.startsWith('/')
    const url = new URL(original, 'https://autoark.local')
    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_LOG_KEY_PATTERN.test(key)) {
        url.searchParams.set(key, '[REDACTED]')
      }
    }
    const sanitized = `${url.pathname}${url.search}${url.hash}`
    return isRelative ? sanitized : `${url.origin}${sanitized}`
  } catch {
    return redactSensitiveString(original)
  }
}

const summarizeResponseData = (data: any) => {
  if (!data) return undefined
  if (typeof data === 'string') return redactSensitiveString(data)

  return {
    code: data?.error?.code ?? data?.code,
    subcode: data?.error?.error_subcode ?? data?.subcode,
    type: data?.error?.type ?? data?.type,
    message: data?.error?.message ?? data?.message,
    requestId: data?.request_id ?? data?.requestId,
  }
}

const sanitizeError = (error: any) => ({
  name: error?.name,
  message: redactSensitiveString(String(error?.message || error)),
  code: error?.code,
  status: error?.status ?? error?.response?.status,
  method: error?.config?.method,
  url: sanitizeUrl(error?.config?.url),
  response: summarizeResponseData(error?.response?.data),
  stack: typeof error?.stack === 'string'
    ? redactSensitiveString(error.stack.split('\n').slice(0, 6).join('\n'))
    : undefined,
})

export const sanitizeLogValue = (value: any, depth = 0, seen = new WeakSet<object>()): any => {
  if (value === null || value === undefined) return value

  if (typeof value === 'string') return redactSensitiveString(value)
  if (typeof value !== 'object') return value

  if (value instanceof Error || value?.isAxiosError) {
    return sanitizeError(value)
  }

  if (seen.has(value)) return '[Circular]'
  if (depth >= MAX_LOG_DEPTH) return '[MaxDepth]'
  seen.add(value)

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_LOG_ARRAY_LENGTH)
      .map((item) => sanitizeLogValue(item, depth + 1, seen))
  }

  const sanitized: Record<string, any> = {}
  for (const [key, nestedValue] of Object.entries(value)) {
    sanitized[key] = SENSITIVE_LOG_KEY_PATTERN.test(key)
      ? '[REDACTED]'
      : sanitizeLogValue(nestedValue, depth + 1, seen)
  }
  return sanitized
}

const sanitizeLogMeta = (meta: any[]) => meta.map((item) => sanitizeLogValue(item))

// Human-readable console format
const consoleFormat = printf(({ timestamp, level, message }) => {
  return `${timestamp} [${level.toUpperCase()}]: ${message}`
})

// Build transports array
const transports: winston.transport[] = [
  // 1. Pretty logs on console (for development)
  new winston.transports.Console({
    format: combine(colorize(), timestamp(), consoleFormat),
  }),
]

// 2. Daily rotating production logs (if available) or regular file transport
if (hasDailyRotateFile) {
  try {
    // Try to use DailyRotateFile if it was successfully loaded
    // Use dynamic access to avoid TypeScript errors
    const transportsAny = winston.transports as any
    if (transportsAny && transportsAny.DailyRotateFile) {
      const DailyRotateFile = transportsAny.DailyRotateFile
      transports.push(
        new DailyRotateFile({
          dirname: 'logs',
          filename: 'app-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          zippedArchive: true,
          maxSize: '20m',
          maxFiles: '14d',
          format: combine(timestamp(), json()),
        }),
      )
    } else {
      throw new Error('DailyRotateFile not available')
    }
  } catch (e) {
    // Fallback to regular file transport if DailyRotateFile fails
    console.warn('Failed to initialize DailyRotateFile, using File transport:', e)
    transports.push(
      new winston.transports.File({
        filename: 'logs/app.log',
        format: combine(timestamp(), json()),
      }),
    )
  }
} else {
  // Fallback to regular file transport
  transports.push(
    new winston.transports.File({
      filename: 'logs/app.log',
      format: combine(timestamp(), json()),
    }),
  )
}

const winstonLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(timestamp(), json()),
  transports,
})

// Extend the logger to support custom methods used in the codebase
const logger = {
  ...winstonLogger,
  info: (message: string, ...meta: any[]) => winstonLogger.info(message, ...sanitizeLogMeta(meta)),
  warn: (message: string, ...meta: any[]) => winstonLogger.warn(message, ...sanitizeLogMeta(meta)),
  error: (message: string, ...meta: any[]) => winstonLogger.error(message, ...sanitizeLogMeta(meta)),
  debug: (message: string, ...meta: any[]) => winstonLogger.debug(message, ...sanitizeLogMeta(meta)),
  
  // Custom timer log helper
  timerLog: (label: string, startTime: number) => {
    const duration = Date.now() - startTime
    winstonLogger.info(`[TIMER] ${label} - ${duration}ms`)
  },
  
  // Helper to access cron logger (mapping to info/error for now since we removed the separate cron logger)
  cron: (message: string, ...meta: any[]) => winstonLogger.info(`[CRON] ${message}`, ...sanitizeLogMeta(meta)),
  cronError: (message: string, ...meta: any[]) => winstonLogger.error(`[CRON] ${message}`, ...sanitizeLogMeta(meta)),
}

export default logger
