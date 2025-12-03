import MetricsDaily from '../../models/MetricsDaily'
import logger from '../../utils/logger'
import dayjs from 'dayjs'

export interface MetricsQueryFilter {
  startDate: string
  endDate: string
  accountId?: string
  campaignIds?: string[]
  adsetIds?: string[]
  adIds?: string[]
  level?: 'account' | 'campaign' | 'adset' | 'ad'
}

export interface CampaignMetricsDTO {
  campaignId: string
  accountId: string
  campaignName?: string // 聚合后可能不带名字，需要上层补充或 join
  spend: number
  impressions: number
  clicks: number
  purchase_value: number
  roas: number
  cpc: number
  ctr: number
  cpm: number
  installs: number
  mobile_app_install_count: number
  actions: any[]
  action_values: any[]
}

export interface EntitySummaryDTO {
  entityId: string
  entityType: string
  spend: number
  roas: number
  purchase_value: number
  cpc: number
  ctr: number
  trend: 'up' | 'down' | 'stable' // 简单趋势判断
  last7DaysData: any[] // 每日趋势
}

class MetricsService {
  /**
   * 通用聚合查询：按日期范围 + 层级聚合
   * 适用于 Dashboard, Campaign List, Account List 等页面
   */
  async getMetrics(filter: MetricsQueryFilter): Promise<any[]> {
    try {
      const matchStage: any = {
        date: { $gte: filter.startDate, $lte: filter.endDate },
      }

      if (filter.level) matchStage.level = filter.level
      if (filter.accountId) matchStage.accountId = filter.accountId
      
      // 注意：MetricsDaily 现在用 level + entityId 索引
      // 如果要查特定 campaignIds，需要看数据结构
      // 如果数据是按 'campaign' level 存的，entityId 就是 campaignId
      // 如果数据是按 'ad' level 存的，也有 campaignId 字段
      
      if (filter.campaignIds && filter.campaignIds.length > 0) {
        matchStage.campaignId = { $in: filter.campaignIds }
      }
      if (filter.adsetIds && filter.adsetIds.length > 0) {
        matchStage.adsetId = { $in: filter.adsetIds }
      }
      if (filter.adIds && filter.adIds.length > 0) {
        matchStage.adId = { $in: filter.adIds }
      }

      // 聚合管道
      const pipeline = [
        { $match: matchStage },
        {
          $group: {
            _id: filter.level === 'account' ? '$accountId' : 
                 filter.level === 'campaign' ? '$campaignId' :
                 filter.level === 'adset' ? '$adsetId' : '$adId',
            
            // 基础指标求和
            spend: { $sum: '$spendUsd' },
            impressions: { $sum: '$impressions' },
            clicks: { $sum: '$clicks' },
            purchase_value: { 
              $sum: { 
                $cond: [
                  { $ifNull: ['$purchase_value_corrected', false] },
                  '$purchase_value_corrected',
                  '$purchase_value'
                ] 
              } 
            },
            installs: { $sum: '$installs' },
            mobile_app_install_count: { $sum: '$mobile_app_install_count' },
            
            // 辅助信息 (取第一条)
            accountId: { $first: '$accountId' },
            campaignId: { $first: '$campaignId' },
            adsetId: { $first: '$adsetId' },
            adId: { $first: '$adId' },
          }
        },
        {
          $addFields: {
            // 计算衍生指标
            cpc: {
              $cond: [{ $gt: ['$clicks', 0] }, { $divide: ['$spend', '$clicks'] }, 0]
            },
            ctr: {
              $cond: [{ $gt: ['$impressions', 0] }, { $divide: ['$clicks', '$impressions'] }, 0]
            },
            cpm: {
              $cond: [{ $gt: ['$impressions', 0] }, { $multiply: [{ $divide: ['$spend', '$impressions'] }, 1000] }, 0]
            },
            roas: {
              $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$purchase_value', '$spend'] }, 0]
            },
            cpi: {
              $cond: [{ $gt: ['$mobile_app_install_count', 0] }, { $divide: ['$spend', '$mobile_app_install_count'] }, 0]
            }
          }
        }
      ]

      const results = await MetricsDaily.aggregate(pipeline)
      return results
    } catch (error) {
      logger.error('[MetricsService] getMetrics failed:', error)
      throw error
    }
  }

  /**
   * 专门获取 Campaign 列表的聚合数据
   */
  async getCampaignMetrics(params: {
    accountId?: string
    campaignIds?: string[]
    startDate: string
    endDate: string
  }): Promise<CampaignMetricsDTO[]> {
    const results = await this.getMetrics({
      ...params,
      level: 'campaign' // 强制按 campaign 聚合
    })

    return results.map(r => ({
      campaignId: r._id,
      accountId: r.accountId,
      spend: r.spend,
      impressions: r.impressions,
      clicks: r.clicks,
      purchase_value: r.purchase_value,
      roas: r.roas,
      cpc: r.cpc,
      ctr: r.ctr,
      cpm: r.cpm,
      installs: r.installs,
      mobile_app_install_count: r.mobile_app_install_count,
      actions: [], // 聚合暂时丢失 actions 详情，如需可增强 pipeline
      action_values: []
    }))
  }

  /**
   * 给优化器用的“最近 N 天摘要”
   */
  async getEntitySummary(params: {
    entityType: 'campaign' | 'ad'
    entityId: string
    window: '1d' | '3d' | '7d' | '30d'
  }): Promise<EntitySummaryDTO> {
    const days = parseInt(params.window)
    const endDate = dayjs().format('YYYY-MM-DD')
    const startDate = dayjs().subtract(days - 1, 'day').format('YYYY-MM-DD')

    const results = await this.getMetrics({
      startDate,
      endDate,
      level: params.entityType,
      campaignIds: params.entityType === 'campaign' ? [params.entityId] : undefined,
      adIds: params.entityType === 'ad' ? [params.entityId] : undefined,
    })

    const data = results[0] || {
      spend: 0, roas: 0, purchase_value: 0, cpc: 0, ctr: 0
    }

    // 获取每日趋势 (用于判断 trend)
    const dailyData = await MetricsDaily.find({
      date: { $gte: startDate, $lte: endDate },
      entityId: params.entityId,
      level: params.entityType
    }).sort({ date: 1 }).lean()

    // 简单判断趋势：看后半段平均 ROAS 是否高于前半段
    let trend: 'up' | 'down' | 'stable' = 'stable'
    if (dailyData.length >= 2) {
      const mid = Math.floor(dailyData.length / 2)
      const firstHalf = dailyData.slice(0, mid)
      const secondHalf = dailyData.slice(mid)
      
      const avgRoas1 = firstHalf.reduce((s, i) => s + (i.purchase_roas || 0), 0) / (firstHalf.length || 1)
      const avgRoas2 = secondHalf.reduce((s, i) => s + (i.purchase_roas || 0), 0) / (secondHalf.length || 1)
      
      if (avgRoas2 > avgRoas1 * 1.1) trend = 'up'
      else if (avgRoas2 < avgRoas1 * 0.9) trend = 'down'
    }

    return {
      entityId: params.entityId,
      entityType: params.entityType,
      spend: data.spend,
      roas: data.roas,
      purchase_value: data.purchase_value,
      cpc: data.cpc,
      ctr: data.ctr,
      trend,
      last7DaysData: dailyData
    }
  }
}

export const metricsService = new MetricsService()
