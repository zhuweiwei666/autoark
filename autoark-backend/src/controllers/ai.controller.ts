import { Request, Response } from 'express'
import { metricsService } from '../domain/analytics/metrics.service'
import { llmAdvisor } from '../domain/optimizer/ai/llm.advisor'
import OptimizationState from '../models/OptimizationState'
import AiSuggestion from '../models/AiSuggestion'
import Campaign from '../models/Campaign'
import dayjs from 'dayjs'
import logger from '../utils/logger'

/**
 * 获取 AI 建议
 * 触发一次 LLM 分析并保存建议
 */
export const generateAiSuggestion = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params
    const today = dayjs().format('YYYY-MM-DD')

    // 1. 检查今天是否已有建议
    const existing = await AiSuggestion.findOne({ campaignId, date: today })
    if (existing) {
      return res.json({ success: true, data: existing, message: 'Returned existing suggestion' })
    }

    // 2. 获取数据
    const summary = await metricsService.getEntitySummary({
      entityType: 'campaign',
      entityId: campaignId,
      window: '7d',
    })

    // 3. 获取当前配置
    let optState = await OptimizationState.findOne({ entityType: 'campaign', entityId: campaignId }).lean()
    if (!optState) {
        // Fallback to campaign data
        const campaign = await Campaign.findOne({ campaignId }).lean()
        if (!campaign) throw new Error('Campaign not found')
        optState = {
            targetRoas: 1.0,
            currentBudget: parseFloat(campaign.daily_budget || '0') / 100,
            accountId: campaign.accountId
        } as any
    }

    // 4. 调用 AI
    const advice = await llmAdvisor.getCampaignAdvice(summary, {
      targetRoas: optState!.targetRoas || 1.0,
      currentBudget: optState!.currentBudget || 0
    })

    // 5. 保存建议
    const suggestion = await AiSuggestion.create({
      campaignId,
      accountId: optState!.accountId,
      date: today,
      analysis: advice.analysis,
      strategy: advice.strategy,
      reasoning: advice.reasoning,
      suggestedParams: advice.parameterUpdates,
      contextSnapshot: { summary, currentConfig: optState },
      status: 'PENDING'
    })

    res.json({ success: true, data: suggestion })

  } catch (error: any) {
    logger.error('[AI Controller] Failed to generate suggestion:', error)
    res.status(500).json({ success: false, message: error.message })
  }
}

/**
 * 获取 AI 建议历史
 */
export const getAiSuggestions = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.query
    const query: any = {}
    if (campaignId) query.campaignId = campaignId

    const suggestions = await AiSuggestion.find(query)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()

    res.json({ success: true, data: suggestions })
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
}

/**
 * 应用 AI 建议 (更新 OptimizationState)
 */
export const applyAiSuggestion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const suggestion = await AiSuggestion.findById(id)
    
    if (!suggestion) {
      return res.status(404).json({ success: false, message: 'Suggestion not found' })
    }

    if (suggestion.status === 'APPLIED') {
      return res.json({ success: true, message: 'Already applied' })
    }

    // 更新 OptimizationState
    if (suggestion.suggestedParams) {
      const update: any = {}
      if (suggestion.suggestedParams.targetRoas) update.targetRoas = suggestion.suggestedParams.targetRoas
      // 预算调整通常由 ExecutionService 执行，这里我们更新 Target ROAS 等参数，
      // 让 PolicyEngine 基于新参数去跑。
      // 如果建议包含 budgetCap，也可以更新。
      
      await OptimizationState.findOneAndUpdate(
        { entityType: 'campaign', entityId: suggestion.campaignId },
        { $set: update },
        { upsert: true }
      )
    }

    // 更新建议状态
    suggestion.status = 'APPLIED'
    await suggestion.save()

    res.json({ success: true, message: 'Suggestion applied successfully' })

  } catch (error: any) {
    logger.error('[AI Controller] Failed to apply suggestion:', error)
    res.status(500).json({ success: false, message: error.message })
  }
}

