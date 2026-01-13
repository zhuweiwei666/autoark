/**
 * Agent 健康度分析服务
 * 分析账户的健康状态（ROAS、消耗异常等）
 */

import dayjs from 'dayjs'
import MetricsDaily from '../../../models/MetricsDaily'
import logger from '../../../utils/logger'

export interface HealthAnalysis {
  score: number
  status: 'healthy' | 'warning' | 'critical'
  metrics: {
    todaySpend: number
    todayRevenue: number
    todayRoas: number
    yesterdayRoas: number
    weekAvgRoas: number
    activeCampaigns: number
  }
  issues: string[]
  suggestions: string[]
  analyzedAt: Date
}

class HealthService {
  /**
   * 获取账户健康度分析
   */
  async analyzeHealth(accountId?: string): Promise<HealthAnalysis> {
    const today = dayjs().format('YYYY-MM-DD')
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
    const sevenDaysAgo = dayjs().subtract(7, 'day').format('YYYY-MM-DD')

    const matchQuery: any = { campaignId: { $exists: true, $ne: null } }
    if (accountId) matchQuery.accountId = accountId

    // 今日数据
    const todayMetrics = await MetricsDaily.aggregate([
      { $match: { ...matchQuery, date: today } },
      {
        $group: {
          _id: null,
          spend: { $sum: '$spendUsd' },
          revenue: { $sum: { $ifNull: ['$purchase_value', 0] } },
          impressions: { $sum: '$impressions' },
          clicks: { $sum: '$clicks' },
          campaigns: { $addToSet: '$campaignId' }
        }
      }
    ])

    // 昨日数据
    const yesterdayMetrics = await MetricsDaily.aggregate([
      { $match: { ...matchQuery, date: yesterday } },
      {
        $group: {
          _id: null,
          spend: { $sum: '$spendUsd' },
          revenue: { $sum: { $ifNull: ['$purchase_value', 0] } },
        }
      }
    ])

    // 7天平均
    const weekMetrics = await MetricsDaily.aggregate([
      { $match: { ...matchQuery, date: { $gte: sevenDaysAgo, $lte: today } } },
      {
        $group: {
          _id: null,
          avgSpend: { $avg: '$spendUsd' },
          avgRevenue: { $avg: { $ifNull: ['$purchase_value', 0] } },
        }
      }
    ])

    const todayData = todayMetrics[0] || { spend: 0, revenue: 0, impressions: 0, clicks: 0, campaigns: [] }
    const yesterdayData = yesterdayMetrics[0] || { spend: 0, revenue: 0 }
    const weekData = weekMetrics[0] || { avgSpend: 0, avgRevenue: 0 }

    const todayRoas = todayData.spend > 0 ? todayData.revenue / todayData.spend : 0
    const yesterdayRoas = yesterdayData.spend > 0 ? yesterdayData.revenue / yesterdayData.spend : 0
    const weekAvgRoas = weekData.avgSpend > 0 ? weekData.avgRevenue / weekData.avgSpend : 0

    // 计算健康度评分
    let score = 100
    const issues: string[] = []
    const suggestions: string[] = []

    // ROAS 评估
    if (todayRoas < 0.5) {
      score -= 30
      issues.push(`今日 ROAS 过低 (${todayRoas.toFixed(2)})`)
      suggestions.push('检查亏损广告系列，考虑暂停或降低预算')
    } else if (todayRoas < 1) {
      score -= 15
      issues.push(`今日 ROAS 低于盈亏平衡点 (${todayRoas.toFixed(2)})`)
    }

    // ROAS 变化
    if (yesterdayRoas > 0 && todayRoas < yesterdayRoas * 0.7) {
      score -= 20
      issues.push(`ROAS 较昨日下降 ${((1 - todayRoas / yesterdayRoas) * 100).toFixed(1)}%`)
      suggestions.push('分析下降原因，检查是否有异常广告系列')
    }

    // 消耗异常
    if (weekData.avgSpend > 0 && todayData.spend > weekData.avgSpend * 2) {
      score -= 10
      issues.push(`今日消耗异常高，是7日均值的 ${(todayData.spend / weekData.avgSpend).toFixed(1)} 倍`)
      suggestions.push('检查是否有预算设置错误或突发流量')
    }

    return {
      score: Math.max(0, score),
      status: score >= 80 ? 'healthy' : score >= 50 ? 'warning' : 'critical',
      metrics: {
        todaySpend: todayData.spend,
        todayRevenue: todayData.revenue,
        todayRoas,
        yesterdayRoas,
        weekAvgRoas,
        activeCampaigns: todayData.campaigns?.length || 0,
      },
      issues,
      suggestions,
      analyzedAt: new Date(),
    }
  }
}

export const healthService = new HealthService()
