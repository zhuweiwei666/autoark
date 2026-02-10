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
  const existingAdmin: any = await User.findOne({ username: env.ADMIN_USERNAME }).select('+password')
  if (!existingAdmin) {
    await User.create({ username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD, role: 'admin' })
    log.info(`[Bootstrap] Admin created: ${env.ADMIN_USERNAME}`)
  } else {
    // 更新密码确保可以登录
    existingAdmin.password = env.ADMIN_PASSWORD
    existingAdmin.role = 'admin'
    await existingAdmin.save()
    log.info('[Bootstrap] Admin password synced')
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
