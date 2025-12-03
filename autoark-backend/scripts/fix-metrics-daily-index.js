/**
 * 修复 MetricsDaily 索引：将唯一索引改为部分索引
 * 解决 campaign 级别指标与 adId: null 的唯一索引冲突问题
 */

const mongoose = require('mongoose')
require('dotenv').config()

// 优先使用 MONGO_URI，如果没有则使用 MONGODB_URI
const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/autoark'

async function fixIndexes() {
  try {
    console.log('连接到 MongoDB...')
    await mongoose.connect(MONGODB_URI)
    console.log('✅ MongoDB 连接成功')

    const db = mongoose.connection.db
    const collection = db.collection('metricsdailies')

    console.log('\n=== 步骤 1: 删除旧的唯一索引 ===')
    try {
      await collection.dropIndex('adId_1_date_1')
      console.log('✅ 已删除索引: adId_1_date_1')
    } catch (err) {
      if (err.code === 27 || err.message.includes('index not found')) {
        console.log('ℹ️  索引 adId_1_date_1 不存在，跳过')
      } else {
        throw err
      }
    }

    try {
      await collection.dropIndex('campaignId_1_date_1')
      console.log('✅ 已删除索引: campaignId_1_date_1')
    } catch (err) {
      if (err.code === 27 || err.message.includes('index not found')) {
        console.log('ℹ️  索引 campaignId_1_date_1 不存在，跳过')
      } else {
        throw err
      }
    }

    console.log('\n=== 步骤 2: 清理冲突数据 ===')
    // 删除 adId 为 null 且 campaignId 也为 null 的重复记录（保留第一个）
    const duplicateDocs = await collection.aggregate([
      {
        $match: {
          adId: null,
          date: { $exists: true }
        }
      },
      {
        $group: {
          _id: { date: '$date' },
          ids: { $push: '$_id' },
          count: { $sum: 1 }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ]).toArray()

    if (duplicateDocs.length > 0) {
      console.log(`发现 ${duplicateDocs.length} 组重复记录`)
      let deletedCount = 0
      for (const group of duplicateDocs) {
        // 保留第一个，删除其余的
        const idsToDelete = group.ids.slice(1)
        if (idsToDelete.length > 0) {
          const result = await collection.deleteMany({ _id: { $in: idsToDelete } })
          deletedCount += result.deletedCount
        }
      }
      console.log(`✅ 已删除 ${deletedCount} 条重复记录`)
    } else {
      console.log('✅ 没有发现重复记录')
    }

    console.log('\n=== 步骤 3: 创建新的部分索引 ===')
    
    // 创建 adId 的部分唯一索引
    // 使用 $exists: true 代替 $ne: null（MongoDB 不支持 $ne: null 在部分索引中）
    await collection.createIndex(
      { adId: 1, date: 1 },
      {
        unique: true,
        partialFilterExpression: { adId: { $exists: true } },
        name: 'adId_1_date_1'
      }
    )
    console.log('✅ 已创建部分索引: adId_1_date_1 (只在 adId 存在时唯一)')

    // 创建 campaignId 的部分唯一索引
    await collection.createIndex(
      { campaignId: 1, date: 1 },
      {
        unique: true,
        partialFilterExpression: { campaignId: { $exists: true } },
        name: 'campaignId_1_date_1'
      }
    )
    console.log('✅ 已创建部分索引: campaignId_1_date_1 (只在 campaignId 存在时唯一)')

    console.log('\n=== 步骤 4: 验证索引 ===')
    const indexes = await collection.indexes()
    console.log('当前索引列表:')
    indexes.forEach(idx => {
      console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`)
      if (idx.partialFilterExpression) {
        console.log(`    部分过滤: ${JSON.stringify(idx.partialFilterExpression)}`)
      }
    })

    console.log('\n✅ 索引修复完成！')
    process.exit(0)
  } catch (error) {
    console.error('❌ 错误:', error)
    process.exit(1)
  } finally {
    await mongoose.disconnect()
    console.log('\n已断开 MongoDB 连接')
  }
}

fixIndexes()

