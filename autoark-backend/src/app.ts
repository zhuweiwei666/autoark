// 🔥 必须第一个导入，确保环境变量加载
import './config/env'

import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import path from 'path'
import connectDB from './config/db'
import facebookRoutes from './routes/facebook.routes'
import dashboardRoutes from './routes/dashboard.routes'
import facebookSyncRoutes from './routes/facebook.sync.routes'
import fbTokenRoutes from './routes/fbToken.routes'
import userSettingsRoutes from './routes/user.settings.routes' // New: User settings routes
import bulkAdRoutes from './routes/bulkAd.routes' // New: Bulk ad creation routes
import materialRoutes from './routes/material.routes' // New: Material management routes
import materialMetricsRoutes from './routes/materialMetrics.routes' // New: Material metrics & recommendations
import agentRoutes from './domain/agent/agent.controller' // New: AI Agent routes
import summaryRoutes from './controllers/summary.controller' // New: 预聚合数据快速读取
import productMappingRoutes from './routes/productMapping.routes' // New: 产品关系映射
import facebookAppRoutes from './routes/facebookApp.routes' // New: Facebook App 管理
import authRoutes from './routes/auth.routes' // New: 认证路由
import userRoutes from './routes/user.routes' // New: 用户管理路由
import organizationRoutes from './routes/organization.routes' // New: 组织管理路由
import accountManagementRoutes from './routes/account.management.routes' // New: 账户管理路由
import aggregationRoutes from './controllers/aggregation.controller' // New: 预聚合数据 API
import ruleRoutes from './controllers/rule.controller' // New: 自动化规则引擎
import materialAutoTestRoutes from './controllers/materialAutoTest.controller' // New: 素材自动测试
import aiSuggestionRoutes from './controllers/aiSuggestion.controller' // New: AI 优化建议
import logger from './utils/logger'
import initSyncCron from './cron/sync.cron'
import initCronJobs from './cron'
import initTokenValidationCron from './cron/tokenValidation.cron'
import { errorHandler } from './middlewares/errorHandler'

// Connect to DB
connectDB()

// Initialize Redis
import { initRedis } from './config/redis'
initRedis()

// Initialize Token Pool
import { tokenPool } from './services/facebook.token.pool'
tokenPool.initialize().catch((error) => {
  logger.error('[App] Failed to initialize token pool:', error)
})

// Initialize Queues and Workers
import { initQueues } from './queue/facebook.queue'
import { initWorkers } from './queue/facebook.worker'
import { initBulkAdWorker } from './queue/bulkAd.worker'
initQueues()
initWorkers()
initBulkAdWorker() // Initialize bulk ad creation worker

// Initialize Crons
import initPreaggregationCron from './cron/preaggregation.cron'
import initAggregationCron from './cron/aggregation.cron'
initCronJobs()
initSyncCron()
initPreaggregationCron()
initAggregationCron() // 数据聚合定时任务
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
// 认证路由（公开）
app.use('/api/auth', authRoutes)
// 用户和组织管理（需要认证）
app.use('/api/users', userRoutes)
app.use('/api/organizations', organizationRoutes)
app.use('/api/account-management', accountManagementRoutes)
// 其他业务路由
app.use('/api/facebook', facebookRoutes)
app.use('/api/facebook', facebookSyncRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/fb-token', fbTokenRoutes) // Facebook token management
app.use('/api/user-settings', userSettingsRoutes) // New: User settings management
app.use('/api/bulk-ad', bulkAdRoutes) // New: Bulk ad creation management
app.use('/api/materials', materialRoutes) // New: Material management
app.use('/api/material-metrics', materialMetricsRoutes) // New: Material metrics & recommendations
app.use('/api/agent', agentRoutes) // New: AI Agent
app.use('/api/summary', summaryRoutes) // New: 预聚合数据快速读取（加速前端页面）
app.use('/api/product-mapping', productMappingRoutes) // New: 产品关系映射（自动投放核心）
app.use('/api/facebook-apps', facebookAppRoutes) // New: Facebook App 管理（多App负载均衡）
app.use('/api/agg', aggregationRoutes) // New: 统一预聚合数据 API（前端+AI 共用）
app.use('/api/rules', ruleRoutes) // New: 自动化规则引擎
app.use('/api/material-auto-test', materialAutoTestRoutes) // New: 素材自动测试
app.use('/api/ai-suggestions', aiSuggestionRoutes) // New: AI 优化建议

// Dashboard UI 已迁移到 React 前端，不再需要后端路由
// app.use('/dashboard', dashboardRoutes) // 已禁用，让前端 React Router 处理

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
  // Serve static assets with no-cache headers to prevent browser caching issues
  app.use('/assets', express.static(path.join(frontendDistPath, 'assets'), {
    setHeaders: (res, path) => {
      // For JS and CSS files, set no-cache to ensure fresh content
      if (path.endsWith('.js') || path.endsWith('.css')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
        res.setHeader('Pragma', 'no-cache')
        res.setHeader('Expires', '0')
      }
    }
  }))
  
  // Serve root static files (favicon, etc.) with no-cache for HTML
  app.use(express.static(frontendDistPath, {
    setHeaders: (res, path) => {
      // For HTML files, set no-cache to ensure fresh content
      if (path.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
        res.setHeader('Pragma', 'no-cache')
        res.setHeader('Expires', '0')
      }
    }
  }))
  
  // Fallback to index.html for client-side routing (React Router)
  // This must be before 404 handler but after all API routes
  // Use app.use instead of app.get('*') for Express 5.x compatibility
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Skip API routes only - let frontend handle all other routes including /dashboard
    if (req.path.startsWith('/api')) {
      return next()
    }
    
    // Skip if it's a static file request (likely 404 if we reached here)
    // But we want to be careful not to block valid routes
    if (req.path.includes('.') && !req.path.endsWith('.html')) {
      return next()
    }
    
    // For all other routes (including /dashboard), serve the React app (for client-side routing)
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
