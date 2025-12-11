import logger from '../utils/logger'
import { AiSuggestion, IAiSuggestion, SuggestionType, SuggestionPriority } from '../models/AiSuggestion'
import { AggDaily, AggCampaign, AggAccount, AggOptimizer } from '../models/Aggregation'
import Campaign from '../models/Campaign'
import AdSet from '../models/AdSet'
import Ad from '../models/Ad'
import FbToken from '../models/FbToken'
import { updateCampaign, updateAdSet, updateAd } from '../integration/facebook/bulkCreate.api'
import dayjs from 'dayjs'

/**
 * 🤖 AI 建议服务
 * 
 * 功能：
 * 1. 分析数据生成优化建议
 * 2. 存储待审批的建议
 * 3. 执行已批准的建议
 */

class AiSuggestionService {
  
  /**
   * 分析数据并生成优化建议
   */
  async generateSuggestions(): Promise<IAiSuggestion[]> {
    logger.info('[AiSuggestion] Generating suggestions...')
    
    const suggestions: Partial<IAiSuggestion>[] = []
    const today = dayjs().format('YYYY-MM-DD')
    const threeDaysAgo = dayjs().subtract(3, 'day').format('YYYY-MM-DD')
    
    // 1. 分析广告系列 - 找出低效的
    const campaigns = await AggCampaign.find({
      date: today,
      spend: { $gt: 10 },  // 消耗 > $10
    }).lean()
    
    for (const campaign of campaigns) {
      // 低 ROAS 广告系列 - 建议暂停
      if (campaign.roas < 0.3 && campaign.spend > 50) {
        suggestions.push({
          type: 'pause_campaign',
          priority: 'high',
          entityType: 'campaign',
          entityId: campaign.campaignId,
          entityName: campaign.campaignName || campaign.campaignId,
          accountId: campaign.accountId,
          title: `暂停低效广告系列`,
          description: `广告系列 "${campaign.campaignName}" ROAS 仅 ${campaign.roas.toFixed(2)}，消耗 $${campaign.spend.toFixed(2)}`,
          reason: `ROAS 低于 0.3 且消耗超过 $50，建议暂停以止损`,
          currentMetrics: {
            roas: campaign.roas,
            spend: campaign.spend,
            impressions: campaign.impressions,
          },
          action: {
            type: 'pause_campaign',
            params: { newStatus: 'PAUSED' },
          },
          expectedImpact: `预计每日节省 $${campaign.spend.toFixed(2)}`,
          source: 'auto_analysis',
        })
      }
      
      // 高 ROAS 广告系列 - 建议扩量
      if (campaign.roas > 2 && campaign.spend > 30) {
        suggestions.push({
          type: 'budget_increase',
          priority: 'medium',
          entityType: 'campaign',
          entityId: campaign.campaignId,
          entityName: campaign.campaignName || campaign.campaignId,
          accountId: campaign.accountId,
          title: `扩量高效广告系列`,
          description: `广告系列 "${campaign.campaignName}" ROAS 达到 ${campaign.roas.toFixed(2)}，表现优秀`,
          reason: `ROAS 超过 2，有扩量空间`,
          currentMetrics: {
            roas: campaign.roas,
            spend: campaign.spend,
          },
          action: {
            type: 'budget_increase',
            params: { budgetChangePercent: 20 },
          },
          expectedImpact: `预计增加收入 $${(campaign.spend * 0.2 * campaign.roas).toFixed(2)}`,
          source: 'auto_analysis',
        })
      }
    }
    
    // 2. 分析账户 - 找出需要关注的
    const accounts = await AggAccount.find({
      date: today,
      spend: { $gt: 50 },
    }).lean()
    
    for (const account of accounts) {
      if (account.roas < 0.5 && account.spend > 100) {
        suggestions.push({
          type: 'alert',
          priority: 'high',
          entityType: 'campaign',  // 账户级别用 campaign
          entityId: account.accountId,
          entityName: account.accountName || account.accountId,
          accountId: account.accountId,
          title: `账户整体效果不佳`,
          description: `账户 "${account.accountName}" 今日 ROAS ${account.roas.toFixed(2)}，消耗 $${account.spend.toFixed(2)}`,
          reason: `账户级别 ROAS 低于 0.5，需要重点关注`,
          currentMetrics: {
            roas: account.roas,
            spend: account.spend,
          },
          action: {
            type: 'alert',
          },
          source: 'auto_analysis',
        })
      }
    }
    
    // 保存建议到数据库
    const savedSuggestions: IAiSuggestion[] = []
    for (const suggestion of suggestions) {
      try {
        // 检查是否已有相同建议（避免重复）
        const existing = await AiSuggestion.findOne({
          entityId: suggestion.entityId,
          type: suggestion.type,
          status: 'pending',
        })
        
        if (!existing) {
          const saved = await AiSuggestion.create(suggestion)
          savedSuggestions.push(saved)
        }
      } catch (error: any) {
        logger.error(`[AiSuggestion] Failed to save suggestion: ${error.message}`)
      }
    }
    
    logger.info(`[AiSuggestion] Generated ${savedSuggestions.length} new suggestions`)
    return savedSuggestions
  }
  
