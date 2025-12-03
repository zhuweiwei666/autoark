import Campaign from '../models/Campaign'
import Account from '../models/Account'
import MetricsDaily from '../models/MetricsDaily'
import { fetchCampaigns, fetchInsights } from './facebook.api'
import logger from '../utils/logger'
import dayjs from 'dayjs'
import { normalizeForApi, normalizeForStorage } from '../utils/accountId'
import { getReadConnection } from '../config/db'
import { getFromCache, setToCache, getCacheKey, CACHE_TTL } from '../utils/cache'
import mongoose from 'mongoose'

export const syncCampaignsFromAdAccounts = async () => {
  const startTime = Date.now()
  let syncedCampaigns = 0
  let syncedMetrics = 0
  let errorCount = 0
  const errors: Array<{ accountId: string; error: string }> = []

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
        // 使用统一工具函数：Facebook API 调用需要带 act_ 前缀
        const accountIdForApi = normalizeForApi(account.accountId)
        const campaigns = await fetchCampaigns(accountIdForApi, account.token)
        logger.info(`Found ${campaigns.length} campaigns for account ${account.accountId}`)

        for (const camp of campaigns) {
          const campaignData = {
            campaignId: camp.id,
            accountId: normalizeForStorage(account.accountId), // 统一格式：数据库存储时去掉前缀
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
          // 使用 breakdowns: ['country'] 来获取按国家分组的数据
          const today = dayjs().format('YYYY-MM-DD')
          const insights = await fetchInsights(
            camp.id,
            'campaign',
            'today', // 或者选择一个日期范围
            account.token,
            ['country'] // 按国家分组
          )

          if (insights && insights.length > 0) {
            for (const insight of insights) {
              // Facebook API 返回的 country 字段在 breakdowns 中
              const country = insight.country || null
              
              const metricsData: any = {
                date: today,
                channel: 'facebook',
                accountId: normalizeForStorage(account.accountId), // 统一格式：数据库存储时去掉前缀
                campaignId: camp.id,
                country: country, // 国家代码
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
              
              // Campaign + Country 级别的指标，不设置 adId 和 adsetId，避免与 { adId: 1, date: 1 } 唯一索引冲突
              // 使用 $set 更新数据，$unset 移除可能存在的 adId 和 adsetId 字段
              await MetricsDaily.findOneAndUpdate(
                { campaignId: metricsData.campaignId, date: metricsData.date, country: country || null },
                {
                  $set: metricsData,
                  $unset: { adId: '', adsetId: '' } // 移除 adId 和 adsetId，避免唯一索引冲突
                },
                { upsert: true, new: true }
              )
              syncedMetrics++
            }
          }
        }
      } catch (error: any) {
        errorCount++
        const errorMsg = error.message || String(error)
        errors.push({ accountId: account.accountId, error: errorMsg })
        logger.error(`Failed to sync campaigns/insights for account ${account.accountId}: ${errorMsg}`)
      }
    }

    logger.info(`Campaign sync completed. Synced Campaigns: ${syncedCampaigns}, Synced Metrics: ${syncedMetrics}, Errors: ${errorCount}, Duration: ${Date.now() - startTime}ms`)
    return { syncedCampaigns, syncedMetrics, errorCount, errors }

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

    // 使用读连接进行查询（读写分离）
    const readConnection = getReadConnection()
    
    let CampaignModel = Campaign
    if (readConnection !== mongoose) {
      if (!readConnection.models.Campaign) {
        CampaignModel = readConnection.model('Campaign', Campaign.schema)
      } else {
        CampaignModel = readConnection.models.Campaign
      }
    }
    
    // 判断排序字段是否是 metrics 字段（需要从 MetricsDaily 获取）
    const metricsSortFields = ['spend', 'impressions', 'clicks', 'cpc', 'ctr', 'cpm', 'purchase_roas', 'purchase_value', 'mobile_app_install']
    const isMetricsSort = metricsSortFields.includes(pagination.sortBy)
    
    let campaigns: any[] = []
    let total = 0
    
    if (isMetricsSort) {
        // 如果按 metrics 字段排序，需要先查询所有符合条件的 campaigns，然后按 metrics 排序
        const allCampaigns = await CampaignModel.find(query).lean()
        const allCampaignIds = allCampaigns.map(c => c.campaignId)
        total = allCampaignIds.length
        
        if (allCampaignIds.length === 0) {
            return {
                data: [],
                pagination: {
                    page: pagination.page,
                    limit: pagination.limit,
                    total: 0,
                    pages: 0,
                },
            }
        }
        
        // 查询所有 campaigns 的 metrics 数据
        const today = dayjs().format('YYYY-MM-DD')
        const metricsQuery: any = {
            campaignId: { $in: allCampaignIds, $exists: true, $ne: null } // 只统计 campaign 级别的数据
        }
        
        if (filters.startDate || filters.endDate) {
            metricsQuery.date = {}
            if (filters.startDate) {
                metricsQuery.date.$gte = filters.startDate
            }
            if (filters.endDate) {
                metricsQuery.date.$lte = filters.endDate
            }
        } else {
            metricsQuery.date = today
        }
        
        // 获取所有 campaigns 的 metrics
        let MetricsDailyRead = MetricsDaily
        if (readConnection !== mongoose) {
          if (!readConnection.models.MetricsDaily) {
            MetricsDailyRead = readConnection.model('MetricsDaily', MetricsDaily.schema)
          } else {
            MetricsDailyRead = readConnection.models.MetricsDaily
          }
        }
        
        let allMetricsData: any[] = []
        if (filters.startDate || filters.endDate) {
            allMetricsData = await MetricsDailyRead.aggregate([
                { $match: metricsQuery },
                { $sort: { date: -1 } },
                {
                    $group: {
                        _id: '$campaignId',
                        spendUsd: { $sum: '$spendUsd' },
                        impressions: { $sum: '$impressions' },
                        clicks: { $sum: '$clicks' },
                        purchase_value: { $sum: { $ifNull: ['$purchase_value', 0] } },
                        mobile_app_install: { $sum: { $ifNull: ['$mobile_app_install_count', 0] } },
                        // 计算加权平均值
                        totalCpc: { $sum: { $multiply: [{ $ifNull: ['$cpc', 0] }, { $ifNull: ['$clicks', 0] }] } },
                        totalCpm: { $sum: { $multiply: [{ $ifNull: ['$cpm', 0] }, { $ifNull: ['$impressions', 0] }] } },
                        purchase_roas: { $first: '$purchase_roas' },
                    }
                },
                {
                    $project: {
                        _id: 1,
                        spendUsd: 1,
                        impressions: 1,
                        clicks: 1,
                        purchase_value: 1,
                        mobile_app_install: 1,
                        purchase_roas: 1,
                        // 计算正确的 CTR（clicks / impressions）
                        ctr: {
                            $cond: [
                                { $gt: ['$impressions', 0] },
                                { $divide: ['$clicks', '$impressions'] },
                                0
                            ]
                        },
                        // 计算加权平均 CPC
                        cpc: {
                            $cond: [
                                { $gt: ['$clicks', 0] },
                                { $divide: ['$totalCpc', '$clicks'] },
                                0
                            ]
                        },
                        // 计算加权平均 CPM
                        cpm: {
                            $cond: [
                                { $gt: ['$impressions', 0] },
                                { $divide: ['$totalCpm', '$impressions'] },
                                0
                            ]
                        }
                    }
                }
            ]).allowDiskUse(true)
        } else {
            const todayMetrics = await MetricsDailyRead.find(metricsQuery)
                .hint({ campaignId: 1, date: 1 })
                .lean()
            
            allMetricsData = todayMetrics.map((metric: any) => {
                // 计算正确的 CTR（clicks / impressions），而不是直接使用存储的 CTR
                const impressions = metric.impressions || 0
                const clicks = metric.clicks || 0
                const ctr = impressions > 0 ? clicks / impressions : 0
                
                return {
                    _id: metric.campaignId,
                    spendUsd: metric.spendUsd || 0,
                    impressions: impressions,
                    clicks: clicks,
                    cpc: metric.cpc,
                    ctr: ctr, // 使用计算出的 CTR
                    cpm: metric.cpm,
                    purchase_roas: metric.purchase_roas,
                    purchase_value: metric.purchase_value || 0,
                    mobile_app_install: metric.mobile_app_install_count || 0,
                }
            })
        }
        
        // 创建 metrics Map
        const metricsMap = new Map<string, any>()
        allMetricsData.forEach((item: any) => {
            metricsMap.set(item._id, item)
        })
        
        // 合并 campaigns 和 metrics，然后排序
        const campaignsWithMetrics = allCampaigns.map(campaign => {
            const metrics = metricsMap.get(campaign.campaignId) || {}
            const impressions = metrics.impressions || 0
            const clicks = metrics.clicks || 0
            // 计算正确的 CTR（clicks / impressions）
            const calculatedCtr = impressions > 0 ? clicks / impressions : 0
            
            return {
                ...campaign,
                spend: metrics.spendUsd || 0,
                impressions: impressions,
                clicks: clicks,
                cpc: metrics.cpc || 0,
                ctr: calculatedCtr, // 使用计算出的 CTR
                cpm: metrics.cpm || 0,
                purchase_roas: metrics.purchase_roas || 0,
                purchase_value: metrics.purchase_value || 0,
                mobile_app_install: metrics.mobile_app_install || 0,
            }
        })
        
        // 按 metrics 字段排序
        campaignsWithMetrics.sort((a, b) => {
            const aValue = a[pagination.sortBy] || 0
            const bValue = b[pagination.sortBy] || 0
            if (pagination.sortOrder === 'desc') {
                return bValue - aValue
            } else {
                return aValue - bValue
            }
        })
        
        // 分页
        const startIndex = (pagination.page - 1) * pagination.limit
        campaigns = campaignsWithMetrics.slice(startIndex, startIndex + pagination.limit)
        
        // 对于 metrics 排序，已经合并了 metrics 数据，直接返回
        // 需要将 campaigns 转换为正确的格式
        const campaignsWithMetricsFormatted = campaigns.map(campaign => {
            const campaignObj = campaign
            const metrics = metricsMap.get(campaign.campaignId) || {}
            
            // 从 actions 和 action_values 中提取具体字段
            const actions = (metrics.actions || []) as any[]
            const actionValues = (metrics.action_values || []) as any[]
            const purchaseRoas = (metrics.purchase_roas || []) as any[]
            
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
                id: campaignObj.campaignId,
                account_id: campaignObj.accountId,
                impressions: metrics.impressions || 0,
                clicks: metrics.clicks || 0,
                spend: metrics.spendUsd || 0,
                cpc: metrics.cpc,
                ctr: metrics.ctr,
                cpm: metrics.cpm,
                ...(metrics.raw || {}),
                ...extractedActions,
                ...extractedActionValues,
                ...extractedRoas,
                metrics: metrics,
                raw_insights: metrics.raw,
            }
        })
        
        return {
            data: campaignsWithMetricsFormatted,
            pagination: {
                total,
                page: pagination.page,
                limit: pagination.limit,
                pages: Math.ceil(total / pagination.limit)
            }
        }
    } else {
        // 如果按 Campaign 表字段排序，也需要先获取所有符合条件的 campaigns，排序后再分页
        const allCampaigns = await CampaignModel.find(query).lean()
        total = allCampaigns.length
        
        if (allCampaigns.length === 0) {
            return {
                data: [],
                pagination: {
                    page: pagination.page,
                    limit: pagination.limit,
                    total: 0,
                    pages: 0,
                },
            }
        }
        
        // 对所有 campaigns 进行排序
        const sortField = pagination.sortBy || 'createdAt'
        const sortOrder = pagination.sortOrder === 'desc' ? -1 : 1
        
        allCampaigns.sort((a: any, b: any) => {
            const aValue = a[sortField]
            const bValue = b[sortField]
            
            // 处理 null/undefined 值
            if (aValue == null && bValue == null) return 0
            if (aValue == null) return 1 // null 值排在后面
            if (bValue == null) return -1
            
            // 处理字符串比较
            if (typeof aValue === 'string' && typeof bValue === 'string') {
                return sortOrder * aValue.localeCompare(bValue)
            }
            
            // 处理数字比较
            if (typeof aValue === 'number' && typeof bValue === 'number') {
                return sortOrder * (aValue - bValue)
            }
            
            // 处理日期比较
            if (aValue instanceof Date && bValue instanceof Date) {
                return sortOrder * (aValue.getTime() - bValue.getTime())
            }
            
            // 默认比较
            return sortOrder * (aValue > bValue ? 1 : aValue < bValue ? -1 : 0)
        })
        
        // 分页
        const startIndex = (pagination.page - 1) * pagination.limit
        campaigns = allCampaigns.slice(startIndex, startIndex + pagination.limit)
    }

    // 联表查询 MetricsDaily 数据，以获取消耗、CPM 等实时指标（仅用于非 metrics 排序的情况）
    const campaignIds = campaigns.map(c => c.campaignId)
    
    // 如果没有 campaignIds，直接返回空数据
    if (campaignIds.length === 0) {
        return {
            data: campaigns.map((campaign: any) => {
                // 使用 .lean() 后，campaign 已经是普通对象，不需要 toObject()
                const campaignObj = campaign.toObject ? campaign.toObject() : campaign
                return {
                    ...campaignObj,
                    spend: 0,
                    impressions: 0,
                    clicks: 0,
                    cpc: 0,
                    ctr: 0,
                    cpm: 0,
                    purchase_roas: 0,
                    purchase_value: 0,
                    mobile_app_install: 0,
                }
            }),
            pagination: {
                page: pagination.page,
                limit: pagination.limit,
                total,
                pages: Math.ceil(total / pagination.limit),
            },
        }
    }
    
    // 性能优化：只查询当前页的 campaigns 的 metrics
    // 构建日期查询条件：如果有日期范围，使用日期范围；否则使用今天
    const startTime = Date.now()
    let metricsData: any[] = []
    
    // 尝试从缓存获取数据
    const cacheKey = getCacheKey('campaigns:metrics', {
        campaignIds: campaignIds.sort().join(','),
        startDate: filters.startDate || '',
        endDate: filters.endDate || '',
        page: pagination.page,
        limit: pagination.limit,
    })
    
    const isToday = !filters.startDate && !filters.endDate
    const cacheTtl = isToday ? CACHE_TTL.TODAY : CACHE_TTL.DATE_RANGE
    
    const cachedData = await getFromCache<any[]>(cacheKey)
    if (cachedData) {
        logger.info(`[getCampaigns] Cache hit for key: ${cacheKey}`)
        metricsData = cachedData
    } else {
        // 缓存未命中，从数据库查询
        try {
            // 使用读连接进行查询（读写分离）
            const readConnection = getReadConnection()
            let MetricsDailyRead: any = MetricsDaily
            
            // 如果读连接是独立的连接，需要使用该连接的模型
            if (readConnection !== mongoose) {
              if (!readConnection.models.MetricsDaily) {
                MetricsDailyRead = readConnection.model('MetricsDaily', MetricsDaily.schema)
              } else {
                MetricsDailyRead = readConnection.models.MetricsDaily
              }
            }
            
            if (filters.startDate || filters.endDate) {
                // 有日期范围：使用优化的聚合查询
                const dateQuery: any = {
                    campaignId: { $in: campaignIds }
                }
                if (filters.startDate) {
                    dateQuery.date = { $gte: filters.startDate }
                }
                if (filters.endDate) {
                    if (dateQuery.date) {
                        dateQuery.date.$lte = filters.endDate
                    } else {
                        dateQuery.date = { $lte: filters.endDate }
                    }
                }
                
                // 优化：直接按 campaignId 聚合，不需要先按日期分组
                // 因为每个 campaignId + date 组合在 MetricsDaily 中已经是唯一的（有唯一索引）
                metricsData = await MetricsDailyRead.aggregate([
                    { 
                        $match: dateQuery,
                        // 使用索引提示：优先使用 { campaignId: 1, date: 1 } 复合索引
                    },
                    {
                        $sort: { date: -1 } // 按日期降序排序，确保 $last 获取最新的数据
                    },
                    {
                        $group: {
                            _id: '$campaignId',
                            spendUsd: { $sum: '$spendUsd' },
                            impressions: { $sum: '$impressions' },
                            clicks: { $sum: '$clicks' },
                            purchase_value: { $sum: { $ifNull: ['$purchase_value', 0] } },
                            mobile_app_install: { $sum: { $ifNull: ['$mobile_app_install_count', 0] } },
                            // 计算加权平均值
                            totalCpc: { $sum: { $multiply: [{ $ifNull: ['$cpc', 0] }, { $ifNull: ['$clicks', 0] }] } },
                            totalCpm: { $sum: { $multiply: [{ $ifNull: ['$cpm', 0] }, { $ifNull: ['$impressions', 0] }] } },
                            // 取最新的 actions 和 action_values（按日期排序后）
                            actions: { $first: '$actions' }, // 因为已经按日期降序排序，$first 就是最新的
                            action_values: { $first: '$action_values' },
                            purchase_roas: { $first: '$purchase_roas' },
                            raw: { $first: '$raw' }
                        }
                    },
                    {
                        $project: {
                            _id: 1,
                            spendUsd: 1,
                            impressions: 1,
                            clicks: 1,
                            purchase_value: 1,
                            mobile_app_install: 1,
                            actions: 1,
                            action_values: 1,
                            purchase_roas: 1,
                            raw: 1,
                            // 计算正确的 CTR（clicks / impressions）
                            ctr: {
                                $cond: [
                                    { $gt: ['$impressions', 0] },
                                    { $divide: ['$clicks', '$impressions'] },
                                    0
                                ]
                            },
                            // 计算加权平均 CPC
                            cpc: {
                                $cond: [
                                    { $gt: ['$clicks', 0] },
                                    { $divide: ['$totalCpc', '$clicks'] },
                                    0
                                ]
                            },
                            // 计算加权平均 CPM
                            cpm: {
                                $cond: [
                                    { $gt: ['$impressions', 0] },
                                    { $divide: ['$totalCpm', '$impressions'] },
                                    0
                                ]
                            }
                        }
                    }
                ])
                .hint({ campaignId: 1, date: 1 }) // 强制使用复合索引
                .allowDiskUse(true)
            } else {
                // 没有日期范围（使用今天）：直接查询，不需要聚合
                // 因为每个 campaignId + date 组合是唯一的，可以直接 find
    const today = dayjs().format('YYYY-MM-DD')
                
                // 性能优化：如果 campaignIds 数量很大（>100），分批查询
                const BATCH_SIZE = 100
                if (campaignIds.length > BATCH_SIZE) {
                const batches: string[][] = []
                for (let i = 0; i < campaignIds.length; i += BATCH_SIZE) {
                    batches.push(campaignIds.slice(i, i + BATCH_SIZE))
                }
                
                    const batchResults = await Promise.all(
                        batches.map(batchIds =>
                            MetricsDailyRead.find({
                                campaignId: { $in: batchIds },
                                date: today
                            })
                            .hint({ campaignId: 1, date: 1 })
                            .lean()
                        )
                    )
                    
                    const todayMetrics = batchResults.flat()
                    metricsData = todayMetrics.map((metric: any) => {
                        // 计算正确的 CTR（clicks / impressions），而不是直接使用存储的 CTR
                        const impressions = metric.impressions || 0
                        const clicks = metric.clicks || 0
                        const ctr = impressions > 0 ? clicks / impressions : 0
                        
                        // 从 action_values 中提取 purchase_value（如果数据库中没有存储）
                        let purchase_value = metric.purchase_value
                        if (!purchase_value && metric.action_values && Array.isArray(metric.action_values)) {
                            const purchaseAction = metric.action_values.find((a: any) => 
                                a.action_type === 'purchase' || a.action_type === 'mobile_app_purchase'
                            )
                            if (purchaseAction) {
                                purchase_value = parseFloat(purchaseAction.value) || 0
                            }
                        }
                        
                        return {
                            _id: metric.campaignId,
                            spendUsd: metric.spendUsd || 0,
                            impressions: impressions,
                            clicks: clicks,
                            cpc: metric.cpc,
                            ctr: ctr, // 使用计算出的 CTR
                            cpm: metric.cpm,
                            actions: metric.actions,
                            action_values: metric.action_values,
                            purchase_roas: metric.purchase_roas,
                            purchase_value: purchase_value || 0,
                            raw: metric.raw
                        }
                    })
                } else {
                    const todayMetrics = await MetricsDailyRead.find({
        campaignId: { $in: campaignIds },
        date: today
                    })
                    .hint({ campaignId: 1, date: 1 }) // 强制使用复合索引
                    .lean() // 使用 lean() 提高性能
                    
                    // 转换为聚合结果的格式
                    metricsData = todayMetrics.map((metric: any) => {
                        // 计算正确的 CTR（clicks / impressions），而不是直接使用存储的 CTR
                        const impressions = metric.impressions || 0
                        const clicks = metric.clicks || 0
                        const ctr = impressions > 0 ? clicks / impressions : 0
                        
                        // 从 action_values 中提取 purchase_value（如果数据库中没有存储）
                        let purchase_value = metric.purchase_value
                        if (!purchase_value && metric.action_values && Array.isArray(metric.action_values)) {
                            const purchaseAction = metric.action_values.find((a: any) => 
                                a.action_type === 'purchase' || a.action_type === 'mobile_app_purchase'
                            )
                            if (purchaseAction) {
                                purchase_value = parseFloat(purchaseAction.value) || 0
                            }
                        }
                        
                        return {
                            _id: metric.campaignId,
                            spendUsd: metric.spendUsd || 0,
                            impressions: impressions,
                            clicks: clicks,
                            cpc: metric.cpc,
                            ctr: ctr, // 使用计算出的 CTR
                            cpm: metric.cpm,
                            actions: metric.actions,
                            action_values: metric.action_values,
                            purchase_roas: metric.purchase_roas,
                            purchase_value: purchase_value || 0,
                            raw: metric.raw
                        }
                    })
                }
            }
            
            const queryTime = Date.now() - startTime
            if (queryTime > 1000) {
                logger.warn(`[getCampaigns] Query time: ${queryTime}ms for ${campaignIds.length} campaigns, dateRange: ${filters.startDate || 'today'} - ${filters.endDate || 'today'}`)
            }
            
            // 将查询结果存入缓存
            await setToCache(cacheKey, metricsData, cacheTtl)
        } catch (error: any) {
            logger.error(`[getCampaigns] Metrics query failed: ${error.message}`, error)
            // 如果查询失败，返回空指标数据，但继续返回 campaigns
            metricsData = []
        }
    }
    
    // 转换为 Map 以便快速查找
    const metricsMap = new Map<string, any>()
    metricsData.forEach((item: any) => {
        metricsMap.set(item._id, item)
    })
    
    // 将指标合并到 Campaign 对象中，直接使用 Facebook 原始字段名
    const campaignsWithMetrics = campaigns.map(campaign => {
        const metrics = metricsMap.get(campaign.campaignId)
        // 使用 .lean() 后，campaign 已经是普通对象，不需要 toObject()
        const campaignObj = campaign.toObject ? campaign.toObject() : campaign
        
        // 合并所有 metrics 字段（使用 Facebook 原始字段名）
        const metricsObj: any = metrics || {}
        
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
        
        // 计算正确的 CTR（clicks / impressions），而不是直接使用存储的 CTR
        const impressions = metricsObj.impressions || 0
        const clicks = metricsObj.clicks || 0
        const calculatedCtr = impressions > 0 ? clicks / impressions : 0
        
        // 优先使用 metricsObj 中的 purchase_value，如果没有则从 action_values 中提取
        let purchase_value = metricsObj.purchase_value
        
        // 如果 purchase_value 是 undefined 或 null，尝试从 action_values 中提取
        if ((purchase_value === undefined || purchase_value === null) && actionValues && actionValues.length > 0) {
            // 尝试从 action_values 中提取 purchase value
            const purchaseAction = actionValues.find((a: any) => 
                a.action_type === 'purchase' || a.action_type === 'mobile_app_purchase'
            )
            if (purchaseAction && purchaseAction.value !== undefined) {
                purchase_value = parseFloat(purchaseAction.value) || 0
            }
        }
        // 如果还是没有，尝试从 extractedActionValues 中获取
        if ((purchase_value === undefined || purchase_value === null) && extractedActionValues.purchase_value !== undefined) {
            purchase_value = extractedActionValues.purchase_value
        }
        if ((purchase_value === undefined || purchase_value === null) && extractedActionValues.mobile_app_purchase_value !== undefined) {
            purchase_value = extractedActionValues.mobile_app_purchase_value
        }
        
        // 调试日志：如果 purchase_value 仍然为 0，记录相关信息
        if (campaignObj.campaignId && (!purchase_value || purchase_value === 0)) {
            logger.debug(`[getCampaigns] Campaign ${campaignObj.campaignId}: purchase_value=${purchase_value}, metricsObj.purchase_value=${metricsObj.purchase_value}, actionValues.length=${actionValues?.length || 0}, extractedActionValues=${JSON.stringify(extractedActionValues)}`)
        }
        
        return {
            ...campaignObj,
            // Campaign 基础字段（使用 Facebook 原始字段名）
            id: campaignObj.campaignId,
            account_id: campaignObj.accountId,
            // Insights 基础字段
            impressions: impressions,
            clicks: clicks,
            spend: metricsObj.spendUsd || 0,
            cpc: metricsObj.cpc,
            ctr: calculatedCtr, // 使用计算出的 CTR
            cpm: metricsObj.cpm,
            purchase_value: purchase_value || 0, // 确保 purchase_value 被包含
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
