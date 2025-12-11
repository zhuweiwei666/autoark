/**
 * 📊 预聚合数据服务
 * 
 * 核心逻辑：
 * - 最近 3 天：从 Facebook API 实时获取 → 更新到数据库
 * - 超过 3 天：直接从数据库读取
 */

import logger from '../utils/logger'
import dayjs from 'dayjs'
import { 
  AggDaily, 
  AggCountry, 
  AggAccount, 
  AggCampaign, 
  AggOptimizer, 
  AggMaterial,
  isRecentDate 
} from '../models/Aggregation'
import Account from '../models/Account'
import Campaign from '../models/Campaign'
import FbToken from '../models/FbToken'
import Material from '../models/Material'
import AdMaterialMapping from '../models/AdMaterialMapping'
import { fetchInsights } from '../integration/facebook/insights.api'

// 国家代码到名称的映射
const COUNTRY_NAMES: Record<string, string> = {
  'US': '美国', 'GB': '英国', 'CA': '加拿大', 'AU': '澳大利亚',
  'JP': '日本', 'KR': '韩国', 'TW': '台湾', 'HK': '香港',
  'TH': '泰国', 'VN': '越南', 'ID': '印尼', 'MY': '马来西亚', 'SG': '新加坡', 'PH': '菲律宾',
  'IN': '印度', 'PK': '巴基斯坦', 'BD': '孟加拉',
  'BR': '巴西', 'MX': '墨西哥', 'AR': '阿根廷',
  'DE': '德国', 'FR': '法国', 'IT': '意大利', 'ES': '西班牙', 'NL': '荷兰',
  'RU': '俄罗斯', 'TR': '土耳其', 'SA': '沙特', 'AE': '阿联酋', 'EG': '埃及',
}

/**
 * 🔄 刷新指定日期的所有聚合数据
 * @param date YYYY-MM-DD 格式
 * @param forceRefresh 是否强制刷新（即使不在最近3天内）
 */
