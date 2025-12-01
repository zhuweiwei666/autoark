import winston from 'winston'
import 'winston-daily-rotate-file'
import path from 'path'

const logDir = 'logs'

// Define log formats
const logFormat = winston.format.printf(
  ({ timestamp, level, message, stack }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`
  },
)

// Create the main logger instance
const winstonLogger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }), // Log the full stack trace on error
    logFormat,
  ),
  transports: [
    // Console transport
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), logFormat),
    }),
    // Error log - rotates daily
    new winston.transports.DailyRotateFile({
      dirname: logDir,
      filename: 'error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '14d',
    }),
    // Info log (combined) - rotates daily
    new winston.transports.DailyRotateFile({
      dirname: logDir,
      filename: 'info-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
    }),
  ],
})

// Separate logger for Cron jobs
export const cronLogger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat,
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), logFormat),
    }),
    new winston.transports.DailyRotateFile({
      dirname: logDir,
      filename: 'cron-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
    }),
  ],
})

// Wrapper to maintain compatibility with existing code and add timerLog
const logger = {
  ...winstonLogger,
  info: (message: string, ...meta: any[]) =>
    winstonLogger.info(message, ...meta),
  warn: (message: string, ...meta: any[]) =>
    winstonLogger.warn(message, ...meta),
  error: (message: string, ...meta: any[]) =>
    winstonLogger.error(message, ...meta),

  // Custom timer log helper
  timerLog: (label: string, startTime: number) => {
    const duration = Date.now() - startTime
    winstonLogger.info(`[TIMER] ${label} - ${duration}ms`)
  },

  // Helper to access cron logger
  cron: (message: string, ...meta: any[]) => cronLogger.info(message, ...meta),
  cronError: (message: string, ...meta: any[]) =>
    cronLogger.error(message, ...meta),
}

export default logger
