#!/usr/bin/env node
/**
 * Facebook Purchase 数据调试工具
 * 
 * 用途：检查 Facebook API 返回的 action_values 数组，确认 purchase 数据的类型和值
 * 
 * 使用方法：
 * 1. 修改下面的 adId 和 token
 * 2. 运行: npm run debug:purchase
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') })

const { fetchInsights } = require('../dist/integration/facebook/insights.api')
const { extractPurchaseValue } = require('../dist/utils/facebookPurchase')
const { tokenPool } = require('../dist/services/facebook.token.pool')

async function main() {
  try {
    console.log('========================================')
    console.log('Facebook Purchase 数据调试工具')
    console.log('========================================\n')

    // 初始化 Token Pool
    await tokenPool.initialize()
    const token = tokenPool.getNextToken()
    
    if (!token) {
      console.error('❌ 没有可用的 token')
      process.exit(1)
    }
    console.log('✅ 获取到 token\n')

    // 从数据库获取一个实际的 adId
    const mongoose = require('mongoose')
    const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI
    if (!MONGO_URI) {
      console.error('❌ 无法连接数据库，请手动提供 adId')
      process.exit(1)
    }

    await mongoose.connect(MONGO_URI)
    const Ad = mongoose.model('Ad', new mongoose.Schema({}, { strict: false }))
    const ad = await Ad.findOne({ status: 'ACTIVE' }).lean()

    if (!ad) {
      console.error('❌ 没有找到活跃的 Ad')
      await mongoose.disconnect()
      process.exit(1)
    }

    const adId = ad.adId
    console.log(`测试 Ad ID: ${adId}\n`)

    // 测试不同的 date_preset
    const datePresets = ['today', 'yesterday', 'last_3d', 'last_7d']

    for (const preset of datePresets) {
      console.log(`\n【测试】date_preset: ${preset}`)
      console.log('------------------------------------------------')

      try {
        const data = await fetchInsights(adId, 'ad', preset, token, ['country'])

        const insights = Array.isArray(data) ? data : (data.data || [])
        console.log(`返回了 ${insights.length} 条 insights`)

        if (insights.length > 0) {
          const sample = insights[0]
          console.log(`\n样本数据:`)
          console.log(`  Ad ID: ${sample.ad_id}`)
          console.log(`  Spend: $${parseFloat(sample.spend || 0).toFixed(2)}`)
          console.log(`  Impressions: ${sample.impressions || 0}`)
          console.log(`  Clicks: ${sample.clicks || 0}`)

          console.log(`\n  Action Values 数组:`)
          if (sample.action_values && Array.isArray(sample.action_values)) {
            if (sample.action_values.length > 0) {
              sample.action_values.forEach((action, idx) => {
                console.log(`    ${idx + 1}. action_type: "${action.action_type}", value: "${action.value}"`)
              })

              // 使用 extractPurchaseValue 提取
              const extractedValue = extractPurchaseValue(sample.action_values)
              console.log(`\n  ✅ 提取的 Purchase Value: $${extractedValue.toFixed(2)}`)

              if (extractedValue === 0) {
                console.log(`  ⚠️  警告: 提取的值为 0，可能的原因:`)
                console.log(`     - action_values 中没有匹配的 purchase 类型`)
                console.log(`     - 实际类型: ${sample.action_values.map(a => a.action_type).join(', ')}`)
              }
            } else {
              console.log(`    ❌ action_values 是空数组`)
            }
          } else {
            console.log(`    ❌ action_values 不存在或不是数组`)
            console.log(`    类型: ${typeof sample.action_values}`)
          }

          console.log(`\n  Purchase ROAS:`)
          if (sample.purchase_roas) {
            if (Array.isArray(sample.purchase_roas)) {
              sample.purchase_roas.forEach((roas, idx) => {
                console.log(`    ${idx + 1}. action_type: "${roas.action_type}", value: "${roas.value}"`)
              })
            } else {
              console.log(`    ${sample.purchase_roas}`)
            }
          } else {
            console.log(`    ❌ purchase_roas 不存在`)
          }
        } else {
          console.log('❌ 没有返回 insights 数据')
        }
      } catch (error) {
        console.log(`❌ API 调用失败: ${error.message}`)
      }
    }

    console.log('\n========================================')
    console.log('调试完成')
    console.log('========================================\n')

    await mongoose.disconnect()
    process.exit(0)
  } catch (error) {
    console.error('调试失败:', error)
    process.exit(1)
  }
}

main()

