import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import connectDB from './config/db'
import facebookRoutes from './routes/facebook.routes'
import dashboardRoutes from './routes/dashboard.routes'
import facebookSyncRoutes from './routes/facebook.sync.routes'
import fbTokenRoutes from './routes/fbToken.routes'
import logger from './utils/logger'
import initSyncCron from './cron/sync.cron'
import initCronJobs from './cron'
import initTokenValidationCron from './cron/tokenValidation.cron'
import { errorHandler } from './middlewares/errorHandler'

dotenv.config()

// Connect to DB
connectDB()

// Initialize Crons
initCronJobs()
initSyncCron()
initTokenValidationCron() // Token validation cron (每小时检查一次)

const app = express()
app.use(cors())
app.use(express.json())

// Request Logger
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now()
  const { method, url } = req

  res.on('finish', () => {
    const duration = Date.now() - start
    logger.info(`[${method}] ${url} ${res.statusCode} - ${duration}ms`)
  })

  next()
})

// API Routes
app.use('/api/facebook', facebookRoutes)
app.use('/api/facebook', facebookSyncRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/fb-token', fbTokenRoutes) // Facebook token management

// Dashboard UI (accessible at /dashboard)
app.use('/dashboard', dashboardRoutes)

// Serve frontend static files (if dist directory exists)
const frontendDistPath = path.join(__dirname, '../../autoark-frontend/dist')
try {
  const fs = require('fs')
  if (fs.existsSync(frontendDistPath)) {
    app.use(express.static(frontendDistPath))
    // Fallback to index.html for client-side routing (React Router)
    // This must be before 404 handler but after all API routes
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      // Skip API routes and dashboard route - let them be handled by their routes or 404
      if (req.path.startsWith('/api') || req.path.startsWith('/dashboard')) {
        return next()
      }
      // For all other routes, serve the React app (for client-side routing)
      res.sendFile(path.join(frontendDistPath, 'index.html'), (err) => {
        if (err) {
          next(err)
        }
      })
    })
    logger.info(`Frontend static files served from: ${frontendDistPath}`)
  } else {
    logger.warn(`Frontend dist directory not found at: ${frontendDistPath}`)
    app.get('/', (req, res) => {
      res.send('AutoArk Backend API is running. Frontend not built yet.')
    })
  }
} catch (error) {
  logger.error('Error setting up frontend static files:', error)
  app.get('/', (req, res) => {
    res.send('AutoArk Backend API is running')
  })
}

// 404 Handler (must be after all routes, before errorHandler)
// This will only catch requests that weren't handled by API routes, dashboard, or frontend
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found`,
  })
})

app.use(errorHandler)

export default app
