#!/usr/bin/env node
// 诊断 purchase_value 数据问题

const path = require('path')
const dotenv = require('dotenv')

// 确保从正确的目录加载 .env
dotenv.config({ path: path.join(__dirname, '.env') })

const mongoose = require('mongoose')

// 连接 MongoDB
const connectDB = async () => {
  try {
    // 尝试多个可能的环境变量名
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI
    if (!mongoUri) {
      console.error('❌ MONGO_URI/MONGODB_URI 环境变量未设置')
      console.log('尝试从 .env 文件读取...')
      const fs = require('fs')
      const envPath = path.join(__dirname, '.env')
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8')
        const mongoMatch = envContent.match(/MONGO_URI=(.+)/) || envContent.match(/MONGODB_URI=(.+)/)
        if (mongoMatch) {
          const uri = mongoMatch[1].trim()
          await mongoose.connect(uri)
          console.log('✅ MongoDB Connected (从 .env 文件读取)')
        } else {
          throw new Error('无法在 .env 文件中找到 MONGO_URI 或 MONGODB_URI')
        }
      } else {
        throw new Error('.env 文件不存在')
      }
    } else {
      await mongoose.connect(mongoUri)
      console.log('✅ MongoDB Connected')
    }
  } catch (error) {
    console.error('❌ MongoDB connection error:', error)
    process.exit(1)
  }
}

// 定义模型
const MetricsDailySchema = new mongoose.Schema({}, { strict: false })
const RawInsightsSchema = new mongoose.Schema({}, { strict: false })
const MetricsDaily = mongoose.model('MetricsDaily', MetricsDailySchema)
const RawInsights = mongoose.model('RawInsights', RawInsightsSchema)

