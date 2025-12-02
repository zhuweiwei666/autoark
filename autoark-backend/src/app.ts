import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import connectDB from './config/db'
import facebookRoutes from './routes/facebook.routes'
import dashboardRoutes from './routes/dashboard.routes'
import facebookSyncRoutes from './routes/facebook.sync.routes'
import logger from './utils/logger'
import initSyncCron from './cron/sync.cron'
import initCronJobs from './cron'
import { errorHandler } from './middlewares/errorHandler'

dotenv.config()

// Connect to DB
connectDB()

// Initialize Crons
initCronJobs()
initSyncCron()

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

// Dashboard UI (accessible at /dashboard)
app.use('/dashboard', dashboardRoutes)

app.get('/', (req, res) => {
  res.send('AutoArk Backend API is running')
})

// 404 Handler (must be after all routes, before errorHandler)
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found`,
  })
})

app.use(errorHandler)

export default app