export async function refreshAggregation(date: string, forceRefresh = false): Promise<void> {
  // 如果不是最近3天且不强制刷新，跳过
  if (!isRecentDate(date) && !forceRefresh) {
    logger.info(`[Aggregation] Skipping ${date} - not in recent 3 days`)
    return
  }

  logger.info(`[Aggregation] Refreshing aggregation for ${date}...`)
  const startTime = Date.now()

  try {
    // 获取 Token
    const tokenDoc = await FbToken.findOne({ status: 'active' })
    if (!tokenDoc?.token) {
      logger.warn('[Aggregation] No active token found')
      return
    }
    const token = tokenDoc.token

    // 获取所有账户
    const accounts = await Account.find({ status: 'active' }).lean()
    logger.info(`[Aggregation] Found ${accounts.length} active accounts`)

    // 收集所有数据
    const dailyData = { spend: 0, revenue: 0, impressions: 0, clicks: 0, installs: 0 }
    const countryMap = new Map<string, any>()
    const accountMap = new Map<string, any>()
    const campaignMap = new Map<string, any>()
    const optimizerMap = new Map<string, any>()

    // 遍历每个账户获取数据
    for (const account of accounts) {
      try {
        // 获取 campaign 级别数据（含国家维度）
        const insights = await fetchInsights(
          `act_${account.accountId}`,
          'campaign',
          undefined,
          token,
          ['country'],
          { since: date, until: date }
        )

        let accountSpend = 0
        let accountRevenue = 0
        let accountImpressions = 0
        let accountClicks = 0
        let accountInstalls = 0
        const accountCampaigns = new Set<string>()

        for (const insight of insights) {
          const spend = parseFloat(insight.spend || '0')
          const impressions = parseInt(insight.impressions || '0', 10)
          const clicks = parseInt(insight.clicks || '0', 10)
          let revenue = 0
          let installs = 0

          // 提取 purchase value - 只取第一个匹配的，避免重复计算
          if (insight.action_values && Array.isArray(insight.action_values)) {
            const purchaseAction = insight.action_values.find((a: any) => 
              a.action_type === 'purchase' || a.action_type === 'mobile_app_purchase' || a.action_type === 'omni_purchase'
            )
            if (purchaseAction) {
              revenue = parseFloat(purchaseAction.value) || 0
            }
          }

          // 提取 installs
          if (insight.actions) {
            for (const action of insight.actions) {
              if (action.action_type === 'mobile_app_install') {
                installs += parseInt(action.value || '0', 10)
              }
            }
          }

          // 累加到日汇总
          dailyData.spend += spend
          dailyData.revenue += revenue
          dailyData.impressions += impressions
          dailyData.clicks += clicks
          dailyData.installs += installs

          // 累加到账户
          accountSpend += spend
          accountRevenue += revenue
          accountImpressions += impressions
          accountClicks += clicks
          accountInstalls += installs

          // 记录 Campaign
          if (insight.campaign_id) {
            accountCampaigns.add(insight.campaign_id)
            
            const campaignKey = insight.campaign_id
            if (!campaignMap.has(campaignKey)) {
              // 从名称提取投手
              const campaignName = insight.campaign_name || ''
              const optimizer = campaignName.split('_')[0] || 'unknown'
              
              campaignMap.set(campaignKey, {
                campaignId: insight.campaign_id,
                campaignName,
                accountId: account.accountId,
                accountName: account.name || '',
                optimizer,
                spend: 0, revenue: 0, impressions: 0, clicks: 0, installs: 0,
                status: insight.campaign_status || 'ACTIVE',
                objective: insight.objective || '',
              })
            }
            const c = campaignMap.get(campaignKey)
            c.spend += spend
            c.revenue += revenue
            c.impressions += impressions
            c.clicks += clicks
            c.installs += installs
          }

          // 记录国家
          if (insight.country) {
            const countryKey = insight.country
            if (!countryMap.has(countryKey)) {
              countryMap.set(countryKey, {
                country: countryKey,
                countryName: COUNTRY_NAMES[countryKey] || countryKey,
                spend: 0, revenue: 0, impressions: 0, clicks: 0, installs: 0,
                campaigns: new Set(),
              })
            }
            const cn = countryMap.get(countryKey)
            cn.spend += spend
            cn.revenue += revenue
            cn.impressions += impressions
            cn.clicks += clicks
            cn.installs += installs
            if (insight.campaign_id) cn.campaigns.add(insight.campaign_id)
          }
        }

        // 保存账户数据
        accountMap.set(account.accountId, {
          accountId: account.accountId,
          accountName: account.name || '',
          spend: accountSpend,
          revenue: accountRevenue,
          impressions: accountImpressions,
          clicks: accountClicks,
          installs: accountInstalls,
          campaigns: accountCampaigns.size,
          status: account.status || 'active',
        })

      } catch (error: any) {
        logger.warn(`[Aggregation] Failed to fetch account ${account.accountId}: ${error.message}`)
      }
    }

    // 聚合投手数据（从 Campaign 汇总）
    for (const [, campaign] of campaignMap) {
      const optimizer = campaign.optimizer
      if (!optimizerMap.has(optimizer)) {
        optimizerMap.set(optimizer, {
          optimizer,
          spend: 0, revenue: 0, impressions: 0, clicks: 0, installs: 0,
          campaigns: new Set(),
          accounts: new Set(),
        })
      }
      const o = optimizerMap.get(optimizer)
      o.spend += campaign.spend
      o.revenue += campaign.revenue
      o.impressions += campaign.impressions
      o.clicks += campaign.clicks
      o.installs += campaign.installs
      o.campaigns.add(campaign.campaignId)
      o.accounts.add(campaign.accountId)
    }

    // ==================== 保存到数据库 ====================

    // 1. 保存日汇总
    const activeAccounts = [...accountMap.values()].filter(a => a.spend > 0).length
    const activeCampaigns = [...campaignMap.values()].filter(c => c.spend > 0).length
    
    await AggDaily.findOneAndUpdate(
      { date },
      {
        date,
        spend: Math.round(dailyData.spend * 100) / 100,
        revenue: Math.round(dailyData.revenue * 100) / 100,
        roas: dailyData.spend > 0 ? Math.round((dailyData.revenue / dailyData.spend) * 100) / 100 : 0,
        impressions: dailyData.impressions,
        clicks: dailyData.clicks,
        installs: dailyData.installs,
        ctr: dailyData.impressions > 0 ? Math.round((dailyData.clicks / dailyData.impressions) * 10000) / 100 : 0,
        cpm: dailyData.impressions > 0 ? Math.round((dailyData.spend / dailyData.impressions) * 1000 * 100) / 100 : 0,
        cpc: dailyData.clicks > 0 ? Math.round((dailyData.spend / dailyData.clicks) * 100) / 100 : 0,
        cpi: dailyData.installs > 0 ? Math.round((dailyData.spend / dailyData.installs) * 100) / 100 : 0,
        activeCampaigns,
        activeAccounts,
      },
      { upsert: true }
    )

    // 2. 保存国家数据
    for (const [, country] of countryMap) {
      await AggCountry.findOneAndUpdate(
        { date, country: country.country },
        {
          date,
          country: country.country,
          countryName: country.countryName,
          spend: Math.round(country.spend * 100) / 100,
          revenue: Math.round(country.revenue * 100) / 100,
          roas: country.spend > 0 ? Math.round((country.revenue / country.spend) * 100) / 100 : 0,
          impressions: country.impressions,
          clicks: country.clicks,
          installs: country.installs,
          ctr: country.impressions > 0 ? Math.round((country.clicks / country.impressions) * 10000) / 100 : 0,
          campaigns: country.campaigns.size,
        },
        { upsert: true }
      )
    }

    // 3. 保存账户数据
    for (const [, account] of accountMap) {
      await AggAccount.findOneAndUpdate(
        { date, accountId: account.accountId },
        {
          date,
          accountId: account.accountId,
          accountName: account.accountName,
          spend: Math.round(account.spend * 100) / 100,
          revenue: Math.round(account.revenue * 100) / 100,
          roas: account.spend > 0 ? Math.round((account.revenue / account.spend) * 100) / 100 : 0,
          impressions: account.impressions,
          clicks: account.clicks,
          installs: account.installs,
          ctr: account.impressions > 0 ? Math.round((account.clicks / account.impressions) * 10000) / 100 : 0,
          campaigns: account.campaigns,
          status: account.status,
        },
        { upsert: true }
      )
    }

    // 4. 保存广告系列数据
    for (const [, campaign] of campaignMap) {
      await AggCampaign.findOneAndUpdate(
        { date, campaignId: campaign.campaignId },
        {
          date,
          campaignId: campaign.campaignId,
          campaignName: campaign.campaignName,
          accountId: campaign.accountId,
          accountName: campaign.accountName,
          optimizer: campaign.optimizer,
          spend: Math.round(campaign.spend * 100) / 100,
          revenue: Math.round(campaign.revenue * 100) / 100,
          roas: campaign.spend > 0 ? Math.round((campaign.revenue / campaign.spend) * 100) / 100 : 0,
          impressions: campaign.impressions,
          clicks: campaign.clicks,
          installs: campaign.installs,
          ctr: campaign.impressions > 0 ? Math.round((campaign.clicks / campaign.impressions) * 10000) / 100 : 0,
          cpc: campaign.clicks > 0 ? Math.round((campaign.spend / campaign.clicks) * 100) / 100 : 0,
          cpi: campaign.installs > 0 ? Math.round((campaign.spend / campaign.installs) * 100) / 100 : 0,
          status: campaign.status,
          objective: campaign.objective,
        },
        { upsert: true }
      )
    }

    // 5. 保存投手数据
    for (const [, optimizer] of optimizerMap) {
      await AggOptimizer.findOneAndUpdate(
        { date, optimizer: optimizer.optimizer },
        {
          date,
          optimizer: optimizer.optimizer,
          spend: Math.round(optimizer.spend * 100) / 100,
          revenue: Math.round(optimizer.revenue * 100) / 100,
          roas: optimizer.spend > 0 ? Math.round((optimizer.revenue / optimizer.spend) * 100) / 100 : 0,
          impressions: optimizer.impressions,
          clicks: optimizer.clicks,
          installs: optimizer.installs,
          ctr: optimizer.impressions > 0 ? Math.round((optimizer.clicks / optimizer.impressions) * 10000) / 100 : 0,
          campaigns: optimizer.campaigns.size,
          accounts: optimizer.accounts.size,
        },
        { upsert: true }
      )
    }

    const duration = Date.now() - startTime
    logger.info(`[Aggregation] Refreshed ${date} in ${duration}ms: ${activeCampaigns} campaigns, ${activeAccounts} accounts, ${countryMap.size} countries`)

  } catch (error: any) {
    logger.error(`[Aggregation] Failed to refresh ${date}:`, error.message)
  }
}