const diagnose = async () => {
  await connectDB()
  
  console.log('\n========================================')
  console.log('Purchase Value 诊断报告')
  console.log('========================================\n')
  
  // 1. 检查 MetricsDaily 中的 purchase_value
  console.log('【1】检查 MetricsDaily 中的 purchase_value 数据')
  console.log('------------------------------------------------')
  
  // 检查最近7天的数据
  const dates = []
  for (let i = 0; i < 7; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    dates.push(d.toISOString().split('T')[0])
  }
  
  const today = dates[0]
  console.log(`检查日期范围: ${dates[6]} 到 ${today}`)
  const metricsStats = await MetricsDaily.aggregate([
    {
      $match: {
        date: { $in: dates },
        level: 'campaign'
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: { $ifNull: ['$purchase_value', 0] } },
        count: { $sum: 1 },
        withValue: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$purchase_value', 0] }, 0] }, 1, 0] } },
        sample: { $push: { campaignId: '$campaignId', purchase_value: '$purchase_value', action_values: '$action_values' } }
      }
    }
  ])
  
  if (metricsStats.length > 0) {
    const stats = metricsStats[0]
    console.log(`总记录数: ${stats.count}`)
    console.log(`有 purchase_value > 0 的记录: ${stats.withValue}`)
    console.log(`总 purchase_value: $${stats.total.toFixed(2)}`)
    
    // 显示前5个样本
    console.log('\n样本数据（前5个）:')
    stats.sample.slice(0, 5).forEach((item, idx) => {
      console.log(`  ${idx + 1}. Campaign ${item.campaignId}:`)
      console.log(`     purchase_value: $${(item.purchase_value || 0).toFixed(2)}`)
      if (item.action_values && Array.isArray(item.action_values)) {
        const purchaseAction = item.action_values.find(a => 
          a.action_type === 'purchase' || a.action_type === 'mobile_app_purchase'
        )
        if (purchaseAction) {
          console.log(`     action_values 中的 purchase: $${parseFloat(purchaseAction.value || 0).toFixed(2)}`)
        } else {
          console.log(`     action_values 中未找到 purchase`)
          console.log(`     action_values 类型: ${item.action_values.map(a => a.action_type).join(', ')}`)
        }
      } else {
        console.log(`     action_values: ${item.action_values ? '存在但不是数组' : '不存在'}`)
      }
    })
  } else {
    console.log('❌ 没有找到今天的 campaign 级别数据')
  }
  
  // 2. 检查 RawInsights 中的 purchase_value
  console.log('\n【2】检查 RawInsights 中的原始数据')
  console.log('------------------------------------------------')
  
  const rawStats = await RawInsights.aggregate([
    {
      $match: {
        date: { $in: dates },
        datePreset: { $in: ['today', 'yesterday'] }
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: { $ifNull: ['$purchase_value', 0] } },
        count: { $sum: 1 },
        withValue: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$purchase_value', 0] }, 0] }, 1, 0] } },
        sample: { $push: { adId: '$adId', purchase_value: '$purchase_value', raw: '$raw' } }
      }
    }
  ])
  
  if (rawStats.length > 0) {
    const stats = rawStats[0]
    console.log(`总记录数: ${stats.count}`)
    console.log(`有 purchase_value > 0 的记录: ${stats.withValue}`)
    console.log(`总 purchase_value: $${stats.total.toFixed(2)}`)
    
    // 检查原始 API 响应
    console.log('\n原始 API 响应样本（前3个）:')
    stats.sample.slice(0, 3).forEach((item, idx) => {
      console.log(`  ${idx + 1}. Ad ${item.adId}:`)
      console.log(`     purchase_value: $${(item.purchase_value || 0).toFixed(2)}`)
      if (item.raw && item.raw.action_values) {
        const actionValues = item.raw.action_values
        if (Array.isArray(actionValues)) {
          const purchaseAction = actionValues.find(a => 
            a.action_type === 'purchase' || a.action_type === 'mobile_app_purchase'
          )
          if (purchaseAction) {
            console.log(`     API 返回的 action_values.purchase: $${parseFloat(purchaseAction.value || 0).toFixed(2)}`)
          } else {
            console.log(`     API 返回的 action_values 中未找到 purchase`)
            console.log(`     action_values 类型: ${actionValues.map(a => a.action_type).join(', ')}`)
          }
        } else {
          console.log(`     API 返回的 action_values 不是数组: ${typeof actionValues}`)
        }
      } else {
        console.log(`     API 响应中没有 action_values 字段`)
      }
    })
  } else {
    console.log('❌ 没有找到今天的 RawInsights 数据')
  }
  
  // 3. 检查 Ad 级别的数据聚合
  console.log('\n【3】检查 Ad 级别数据聚合到 Campaign 级别')
  console.log('------------------------------------------------')
  
  const adLevelStats = await MetricsDaily.aggregate([
    {
      $match: {
        date: { $in: dates },
        level: 'ad',
        adId: { $exists: true, $ne: null }
      }
    },
    {
      $group: {
        _id: '$campaignId',
        totalPurchaseValue: { $sum: { $ifNull: ['$purchase_value', 0] } },
        adCount: { $sum: 1 },
        withValue: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$purchase_value', 0] }, 0] }, 1, 0] } }
      }
    },
    { $limit: 5 }
  ])
  
  console.log(`Ad 级别数据样本（前5个 campaign）:`)
  adLevelStats.forEach((item, idx) => {
    console.log(`  ${idx + 1}. Campaign ${item._id}:`)
    console.log(`     Ad 数量: ${item.adCount}`)
    console.log(`     有 purchase_value 的 Ad: ${item.withValue}`)
    console.log(`     聚合 purchase_value: $${item.totalPurchaseValue.toFixed(2)}`)
  })
  
  // 4. 检查数据同步时间和实际数据结构
  console.log('\n【4】检查实际数据结构和同步时间')
  console.log('------------------------------------------------')
  
  const recentSync = await MetricsDaily.find({ date: { $in: dates } })
    .sort({ updatedAt: -1 })
    .limit(5)
    .lean()
  
  if (recentSync.length > 0) {
    console.log(`找到 ${recentSync.length} 条最近的数据记录`)
    recentSync.forEach((item, idx) => {
      console.log(`\n  记录 ${idx + 1}:`)
      console.log(`    日期: ${item.date}`)
      console.log(`    级别: ${item.level}`)
      console.log(`    campaignId: ${item.campaignId || 'N/A'}`)
      console.log(`    purchase_value: $${(item.purchase_value || 0).toFixed(2)}`)
      console.log(`    purchase_value_corrected: $${(item.purchase_value_corrected || 0).toFixed(2)}`)
      console.log(`    action_values 存在: ${item.action_values ? '是' : '否'}`)
      if (item.action_values && Array.isArray(item.action_values)) {
        const purchaseAction = item.action_values.find(a => 
          a.action_type === 'purchase' || a.action_type === 'mobile_app_purchase'
        )
        if (purchaseAction) {
          console.log(`    action_values 中的 purchase: $${parseFloat(purchaseAction.value || 0).toFixed(2)}`)
        } else {
          console.log(`    action_values 类型: ${item.action_values.map(a => a.action_type).join(', ') || '空数组'}`)
        }
      }
      console.log(`    更新时间: ${item.updatedAt}`)
    })
  } else {
    console.log('❌ 没有找到最近7天的数据')
    
    // 检查所有数据
    const allData = await MetricsDaily.find({}).limit(1).lean()
    if (allData.length > 0) {
      console.log(`\n找到其他日期的数据，最新日期: ${allData[0].date}`)
    } else {
      console.log('❌ 数据库中没有 MetricsDaily 数据')
    }
  }
  
  console.log('\n========================================')
  console.log('诊断完成')
  console.log('========================================\n')
  
  await mongoose.disconnect()
  process.exit(0)
}

diagnose().catch(error => {
  console.error('诊断失败:', error)
  process.exit(1)
})

