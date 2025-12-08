/**
 * 初始化超级管理员账号
 * 运行方式: npx ts-node scripts/initSuperAdmin.ts
 */

import dotenv from 'dotenv'
import mongoose from 'mongoose'
import User, { UserRole, UserStatus } from '../src/models/User'

// 加载环境变量
dotenv.config()

const SUPER_ADMIN_USERNAME = process.env.SUPER_ADMIN_USERNAME || 'admin'
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'admin123456'
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'admin@autoark.com'

async function initSuperAdmin() {
  try {
    // 连接数据库
    const mongoUri = process.env.MONGO_URI
    if (!mongoUri) {
      throw new Error('MONGO_URI not found in environment variables')
    }

    console.log('正在连接数据库...')
    await mongoose.connect(mongoUri)
    console.log('数据库连接成功')

    // 检查是否已存在超级管理员
    const existingAdmin = await User.findOne({
      role: UserRole.SUPER_ADMIN,
    })

    if (existingAdmin) {
      console.log(`\n超级管理员已存在:`)
      console.log(`  用户名: ${existingAdmin.username}`)
      console.log(`  邮箱: ${existingAdmin.email}`)
      console.log(`  创建时间: ${existingAdmin.createdAt}`)
      
      // 询问是否要创建新的超级管理员
      const readline = require('readline')
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      })

      const answer = await new Promise<string>((resolve) => {
        rl.question('\n是否要创建新的超级管理员? (y/n): ', resolve)
      })
      rl.close()

      if (answer.toLowerCase() !== 'y') {
        console.log('取消创建')
        await mongoose.connection.close()
        process.exit(0)
      }
    }

    // 检查用户名和邮箱是否已存在
    const existingUser = await User.findOne({
      $or: [
        { username: SUPER_ADMIN_USERNAME },
        { email: SUPER_ADMIN_EMAIL },
      ],
    })

    if (existingUser) {
      console.error(`\n错误: 用户名或邮箱已存在`)
      console.error(`请修改环境变量 SUPER_ADMIN_USERNAME 或 SUPER_ADMIN_EMAIL`)
      await mongoose.connection.close()
      process.exit(1)
    }

    // 创建超级管理员
    console.log('\n正在创建超级管理员...')
    const superAdmin = new User({
      username: SUPER_ADMIN_USERNAME,
      password: SUPER_ADMIN_PASSWORD,
      email: SUPER_ADMIN_EMAIL,
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      // super_admin 不需要 organizationId
    })

    await superAdmin.save()

    console.log('\n✅ 超级管理员创建成功!')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log(`用户名: ${SUPER_ADMIN_USERNAME}`)
    console.log(`密码: ${SUPER_ADMIN_PASSWORD}`)
    console.log(`邮箱: ${SUPER_ADMIN_EMAIL}`)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('\n⚠️  请妥善保管超级管理员密码，并在首次登录后修改!')
    console.log('\n提示: 您可以通过以下环境变量自定义超级管理员信息:')
    console.log('  - SUPER_ADMIN_USERNAME')
    console.log('  - SUPER_ADMIN_PASSWORD')
    console.log('  - SUPER_ADMIN_EMAIL')

    await mongoose.connection.close()
    process.exit(0)
  } catch (error) {
    console.error('创建超级管理员失败:', error)
    await mongoose.connection.close()
    process.exit(1)
  }
}

// 运行脚本
initSuperAdmin()
