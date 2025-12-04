#!/usr/bin/env node
// 测试 Facebook API 是否返回 purchase 数据

require('dotenv').config({ path: require('path').join(__dirname, '.env') })
const { facebookClient } = require('./dist/integration/facebook/facebookClient')
const { tokenPool } = require('./dist/services/facebook.token.pool')

const testPurchaseData = async () => {
  try {
    console.log('========================================')
    console.log('测试 Facebook API Purchase 数据')
    console.log('========================================\n')
    
    // 1. 获取 token
    const token = tokenPool.getNextToken()
    if (!token) {
      console.log('❌ 没有可用的 token')
      return
    }
    console.log('✅ 获取到 token\n')
    
    // 2. 获取一个 campaign ID（从数据库或直接测试）
    const mongoose = require('mongoose')
    const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI
    if (!MONGO_URI) {
      console.log('❌ 无法连接数据库，请手动提供 campaign ID')
      return
    }
    
    await mongoose.connect(MONGO_URI)
    const Campaign = mongoose.model('Campaign', new mongoose.Schema({}, { strict: false }))
    const campaign = await Campaign.findOne({ status: 'ACTIVE' }).lean()
    
    if (!campaign) {
      console.log('❌ 没有找到活跃的 campaign')
      await mongoose.disconnect()
      return
    }
    
    const campaignId = campaign.campaignId
    console.log(`测试 Campaign ID: ${campaignId}\n`)
    
    // 3. 测试 Ad 级别的 insights（purchase 数据通常在 Ad 级别更准确）
    console.log('【测试 1】Ad 级别的 Insights (date_preset: today)')
    console.log('------------------------------------------------')
    
    try {
      const adInsights = await facebookClient.get(`/${campaignId}/insights`, {
        access_token: token,
        level: 'ad',
        date_preset: 'today',
        fields: 'ad_id,campaign_id,spend,impressions,clicks,actions,action_values,purchase_roas',
        limit: 5
      })
      
      const insights = Array.isArray(adInsights) ? adInsights : (adInsights.data || [])
      console.log(`返回了 ${insights.length} 条 insights`)
      
      if (insights.length > 0) {
        const sample = insights[0]
        console.log('\n样本数据:')
        console.log(`  Ad ID: ${sample.ad_id}`)
        console.log(`  Spend: $${parseFloat(sample.spend || 0).toFixed(2)}`)
        console.log(`  Impressions: ${sample.impressions || 0}`)
        console.log(`  Clicks: ${sample.clicks || 0}`)
        
        console.log('\n  Actions:')
        if (sample.actions && Array.isArray(sample.actions)) {
          sample.actions.forEach((action, idx) => {
            console.log(`    ${idx + 1}. ${action.action_type}: ${action.value}`)
          })
        } else {
          console.log('    ❌ actions 不存在或不是数组')
        }
        
        console.log('\n  Action Values:')
        if (sample.action_values && Array.isArray(sample.action_values)) {
          const hasPurchase = sample.action_values.some(a => 
            a.action_type === 'purchase' || a.action_type === 'mobile_app_purchase'
          )
          if (hasPurchase) {
            sample.action_values.forEach((action, idx) => {
              console.log(`    ${idx + 1}. ${action.action_type}: $${parseFloat(action.value || 0).toFixed(2)}`)
            })
          } else {
            console.log('    ❌ action_values 中没有 purchase 或 mobile_app_purchase')
            console.log(`    action_values 类型: ${sample.action_values.map(a => a.action_type).join(', ') || '空数组'}`)
          }
        } else {
          console.log('    ❌ action_values 不存在或不是数组')
          console.log(`    action_values 类型: ${typeof sample.action_values}`)
        }
        
        console.log('\n  Purchase ROAS:')
        if (sample.purchase_roas) {
          if (Array.isArray(sample.purchase_roas)) {
            sample.purchase_roas.forEach((roas, idx) => {
              console.log(`    ${idx + 1}. ${roas.action_type}: ${roas.value}`)
            })
          } else {
            console.log(`    ${sample.purchase_roas}`)
          }
        } else {
          console.log('    ❌ purchase_roas 不存在')
        }
      } else {
        console.log('❌ 没有返回 insights 数据')
      }
    } catch (error) {
      console.log(`❌ API 调用失败: ${error.message}`)
    }
    
    // 4. 测试 Campaign 级别的 insights
    console.log('\n【测试 2】Campaign 级别的 Insights (date_preset: today)')
    console.log('------------------------------------------------')
    
    try {
      const campaignInsights = await facebookClient.get(`/${campaignId}/insights`, {
        access_token: token,
        level: 'campaign',
        date_preset: 'today',
        fields: 'campaign_id,spend,impressions,clicks,actions,action_values,purchase_roas',
        limit: 5
      })
      
      const insights = Array.isArray(campaignInsights) ? campaignInsights : (campaignInsights.data || [])
      console.log(`返回了 ${insights.length} 条 insights`)
      
      if (insights.length > 0) {
        const sample = insights[0]
        console.log('\n样本数据:')
        console.log(`  Campaign ID: ${sample.campaign_id}`)
        console.log(`  Spend: $${parseFloat(sample.spend || 0).toFixed(2)}`)
        
        console.log('\n  Action Values:')
        if (sample.action_values && Array.isArray(sample.action_values)) {
          const purchaseActions = sample.action_values.filter(a => 
            a.action_type === 'purchase' || a.action_type === 'mobile_app_purchase'
          )
          if (purchaseActions.length > 0) {
            purchaseActions.forEach((action, idx) => {
              console.log(`    ${idx + 1}. ${action.action_type}: $${parseFloat(action.value || 0).toFixed(2)}`)
            })
          } else {
            console.log('    ❌ action_values 中没有 purchase 或 mobile_app_purchase')
            console.log(`    action_values 类型: ${sample.action_values.map(a => a.action_type).join(', ') || '空数组'}`)
          }
        } else {
          console.log('    ❌ action_values 不存在或不是数组')
        }
      }
    } catch (error) {
      console.log(`❌ API 调用失败: ${error.message}`)
    }
    
    // 5. 测试 last_7d（通常 purchase 数据在 last_7d 更完整）
    console.log('\n【测试 3】Ad 级别的 Insights (date_preset: last_7d)')
    console.log('------------------------------------------------')
    
    try {
      const adInsights7d = await facebookClient.get(`/${campaignId}/insights`, {
        access_token: token,
        level: 'ad',
        date_preset: 'last_7d',
        fields: 'ad_id,campaign_id,spend,impressions,clicks,actions,action_values,purchase_roas',
        limit: 5
      })
      
      const insights = Array.isArray(adInsights7d) ? adInsights7d : (adInsights7d.data || [])
      console.log(`返回了 ${insights.length} 条 insights`)
      
      if (insights.length > 0) {
        const sample = insights[0]
        console.log('\n  Action Values (last_7d):')
        if (sample.action_values && Array.isArray(sample.action_values)) {
          const purchaseActions = sample.action_values.filter(a => 
            a.action_type === 'purchase' || a.action_type === 'mobile_app_purchase'
          )
          if (purchaseActions.length > 0) {
            purchaseActions.forEach((action, idx) => {
              console.log(`    ${idx + 1}. ${action.action_type}: $${parseFloat(action.value || 0).toFixed(2)}`)
            })
          } else {
            console.log('    ❌ action_values 中没有 purchase 或 mobile_app_purchase')
            console.log(`    action_values 类型: ${sample.action_values.map(a => a.action_type).join(', ') || '空数组'}`)
          }
        } else {
          console.log('    ❌ action_values 不存在或不是数组')
        }
      }
    } catch (error) {
      console.log(`❌ API 调用失败: ${error.message}`)
    }
    
    console.log('\n========================================')
    console.log('测试完成')
    console.log('========================================\n')
    
    await mongoose.disconnect()
    process.exit(0)
  } catch (error) {
    console.error('测试失败:', error)
    process.exit(1)
  }
}

// 等待 token pool 初始化
const initTokenPool = async () => {
  try {
    await tokenPool.initialize()
    console.log('✅ Token Pool 初始化完成\n')
    await testPurchaseData()
  } catch (error) {
    console.error('❌ Token Pool 初始化失败:', error)
    process.exit(1)
  }
}

initTokenPool()

