"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const winston_1 = __importDefault(require("winston"));
// Import winston-daily-rotate-file as a side-effect to extend winston.transports
// Use require() to ensure it works in all environments
let hasDailyRotateFile = false;
try {
    require('winston-daily-rotate-file');
    hasDailyRotateFile = true;
}
catch (e) {
    console.warn('winston-daily-rotate-file not found, using File transport instead');
}
const { combine, timestamp, printf, json, colorize } = winston_1.default.format;
// Human-readable console format
const consoleFormat = printf(({ timestamp, level, message }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${message}`;
});
// Build transports array
const transports = [
    // 1. Pretty logs on console (for development)
    new winston_1.default.transports.Console({
        format: combine(colorize(), timestamp(), consoleFormat),
    }),
];
// 2. Daily rotating production logs (if available) or regular file transport
if (hasDailyRotateFile) {
    try {
        // Try to use DailyRotateFile if it was successfully loaded
        // Use dynamic access to avoid TypeScript errors
        const transportsAny = winston_1.default.transports;
        if (transportsAny && transportsAny.DailyRotateFile) {
            const DailyRotateFile = transportsAny.DailyRotateFile;
            transports.push(new DailyRotateFile({
                dirname: 'logs',
                filename: 'app-%DATE%.log',
                datePattern: 'YYYY-MM-DD',
                zippedArchive: true,
                maxSize: '20m',
                maxFiles: '14d',
                format: combine(timestamp(), json()),
            }));
        }
        else {
            throw new Error('DailyRotateFile not available');
        }
    }
    catch (e) {
        // Fallback to regular file transport if DailyRotateFile fails
        console.warn('Failed to initialize DailyRotateFile, using File transport:', e);
        transports.push(new winston_1.default.transports.File({
            filename: 'logs/app.log',
            format: combine(timestamp(), json()),
        }));
    }
}
else {
    // Fallback to regular file transport
    transports.push(new winston_1.default.transports.File({
        filename: 'logs/app.log',
        format: combine(timestamp(), json()),
    }));
}
const winstonLogger = winston_1.default.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: combine(timestamp(), json()),
    transports,
});
// Extend the logger to support custom methods used in the codebase
const logger = {
    ...winstonLogger,
    info: (message, ...meta) => winstonLogger.info(message, ...meta),
    warn: (message, ...meta) => winstonLogger.warn(message, ...meta),
    error: (message, ...meta) => winstonLogger.error(message, ...meta),
    debug: (message, ...meta) => winstonLogger.debug(message, ...meta),
    // Custom timer log helper
    timerLog: (label, startTime) => {
        const duration = Date.now() - startTime;
        winstonLogger.info(`[TIMER] ${label} - ${duration}ms`);
    },
    // Helper to access cron logger (mapping to info/error for now since we removed the separate cron logger)
    cron: (message, ...meta) => winstonLogger.info(`[CRON] ${message}`, ...meta),
    cronError: (message, ...meta) => winstonLogger.error(`[CRON] ${message}`, ...meta),
};
exports.default = logger;
