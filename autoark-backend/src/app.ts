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
// Try multiple possible paths for frontend dist
const fs = require('fs')
const possiblePaths = [
  path.join(__dirname, '../../autoark-frontend/dist'), // Relative from dist/
  path.join(process.cwd(), 'autoark-frontend/dist'), // From project root
  path.join(process.cwd(), '../autoark-frontend/dist'), // From backend dir
  '/root/autoark/autoark-frontend/dist', // Absolute path on server
]

let frontendDistPath: string | null = null
for (const possiblePath of possiblePaths) {
  if (fs.existsSync(possiblePath)) {
    frontendDistPath = possiblePath
    break
  }
}

if (frontendDistPath) {
  logger.info(`Frontend static files served from: ${frontendDistPath}`)
  
  // Explicitly serve assets directory to ensure CSS/JS loading
  app.use('/assets', express.static(path.join(frontendDistPath, 'assets')))
  
  // Serve root static files (favicon, etc.)
  app.use(express.static(frontendDistPath))
  
  // Fallback to index.html for client-side routing (React Router)
  // This must be before 404 handler but after all API routes
  // Use app.use instead of app.get('*') for Express 5.x compatibility
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Skip API routes and dashboard route - let them be handled by their routes or 404
    if (req.path.startsWith('/api') || req.path.startsWith('/dashboard')) {
      return next()
    }
    
    // Skip if it's a static file request (likely 404 if we reached here)
    // But we want to be careful not to block valid routes
    if (req.path.includes('.') && !req.path.endsWith('.html')) {
      return next()
    }
    
    // For all other routes, serve the React app (for client-side routing)
    const indexPath = path.join(frontendDistPath!, 'index.html')
    res.sendFile(indexPath, (err) => {
      if (err) {
        logger.error(`Error serving frontend index.html: ${err.message}`)
        next(err)
      }
    })
  })
} else {
  logger.warn('Frontend dist directory not found. Tried paths:')
  possiblePaths.forEach(p => logger.warn(`  - ${p}`))
  logger.warn('Please build the frontend: cd autoark-frontend && npm run build')
  
  // Still provide a route for /fb-token to show helpful message
  app.get('/fb-token', (req: Request, res: Response) => {
    res.status(503).json({
      success: false,
      message: 'Frontend not built. Please build the frontend first: cd autoark-frontend && npm run build',
      pathsTried: possiblePaths,
    })
  })
  
  app.get('/', (req: Request, res: Response) => {
    res.send('AutoArk Backend API is running. Frontend not built yet. Please build: cd autoark-frontend && npm run build')
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
