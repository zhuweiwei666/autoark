import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import authRoutes from './auth/auth.controller'
import conversationRoutes from './conversation/conversation.controller'
import actionRoutes from './action/action.controller'
import monitorRoutes from './monitor/monitor.controller'

const app = express()
app.use(cors())
app.use(express.json())

// API 路由
app.use('/api/auth', authRoutes)
app.use('/api/chat', conversationRoutes)
app.use('/api/actions', actionRoutes)
app.use('/api/monitor', monitorRoutes)

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
