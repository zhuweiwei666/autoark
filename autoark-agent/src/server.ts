import './config/env'
import app from './app'
import { connectDB } from './config/db'
import { initRedis } from './config/redis'
import { initAgent } from './agent/agent'
import { initSyncCron } from './data/sync.cron'
import { User } from './auth/user.model'
import { env } from './config/env'
import { log } from './platform/logger'

async function bootstrap() {
  // 1. 数据库
  await connectDB()

  // 2. Redis（可选）
  initRedis()

  // 3. 初始化 Agent（注册工具、加载 Token 池）
  await initAgent()

  // 4. 数据同步 Cron
  initSyncCron()

  // 5. 确保有管理员账号
  const adminExists = await User.findOne({ role: 'admin' })
  if (!adminExists) {
    await User.create({ username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD, role: 'admin' })
    log.info(`[Bootstrap] Admin created: ${env.ADMIN_USERNAME}`)
  }

  // 6. 启动
  app.listen(env.PORT, () => {
    log.info(`AutoArk Agent running on port ${env.PORT}`)
  })
}

bootstrap().catch((err) => {
  log.error('Bootstrap failed:', err)
  process.exit(1)
})
