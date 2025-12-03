import { OptimizationPolicy, OptimizationContext, OptimizationAction } from './basePolicy'
import { aiService } from '../../ai/ai.service'
import OptimizationState from '../../../models/OptimizationState'
import logger from '../../../utils/logger'

/**
 * AI 顾问策略
 * 不直接执行动作，而是分析数据并更新 AI 建议到数据库
 * 前端可以看到这些建议，或者其他策略可以参考这些建议
 */
export class AiAdvisorPolicy implements OptimizationPolicy {
  name = 'ai-advisor-policy'

  async apply(ctx: OptimizationContext): Promise<OptimizationAction> {
    const { summary, currentBudget, targetRoas = 1.0, entityId, entityType } = ctx

    // 1. 调用 AI 分析
    // 为了节省 Token，可以加一些限制条件，比如只分析 spend > $50 的 campaign
    if (summary.spend < 50) {
      return { type: 'NOOP', reason: 'Spend too low for AI analysis' }
    }

    try {
      // 检查最近是否已经分析过 (例如 24 小时内)
      const existingState = await OptimizationState.findOne({ entityType, entityId }).select('aiSuggestion').lean()
      if (existingState?.aiSuggestion?.updatedAt) {
        const lastUpdate = new Date(existingState.aiSuggestion.updatedAt).getTime()
        const now = Date.now()
        // 如果 12 小时内分析过，这就跳过
        if (now - lastUpdate < 12 * 60 * 60 * 1000) {
          return { type: 'NOOP', reason: 'AI analysis is fresh' }
        }
      }

      const suggestion = await aiService.analyzeCampaign(summary, currentBudget, targetRoas)

      // 2. 保存建议到 OptimizationState
      await OptimizationState.findOneAndUpdate(
        { entityType, entityId },
        {
          $set: {
            aiSuggestion: {
              ...suggestion,
              updatedAt: new Date()
            }
          }
        },
        { upsert: true }
      )

      logger.info(`[AiAdvisor] Updated suggestion for ${entityId}: ${suggestion.strategy}`)

      return { type: 'NOOP', reason: 'AI analysis updated' }

    } catch (error) {
      logger.error(`[AiAdvisor] Failed to analyze ${entityId}:`, error)
      return { type: 'NOOP', reason: 'AI analysis failed' }
    }
  }
}
