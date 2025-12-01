"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cronLogger = void 0;
const winston_1 = __importDefault(require("winston"));
require("winston-daily-rotate-file");
const logDir = 'logs';
// Define log formats
const logFormat = winston_1.default.format.printf(({ timestamp, level, message, stack }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
});
// Create the main logger instance
const winstonLogger = winston_1.default.createLogger({
    format: winston_1.default.format.combine(winston_1.default.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston_1.default.format.errors({ stack: true }), // Log the full stack trace on error
    logFormat),
    transports: [
        // Console transport
        new winston_1.default.transports.Console({
            format: winston_1.default.format.combine(winston_1.default.format.colorize(), logFormat),
        }),
        // Error log - rotates daily
        new winston_1.default.transports.DailyRotateFile({
            dirname: logDir,
            filename: 'error-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            level: 'error',
            maxSize: '20m',
            maxFiles: '14d',
        }),
        // Info log (combined) - rotates daily
        new winston_1.default.transports.DailyRotateFile({
            dirname: logDir,
            filename: 'info-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '14d',
        }),
    ],
});
// Separate logger for Cron jobs
exports.cronLogger = winston_1.default.createLogger({
    format: winston_1.default.format.combine(winston_1.default.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), logFormat),
    transports: [
        new winston_1.default.transports.Console({
            format: winston_1.default.format.combine(winston_1.default.format.colorize(), logFormat),
        }),
        new winston_1.default.transports.DailyRotateFile({
            dirname: logDir,
            filename: 'cron-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '30d',
        }),
    ],
});
// Wrapper to maintain compatibility with existing code and add timerLog
const logger = {
    ...winstonLogger,
    info: (message, ...meta) => winstonLogger.info(message, ...meta),
    warn: (message, ...meta) => winstonLogger.warn(message, ...meta),
    error: (message, ...meta) => winstonLogger.error(message, ...meta),
    // Custom timer log helper
    timerLog: (label, startTime) => {
        const duration = Date.now() - startTime;
        winstonLogger.info(`[TIMER] ${label} - ${duration}ms`);
    },
    // Helper to access cron logger
    cron: (message, ...meta) => exports.cronLogger.info(message, ...meta),
    cronError: (message, ...meta) => exports.cronLogger.error(message, ...meta),
};
exports.default = logger;
