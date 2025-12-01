import winston from 'winston'
// Import winston-daily-rotate-file as a side-effect to extend winston.transports
// Use require() to ensure it works in all environments
try {
  require('winston-daily-rotate-file')
} catch (e) {
  console.warn('winston-daily-rotate-file not found, using console transport only')
}

const { combine, timestamp, printf, json, colorize } = winston.format

// Human-readable console format
const consoleFormat = printf(({ timestamp, level, message }) => {
  return `${timestamp} [${level.toUpperCase()}]: ${message}`
})

const winstonLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(timestamp(), json()),
  transports: [
    // 1. Pretty logs on console (for development)
    new winston.transports.Console({
      format: combine(colorize(), timestamp(), consoleFormat),
    }),

    // 2. Daily rotating production logs
    new winston.transports.DailyRotateFile({
      dirname: 'logs',
      filename: 'app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      format: combine(timestamp(), json()),
    }),
  ],
})

// Extend the logger to support custom methods used in the codebase
const logger = {
  ...winstonLogger,
  info: (message: string, ...meta: any[]) => winstonLogger.info(message, ...meta),
  warn: (message: string, ...meta: any[]) => winstonLogger.warn(message, ...meta),
  error: (message: string, ...meta: any[]) => winstonLogger.error(message, ...meta),
  
  // Custom timer log helper
  timerLog: (label: string, startTime: number) => {
    const duration = Date.now() - startTime
    winstonLogger.info(`[TIMER] ${label} - ${duration}ms`)
  },
  
  // Helper to access cron logger (mapping to info/error for now since we removed the separate cron logger)
  cron: (message: string, ...meta: any[]) => winstonLogger.info(`[CRON] ${message}`, ...meta),
  cronError: (message: string, ...meta: any[]) => winstonLogger.error(`[CRON] ${message}`, ...meta),
}

export default logger
