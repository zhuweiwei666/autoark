import { Request, Response, NextFunction } from 'express'
import logger from '../utils/logger'

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const statusCode = err.statusCode || 500
  const message = err.message || 'Internal Server Error'

  // Log the error to the error log file
  logger.error(`[${req.method}] ${req.url} - ${statusCode} - ${message}`, err)

  // 确保设置正确的 Content-Type，避免返回 HTML
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  
  res.status(statusCode).json({
    success: false,
    message,
    // Hide stack trace in production
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
  })
}
