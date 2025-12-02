import Campaign from '../models/Campaign'
import Account from '../models/Account'
import MetricsDaily from '../models/MetricsDaily'
import { fetchCampaigns, fetchInsights } from './facebook.api'
import logger from '../utils/logger'
import dayjs from 'dayjs'

export const syncCampaignsFromAdAccounts = async () => {
  const startTime = Date.now()
  let syncedCampaigns = 0
  let syncedMetrics = 0
  let errorCount = 0

  try {
    // 1. 获取所有有效的广告账户
    const accounts = await Account.find({ status: 'active' })
    logger.info(`Starting campaign sync for ${accounts.length} active ad accounts`)

    for (const account of accounts) {
      if (!account.token) {
        logger.warn(`Account ${account.accountId} has no associated token, skipping campaign sync.`)
        continue
      }

      try {
        // 2. 拉取该账户下的所有广告系列
        const campaigns = await fetchCampaigns(account.accountId, account.token)
        logger.info(`Found ${campaigns.length} campaigns for account ${account.accountId}`)

        for (const camp of campaigns) {
          const campaignData = {
            campaignId: camp.id,
            accountId: account.accountId,
            channel: 'facebook',
            name: camp.name,
            status: camp.status,
            objective: camp.objective,
            buying_type: camp.buying_type,
            daily_budget: camp.daily_budget,
            budget_remaining: camp.budget_remaining,
            created_time: camp.created_time ? new Date(camp.created_time) : undefined,
            updated_time: camp.updated_time ? new Date(camp.updated_time) : undefined,
            raw: camp,
          }

          await Campaign.findOneAndUpdate(
            { campaignId: campaignData.campaignId },
            campaignData,
            { upsert: true, new: true }
          )
          syncedCampaigns++

          // 3. 拉取广告系列的日级别洞察数据 (今天的数据)
          const today = dayjs().format('YYYY-MM-DD')
          const insights = await fetchInsights(
            camp.id,
            'campaign',
            'today', // 或者选择一个日期范围
            account.token
          )

          if (insights && insights.length > 0) {
            for (const insight of insights) {
              const metricsData = {
                date: today,
                channel: 'facebook',
                accountId: account.accountId,
                campaignId: camp.id,
                impressions: insight.impressions || 0,
                clicks: insight.clicks || 0,
                spendUsd: parseFloat(insight.spend || '0'),
                cpc: insight.cpc ? parseFloat(insight.cpc) : undefined,
                ctr: insight.ctr ? parseFloat(insight.ctr) : undefined,
                cpm: insight.cpm ? parseFloat(insight.cpm) : undefined,
                actions: insight.actions, // Raw actions array
                action_values: insight.action_values, // Raw action_values array
                purchase_roas: insight.purchase_roas ? parseFloat(insight.purchase_roas) : undefined,
                purchase_value: getActionValue(insight.action_values, 'purchase'), // 自行计算购物转化价值
                mobile_app_install_count: getActionCount(insight.actions, 'mobile_app_install'), // 自行计算事件转化次数
                raw: insight,
              }
              
              await MetricsDaily.findOneAndUpdate(
                { campaignId: metricsData.campaignId, date: metricsData.date },
                metricsData,
                { upsert: true, new: true }
              )
              syncedMetrics++
            }
          }
        }
      } catch (error: any) {
        errorCount++
        logger.error(`Failed to sync campaigns/insights for account ${account.accountId}: ${error.message}`)
      }
    }

    logger.info(`Campaign sync completed. Synced Campaigns: ${syncedCampaigns}, Synced Metrics: ${syncedMetrics}, Errors: ${errorCount}, Duration: ${Date.now() - startTime}ms`)
    return { syncedCampaigns, syncedMetrics, errorCount }

  } catch (error: any) {
    logger.error('Campaign sync failed:', error)
    throw error
  }
}

// 辅助函数：从 actions 数组中获取特定 action_type 的 value (用于购物转化价值)
const getActionValue = (actions: any[], actionType: string): number | undefined => {
    if (!actions || !Array.isArray(actions)) return undefined;
    const action = actions.find(a => a.action_type === actionType);
    return action ? parseFloat(action.value) : undefined;
};