/**
 * 🔄 刷新最近 3 天的数据
 */
export async function refreshRecentDays(): Promise<void> {
  const today = dayjs().format('YYYY-MM-DD')
  const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
  const dayBefore = dayjs().subtract(2, 'day').format('YYYY-MM-DD')

  logger.info('[Aggregation] Refreshing recent 3 days...')
  
  // 并行刷新
  await Promise.all([
    refreshAggregation(today),
    refreshAggregation(yesterday),
    refreshAggregation(dayBefore),
  ])
}

// ==================== 查询接口 ====================

/**
 * 📊 获取日汇总数据
 */
export async function getDailySummary(startDate: string, endDate: string) {
  // 先刷新最近3天的数据
  const today = dayjs().format('YYYY-MM-DD')
  if (endDate >= dayjs().subtract(2, 'day').format('YYYY-MM-DD')) {
    await refreshRecentDays()
  }

  return AggDaily.find({ 
    date: { $gte: startDate, $lte: endDate } 
  }).sort({ date: -1 }).lean()
}

/**
 * 🌍 获取国家数据
 */
export async function getCountryData(date: string) {
  if (isRecentDate(date)) {
    await refreshAggregation(date)
  }

  return AggCountry.find({ date })
    .sort({ spend: -1 })
    .lean()
}

