import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import authRoutes from './auth/auth.controller'
import conversationRoutes from './conversation/conversation.controller'
import actionRoutes from './action/action.controller'
import monitorRoutes from './monitor/monitor.controller'
import metabaseRoutes from './monitor/metabase.controller'
import pipelineRoutes from './monitor/pipeline.controller'
import skillRoutes from './monitor/skill.controller'
import agentConfigRoutes from './monitor/agent-config.controller'
import governanceRoutes from './monitor/governance.controller'
import feishuWebhook from './platform/feishu/webhook'

const app = express()
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || 'https://app.autoark.work,http://localhost:5173,http://localhost:3000')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean)

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
    return callback(new Error('CORS origin denied'))
  },
  credentials: true,
}))
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '2mb' }))

const authAttempts = new Map<string, { count: number; resetAt: number }>()
const authRateLimit: express.RequestHandler = (req, res, next) => {
  const now = Date.now()
  const windowMs = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000)
  const maxAttempts = Number(process.env.AUTH_RATE_LIMIT_MAX || 20)
  const key = `${req.ip}:${req.path}`
  const current = authAttempts.get(key)
  if (!current || current.resetAt <= now) {
    authAttempts.set(key, { count: 1, resetAt: now + windowMs })
    return next()
  }
  current.count += 1
  if (current.count > maxAttempts) return res.status(429).json({ error: 'Too many requests' })
  return next()
}

app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    service: 'autoark-agent',
    uptime: process.uptime(),
  })
})

// API 路由
app.use('/api/auth', authRateLimit, authRoutes)
app.use('/api/chat', conversationRoutes)
app.use('/api/actions', actionRoutes)
app.use('/api/monitor', monitorRoutes)
app.use('/api/metabase', metabaseRoutes)
app.use('/api/pipeline', pipelineRoutes)
app.use('/api/skills', skillRoutes)
app.use('/api/agent-config', agentConfigRoutes)
app.use('/api/governance', governanceRoutes)
app.use('/api/webhooks/feishu', feishuWebhook)

// 静态文件（前端）
const distPath = path.join(__dirname, '../web/dist')
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath))
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next()
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

export default app