  /**
   * 获取待处理的建议
   */
  async getPendingSuggestions(options?: {
    priority?: SuggestionPriority
    entityType?: string
    accountId?: string
    limit?: number
  }): Promise<IAiSuggestion[]> {
    const query: any = {
      status: 'pending',
      expiresAt: { $gt: new Date() },
    }
    
    if (options?.priority) query.priority = options.priority
    if (options?.entityType) query.entityType = options.entityType
    if (options?.accountId) query.accountId = options.accountId
    
    return AiSuggestion.find(query)
      .sort({ priority: -1, createdAt: -1 })
      .limit(options?.limit || 50)
  }
  
  /**
   * 获取所有建议（包括已执行的）
   */
  async getSuggestions(options?: {
    status?: string
    limit?: number
    skip?: number
  }): Promise<{ suggestions: IAiSuggestion[]; total: number }> {
    const query: any = {}
    if (options?.status) query.status = options.status
    
    const [suggestions, total] = await Promise.all([
      AiSuggestion.find(query)
        .sort({ createdAt: -1 })
        .limit(options?.limit || 50)
        .skip(options?.skip || 0),
      AiSuggestion.countDocuments(query),
    ])
    
    return { suggestions, total }
  }
  
  /**
   * 批准建议
   */
  async approveSuggestion(suggestionId: string, userId: string): Promise<IAiSuggestion | null> {
    return AiSuggestion.findByIdAndUpdate(suggestionId, {
      status: 'approved',
      'execution.executedBy': userId,
    }, { new: true })
  }
  
  /**
   * 拒绝建议
   */
  async rejectSuggestion(suggestionId: string, userId: string): Promise<IAiSuggestion | null> {
    return AiSuggestion.findByIdAndUpdate(suggestionId, {
      status: 'rejected',
      'execution.executedBy': userId,
    }, { new: true })
  }
  
