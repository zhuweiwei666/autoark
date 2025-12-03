import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai'
import { EntitySummaryDTO } from '../../analytics/metrics.service'
import logger from '../../../utils/logger'

const LLM_API_KEY = process.env.LLM_API_KEY
const LLM_MODEL = process.env.LLM_MODEL || 'gemini-pro'

export interface AiSuggestion {
  campaignId: string
  analysis: string // 简短分析
  strategy: 'SCALE' | 'OPTIMIZE' | 'PAUSE' | 'OBSERVE' // 建议策略方向
  parameterUpdates?: {
    targetRoas?: number
    budgetCap?: number
    bidStrategy?: string
  }
  reasoning: string // 详细理由
}

/**
 * LLM 策略顾问
 * 负责分析数据并给出策略参数建议，不直接操作广告
 */
class LlmPolicyAdvisor {
  private model: GenerativeModel | null = null

  constructor() {
    if (LLM_API_KEY) {
      const genAI = new GoogleGenerativeAI(LLM_API_KEY)
      this.model = genAI.getGenerativeModel({ model: LLM_MODEL })
    } else {
      logger.warn('[AI Advisor] LLM_API_KEY not configured, AI suggestions will be mocked.')
    }
  }
  
  /**
   * 获取 Campaign 优化建议
   */
  async getCampaignAdvice(
    summary: EntitySummaryDTO,
    currentConfig: { targetRoas: number; currentBudget: number }
  ): Promise<AiSuggestion> {
    if (!this.model) {
      return this.fallbackSuggestion(summary, 'LLM disabled')
    }

    try {
      // 构建 Prompt
      const prompt = this.buildPrompt(summary, currentConfig)

      const result = await this.model.generateContent(prompt)
      const response = await result.response
      const content = response.text()
      if (!content) throw new Error('LLM returned empty response')

      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('Failed to parse JSON from LLM response')

      const parsed = JSON.parse(jsonMatch[0])
      
      return {
        campaignId: summary.entityId,
        analysis: parsed.analysis,
        strategy: parsed.strategy,
        parameterUpdates: parsed.parameterUpdates,
        reasoning: parsed.reasoning
      }

    } catch (error: any) {
      logger.error(`[AI Advisor] Failed to get advice for ${summary.entityId}:`, error)
      return this.fallbackSuggestion(summary, error.message)
    }
  }

  private getSystemPrompt() {
    return `你是一个专业的 Facebook 广告投放专家。
你的任务是根据广告数据，分析表现，并给出策略建议和参数调整建议。
你不能直接操作广告，只能建议调整 "targetRoas" (目标ROAS) 或 "budgetCap" (预算上限)。

请以 JSON 格式输出，包含以下字段：
- analysis: 简短的一句话数据分析 (中文)
- strategy: 策略方向，只能是 SCALE (扩量), OPTIMIZE (优化), PAUSE (关停), OBSERVE (观察) 其中之一
- parameterUpdates: 对象，包含建议调整的参数 (targetRoas, budgetCap)，如果没有建议则为空对象
- reasoning: 详细的建议理由 (中文)，解释为什么这样建议

注意：
- 如果 ROAS 远高于目标且花费稳定，建议 SCALE (降低 targetRoas 或提高 budgetCap)
- 如果 ROAS 低于目标但有潜力，建议 OPTIMIZE (提高 targetRoas)
- 如果持续亏损，建议 PAUSE
- 如果数据不足，建议 OBSERVE`
  }

  private buildPrompt(summary: EntitySummaryDTO, config: { targetRoas: number; currentBudget: number }) {
    return `${this.getSystemPrompt()}

分析对象: Campaign ${summary.entityId}
当前配置:
- 预算: $${config.currentBudget}
- 目标 ROAS: ${config.targetRoas}

最近 7 天数据:
- 总花费: $${summary.spend}
- 总收入: $${summary.purchase_value}
- ROAS: ${summary.roas.toFixed(2)}
- 趋势: ${summary.trend}
- CTR: ${(summary.ctr * 100).toFixed(2)}%
- CPC: $${summary.cpc.toFixed(2)}

每日数据趋势 (最近 7 天):
${summary.last7DaysData.map(d => 
  `- ${d.date}: Spend $${d.spendUsd}, ROAS ${d.purchase_roas || 0}`
).join('\n')}

请严格输出 JSON，字段结构参考说明。`
  }

  private fallbackSuggestion(summary: EntitySummaryDTO, reason: string): AiSuggestion {
    return {
      campaignId: summary.entityId,
      analysis: 'AI分析暂时不可用',
      strategy: 'OBSERVE',
      reasoning: `Fallback triggered: ${reason}`
    }
  }
}

export const llmAdvisor = new LlmPolicyAdvisor()

