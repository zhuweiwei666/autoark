/**
 * 补充已发布广告的 Ad-Material 映射
 */

import dotenv from 'dotenv'
import mongoose from 'mongoose'
import Ad from '../src/models/Ad'
import AdMaterialMapping from '../src/models/AdMaterialMapping'

dotenv.config()

async function backfillMappings() {
  try {
    const mongoUri = process.env.MONGO_URI
    if (!mongoUri) throw new Error('MONGO_URI not found')

    console.log('连接数据库...')
    await mongoose.connect(mongoUri)
    console.log('✓ 已连接\n')

    // 获取所有有 materialId 但没有映射的广告
    const ads = await Ad.find({
      taskId: { $exists: true },
      materialId: { $exists: true, $ne: null }
    }).lean()

    console.log(`找到 ${ads.length} 个广告需要建立映射\n`)

    let created = 0
    let skipped = 0

    for (const ad of ads) {
      // 检查是否已存在映射
      const existing = await AdMaterialMapping.findOne({ adId: ad.adId })
      if (existing) {
        skipped++
        continue
      }

      // 创建映射
      await (AdMaterialMapping as any).recordMapping({
        adId: ad.adId,
        materialId: ad.materialId,
        accountId: ad.accountId,
        campaignId: ad.campaignId,
        adsetId: ad.adsetId,
        creativeId: ad.creativeId,
        taskId: ad.taskId,
      })

      created++
      console.log(`✓ [${created}/${ads.length}] ${ad.adId}`)
    }

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`)
    console.log(`✅ 完成！`)
    console.log(`   创建: ${created}`)
    console.log(`   跳过: ${skipped}`)
    console.log(`   总计: ${ads.length}`)

    await mongoose.connection.close()
    process.exit(0)
  } catch (error) {
    console.error('失败:', error)
    await mongoose.connection.close()
    process.exit(1)
  }
}

backfillMappings()