  /**
   * 执行单个建议
   */
  async executeSuggestion(suggestionId: string, userId: string): Promise<IAiSuggestion | null> {
    const suggestion = await AiSuggestion.findById(suggestionId)
    if (!suggestion) {
      throw new Error('Suggestion not found')
    }
    
    if (suggestion.status !== 'pending' && suggestion.status !== 'approved') {
      throw new Error('Suggestion cannot be executed')
    }
    
    try {
      // 获取 token
      const token = await this.getToken(suggestion.accountId)
      if (!token) {
        throw new Error('No valid token found')
      }
      
      // 执行操作
      let result: any = null
      
      switch (suggestion.action.type) {
        case 'pause_campaign':
          await updateCampaign({ token, campaignId: suggestion.entityId, status: 'PAUSED' })
          await Campaign.updateOne({ campaignId: suggestion.entityId }, { status: 'PAUSED' })
          result = { newStatus: 'PAUSED' }
          break
          
        case 'pause_adset':
          await updateAdSet({ token, adsetId: suggestion.entityId, status: 'PAUSED' })
          await AdSet.updateOne({ adsetId: suggestion.entityId }, { status: 'PAUSED' })
          result = { newStatus: 'PAUSED' }
          break
          
        case 'pause_ad':
          await updateAd({ token, adId: suggestion.entityId, status: 'PAUSED' })
          await Ad.updateOne({ adId: suggestion.entityId }, { status: 'PAUSED' })
          result = { newStatus: 'PAUSED' }
          break
          
        case 'enable_ad':
          await updateAd({ token, adId: suggestion.entityId, status: 'ACTIVE' })
          await Ad.updateOne({ adId: suggestion.entityId }, { status: 'ACTIVE' })
          result = { newStatus: 'ACTIVE' }
          break
          
        case 'budget_increase':
        case 'budget_decrease':
          // 获取当前预算并调整
          const campaign = await Campaign.findOne({ campaignId: suggestion.entityId })
          const currentBudget = (campaign?.raw as any)?.daily_budget / 100 || 0
          const changePercent = suggestion.action.params?.budgetChangePercent || 20
          const multiplier = suggestion.action.type === 'budget_increase' ? (1 + changePercent / 100) : (1 - changePercent / 100)
          const newBudget = Math.max(10, currentBudget * multiplier)
          
          await updateCampaign({ token, campaignId: suggestion.entityId, dailyBudget: newBudget })
          result = { oldBudget: currentBudget, newBudget }
          break
          
        case 'alert':
          // 仅预警，不执行实际操作
          result = { acknowledged: true }
          break
          
        default:
          throw new Error(`Unsupported action type: ${suggestion.action.type}`)
      }
      
      // 更新建议状态
      suggestion.status = 'executed'
      suggestion.execution = {
        executedAt: new Date(),
        executedBy: userId,
        success: true,
        result,
      }
      await suggestion.save()
      
      logger.info(`[AiSuggestion] Executed suggestion: ${suggestion.title}`)
      return suggestion
      
    } catch (error: any) {
      // 更新为失败状态
      suggestion.status = 'failed'
      suggestion.execution = {
        executedAt: new Date(),
        executedBy: userId,
        success: false,
        error: error.message,
      }
      await suggestion.save()
      
      logger.error(`[AiSuggestion] Failed to execute suggestion: ${error.message}`)
      throw error
    }
  }
  
  /**
   * 批量执行建议
   */
  async executeBatch(suggestionIds: string[], userId: string): Promise<{
    success: number
    failed: number
    results: Array<{ id: string; success: boolean; error?: string }>
  }> {
    const results: Array<{ id: string; success: boolean; error?: string }> = []
    let success = 0
    let failed = 0
    
    for (const id of suggestionIds) {
      try {
        await this.executeSuggestion(id, userId)
        results.push({ id, success: true })
        success++
      } catch (error: any) {
        results.push({ id, success: false, error: error.message })
        failed++
      }
    }
    
    return { success, failed, results }
  }
  
  /**
   * 清理过期建议
   */
  async cleanupExpired(): Promise<number> {
    const result = await AiSuggestion.updateMany(
      { status: 'pending', expiresAt: { $lt: new Date() } },
      { status: 'expired' }
    )
    
    if (result.modifiedCount > 0) {
      logger.info(`[AiSuggestion] Cleaned up ${result.modifiedCount} expired suggestions`)
    }
    
    return result.modifiedCount
  }
  
  /**
   * 获取统计信息
   */
  async getStats(): Promise<{
    pending: number
    executed: number
    failed: number
    rejected: number
    byPriority: { high: number; medium: number; low: number }
  }> {
    const [pending, executed, failed, rejected, byPriority] = await Promise.all([
      AiSuggestion.countDocuments({ status: 'pending', expiresAt: { $gt: new Date() } }),
      AiSuggestion.countDocuments({ status: 'executed' }),
      AiSuggestion.countDocuments({ status: 'failed' }),
      AiSuggestion.countDocuments({ status: 'rejected' }),
      AiSuggestion.aggregate([
        { $match: { status: 'pending', expiresAt: { $gt: new Date() } } },
        { $group: { _id: '$priority', count: { $sum: 1 } } },
      ]),
    ])
    
    const priorityMap: any = { high: 0, medium: 0, low: 0 }
    byPriority.forEach((p: any) => {
      priorityMap[p._id] = p.count
    })
    
    return {
      pending,
      executed,
      failed,
      rejected,
      byPriority: priorityMap,
    }
  }
  
  /**
   * 获取 token
   */
  private async getToken(accountId: string): Promise<string | null> {
    const token = await FbToken.findOne({
      accounts: { $elemMatch: { accountId } },
      isValid: true,
    })
    return token?.token || null
  }
}

export const aiSuggestionService = new AiSuggestionService()
export default aiSuggestionService
