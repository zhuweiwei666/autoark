"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = void 0;
const logger_1 = __importDefault(require("../utils/logger"));
const errorHandler = (err, req, res, next) => {
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal Server Error';
    // Log the error to the error log file
    logger_1.default.error(`[${req.method}] ${req.url} - ${statusCode} - ${message}`, err);
    // 确保设置正确的 Content-Type，避免返回 HTML
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(statusCode).json({
        success: false,
        message,
        // Hide stack trace in production
        stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
    });
};
exports.errorHandler = errorHandler;