// 辅助函数：从 actions 数组中获取特定 action_type 的 count (用于事件转化次数)
const getActionCount = (actions: any[], actionType: string): number | undefined => {
    if (!actions || !Array.isArray(actions)) return undefined;
    const action = actions.find(a => a.action_type === actionType);
    return action ? parseInt(action.value) : undefined;
};

export const getCampaigns = async (filters: any = {}, pagination: { page: number, limit: number, sortBy: string, sortOrder: 'asc' | 'desc' }) => {
    const query: any = {}
    
    if (filters.name) {
        query.name = { $regex: filters.name, $options: 'i' }
    }
    if (filters.accountId) {
        query.accountId = filters.accountId
    }
    if (filters.status) {
        query.status = filters.status
    }
    if (filters.objective) {
        query.objective = filters.objective
    }

    const sort: any = {}
    if (pagination.sortBy) {
      sort[pagination.sortBy] = pagination.sortOrder === 'desc' ? -1 : 1
    } else {
      sort.createdAt = -1 // 默认排序
    }

    const total = await Campaign.countDocuments(query)
    const campaigns = await Campaign.find(query)
        .sort(sort)
        .skip((pagination.page - 1) * pagination.limit)
        .limit(pagination.limit)

    // 联表查询最新的 MetricsDaily 数据，以获取消耗、CPM 等实时指标
    const campaignIds = campaigns.map(c => c.campaignId)
    const today = dayjs().format('YYYY-MM-DD')
    const latestMetrics = await MetricsDaily.find({
        campaignId: { $in: campaignIds },
        date: today
    })
    
    // 将指标合并到 Campaign 对象中，直接使用 Facebook 原始字段名
    const campaignsWithMetrics = campaigns.map(campaign => {
        const metrics = latestMetrics.find(m => m.campaignId === campaign.campaignId)
        const campaignObj = campaign.toObject()
        
        // 合并所有 metrics 字段（使用 Facebook 原始字段名）
        const metricsObj: any = metrics ? metrics.toObject() : {}
        
        // 从 actions 和 action_values 中提取具体字段
        const actions = (metricsObj.actions || []) as any[]
        const actionValues = (metricsObj.action_values || []) as any[]
        const purchaseRoas = (metricsObj.purchase_roas || []) as any[]
        
        // 提取各种 action 类型
        const extractedActions: any = {}
        actions.forEach((action: any) => {
            if (action.action_type && action.value !== undefined) {
                extractedActions[action.action_type] = parseFloat(action.value) || 0
            }
        })
        
        // 提取各种 action_value 类型
        const extractedActionValues: any = {}
        actionValues.forEach((action: any) => {
            if (action.action_type && action.value !== undefined) {
                extractedActionValues[`${action.action_type}_value`] = parseFloat(action.value) || 0
            }
        })
        
        // 提取 purchase_roas
        const extractedRoas: any = {}
        purchaseRoas.forEach((roas: any) => {
            if (roas.action_type && roas.value !== undefined) {
                extractedRoas[`${roas.action_type}_roas`] = parseFloat(roas.value) || 0
            }
        })
        
        return {
            ...campaignObj,
            // Campaign 基础字段（使用 Facebook 原始字段名）
            id: campaignObj.campaignId,
            account_id: campaignObj.accountId,
            // Insights 基础字段
            impressions: metricsObj.impressions || 0,
            clicks: metricsObj.clicks || 0,
            spend: metricsObj.spendUsd || 0,
            cpc: metricsObj.cpc,
            ctr: metricsObj.ctr,
            cpm: metricsObj.cpm,
            // 从 raw 中提取其他字段（如果存在）
            ...(metricsObj.raw || {}),
            // 提取的 actions
            ...extractedActions,
            // 提取的 action_values
            ...extractedActionValues,
            // 提取的 purchase_roas
            ...extractedRoas,
            // 保留原始数据
            metrics: metricsObj,
            raw_insights: metricsObj.raw,
        }
    })

    return {
        data: campaignsWithMetrics,
        pagination: {
            total,
            page: pagination.page,
            limit: pagination.limit,
            pages: Math.ceil(total / pagination.limit)
        }
    }
}

// 计算 CPI (Cost Per Install)
const calculateCpi = (metrics: any): number | undefined => {
    if (!metrics || !metrics.mobile_app_install_count || metrics.mobile_app_install_count === 0) return undefined;
    return metrics.spendUsd / metrics.mobile_app_install_count;
};
