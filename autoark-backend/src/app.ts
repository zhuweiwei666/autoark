import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import connectDB from './config/db'
import facebookRoutes from './routes/facebook.routes'
import dashboardRoutes from './routes/dashboard.routes'
import facebookSyncRoutes from './routes/facebook.sync.routes'
import logger from './utils/logger'
import initSyncCron from './cron/sync.cron'
import initCronJobs from './cron' // Keep existing cron
import { errorHandler } from './middlewares/errorHandler'

dotenv.config()

// Connect to Database
connectDB()

// Initialize Crons
initCronJobs()
initSyncCron()

const app = express()

app.use(cors())
app.use(express.json())

// Request Logger Middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now()
  const { method, url } = req

  res.on('finish', () => {
    const duration = Date.now() - start
    const { statusCode } = res
    logger.info(`[${method}] ${url} ${statusCode} - ${duration}ms`)
  })

  next()
})

// Routes
app.use('/facebook', facebookRoutes)
app.use('/facebook', facebookSyncRoutes) // Mount sync routes under /facebook
app.use('/dashboard', dashboardRoutes)

app.get('/', (req, res) => {
  res.send('AutoArk Backend API is running')
})

// Global Error Handling Middleware
app.use(errorHandler)

export default app