/**
 * 💰 获取账户数据
 */
export async function getAccountData(date: string) {
  if (isRecentDate(date)) {
    await refreshAggregation(date)
  }

  return AggAccount.find({ date })
    .sort({ spend: -1 })
    .lean()
}

/**
 * 📈 获取广告系列数据
 */
export async function getCampaignData(date: string, options?: { optimizer?: string; accountId?: string }) {
  if (isRecentDate(date)) {
    await refreshAggregation(date)
  }

  const query: any = { date }
  if (options?.optimizer) query.optimizer = options.optimizer
  if (options?.accountId) query.accountId = options.accountId

  return AggCampaign.find(query)
    .sort({ spend: -1 })
    .lean()
}

/**
 * 👥 获取投手数据
 */
export async function getOptimizerData(date: string) {
  if (isRecentDate(date)) {
    await refreshAggregation(date)
  }

  return AggOptimizer.find({ date })
    .sort({ spend: -1 })
    .lean()
}

/**
 * 🎨 获取素材数据
 */
export async function getMaterialData(date: string) {
  if (isRecentDate(date)) {
    // 素材数据需要单独的聚合逻辑（从 MaterialMetrics）
    // TODO: 实现素材数据的实时刷新
  }

  return AggMaterial.find({ date })
    .sort({ spend: -1 })
    .lean()
}

export default {
  refreshAggregation,
  refreshRecentDays,
  getDailySummary,
  getCountryData,
  getAccountData,
  getCampaignData,
  getOptimizerData,
  getMaterialData,
}
