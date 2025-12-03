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
          const today = dayjs().format('YYYY-MM-DD')
          const insights = await fetchInsights(
            camp.id,
            'campaign',
            'today', // 或者选择一个日期范围
            account.token
          )

          if (insights && insights.length > 0) {
            for (const insight of insights) {
              const metricsData: any = {
                date: today,
                channel: 'facebook',
                accountId: normalizeForStorage(account.accountId), // 统一格式：数据库存储时去掉前缀
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
              
              // Campaign 级别的指标，不设置 adId 和 adsetId，避免与 { adId: 1, date: 1 } 唯一索引冲突
              // 使用 $set 更新数据，$unset 移除可能存在的 adId 和 adsetId 字段
              await MetricsDaily.findOneAndUpdate(
                { campaignId: metricsData.campaignId, date: metricsData.date },
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

    const sort: any = {}
    if (pagination.sortBy) {
      sort[pagination.sortBy] = pagination.sortOrder === 'desc' ? -1 : 1
    } else {
      sort.createdAt = -1 // 默认排序
    }

    // 使用读连接进行查询（读写分离）
    // 注意：Mongoose 的读偏好会在连接级别生效
    // 如果配置了独立的读连接，使用读连接；否则使用主连接（但会使用读偏好）
    const readConnection = getReadConnection()
    
    // 如果读连接是独立的连接，需要使用该连接的模型
    // 否则使用主连接的模型（但会使用读偏好）
    let CampaignModel = Campaign
    if (readConnection !== mongoose) {
      // 独立的读连接，需要注册模型
      if (!readConnection.models.Campaign) {
        CampaignModel = readConnection.model('Campaign', Campaign.schema)
      } else {
        CampaignModel = readConnection.models.Campaign
      }
    }
    
    const total = await CampaignModel.countDocuments(query)
    const campaigns = await CampaignModel.find(query)
        .sort(sort)
        .skip((pagination.page - 1) * pagination.limit)
        .limit(pagination.limit)

    // 联表查询 MetricsDaily 数据，以获取消耗、CPM 等实时指标
    const campaignIds = campaigns.map(c => c.campaignId)
    
    // 如果没有 campaignIds，直接返回空数据
    if (campaignIds.length === 0) {
        return {
            data: campaigns.map((campaign: any) => ({
                ...campaign.toObject(),
                spend: 0,
                impressions: 0,
                clicks: 0,
                cpc: 0,
                ctr: 0,
                cpm: 0,
                purchase_roas: 0,
                purchase_value: 0,
                mobile_app_install: 0,
            })),
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
                            // 对于平均值，需要加权平均或简单平均（根据业务需求）
                            cpc: { $avg: '$cpc' },
                            ctr: { $avg: '$ctr' },
                            cpm: { $avg: '$cpm' },
                            // 取最新的 actions 和 action_values（按日期排序后）
                            actions: { $first: '$actions' }, // 因为已经按日期降序排序，$first 就是最新的
                            action_values: { $first: '$action_values' },
                            purchase_roas: { $first: '$purchase_roas' },
                            raw: { $first: '$raw' }
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
                    metricsData = todayMetrics.map((metric: any) => ({
                        _id: metric.campaignId,
                        spendUsd: metric.spendUsd || 0,
                        impressions: metric.impressions || 0,
                        clicks: metric.clicks || 0,
                        cpc: metric.cpc,
                        ctr: metric.ctr,
                        cpm: metric.cpm,
                        actions: metric.actions,
                        action_values: metric.action_values,
                        purchase_roas: metric.purchase_roas,
                        raw: metric.raw
                    }))
                } else {
                    const todayMetrics = await MetricsDailyRead.find({
                        campaignId: { $in: campaignIds },
                        date: today
                    })
                    .hint({ campaignId: 1, date: 1 }) // 强制使用复合索引
                    .lean() // 使用 lean() 提高性能
                    
                    // 转换为聚合结果的格式
                    metricsData = todayMetrics.map((metric: any) => ({
                        _id: metric.campaignId,
                        spendUsd: metric.spendUsd || 0,
                        impressions: metric.impressions || 0,
                        clicks: metric.clicks || 0,
                        cpc: metric.cpc,
                        ctr: metric.ctr,
                        cpm: metric.cpm,
                        actions: metric.actions,
                        action_values: metric.action_values,
                        purchase_roas: metric.purchase_roas,
                        raw: metric.raw
                    }))
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
        const campaignObj = campaign.toObject()
        
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
