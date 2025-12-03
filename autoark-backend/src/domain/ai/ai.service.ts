import OpenAI from 'openai'
import logger from '../../utils/logger'
import { EntitySummaryDTO } from '../analytics/metrics.service'

const LLM_API_KEY = process.env.LLM_API_KEY
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.openai.com/v1' // 可配置为 DeepSeek 等
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-3.5-turbo'

export interface AiSuggestion {
  analysis: string // 简短分析
  strategy: 'GROWTH' | 'PROFIT' | 'MAINTAIN' // 建议策略方向
  suggestedTargetRoas?: number // 建议调整的目标 ROAS
  suggestedBudgetMultiplier?: number // 建议预算调整系数 (e.g. 1.2 = +20%)
  reasoning: string // 详细理由
}

class AiService {
  private client: OpenAI | null = null

  constructor() {
    if (LLM_API_KEY) {
      this.client = new OpenAI({
        apiKey: LLM_API_KEY,
        baseURL: LLM_BASE_URL,
      })
    } else {
      logger.warn('[AiService] LLM_API_KEY not found, AI features will be disabled/mocked.')
    }
  }

  /**
   * 分析 Campaign 数据并给出建议
   */
  async analyzeCampaign(
    summary: EntitySummaryDTO,
    currentBudget: number,
    targetRoas: number
  ): Promise<AiSuggestion> {
    if (!this.client) {
      // Mock response if no API key
      return this.mockAnalysis(summary)
    }

    try {
      const prompt = this.buildPrompt(summary, currentBudget, targetRoas)
      
      const completion = await this.client.chat.completions.create({
        model: LLM_MODEL,
        messages: [
          { role: 'system', content: '你是一个专业的 Facebook 广告投放专家。请根据提供的数据进行分析并给出优化建议。请只返回 JSON 格式结果。' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
      })

      const content = completion.choices[0]?.message?.content
      if (!content) throw new Error('No content from LLM')

      // 简单的 JSON 解析 (实际生产中可能需要更强的容错)
      // 假设 LLM 返回纯 JSON 或包含 JSON 的文本
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('Failed to parse JSON from LLM response')
      
      return JSON.parse(jsonMatch[0]) as AiSuggestion
    } catch (error: any) {
      logger.error('[AiService] Analysis failed:', error)
      return {
        analysis: 'AI 分析服务暂时不可用',
        strategy: 'MAINTAIN',
        reasoning: `Error: ${error.message}`
      }
    }
  }

  private buildPrompt(summary: EntitySummaryDTO, currentBudget: number, targetRoas: number): string {
    return `
请分析以下 Facebook 广告系列的数据：

**当前状态**:
- 预算: $${currentBudget}
- 目标 ROAS: ${targetRoas}

**最近 7 天表现**:
- 花费: $${summary.spend.toFixed(2)}
- 转化价值: $${summary.purchase_value.toFixed(2)}
- ROAS: ${summary.roas.toFixed(2)}
- CPC: $${summary.cpc.toFixed(2)}
- CTR: ${(summary.ctr * 100).toFixed(2)}%
- 趋势: ${summary.trend} (up=上升, down=下降, stable=稳定)

**每日数据**:
${JSON.stringify(summary.last7DaysData.map(d => ({ date: d.date, spend: d.spendUsd, roas: d.purchase_roas })), null, 2)}

请给出优化建议，返回以下 JSON 格式（不要包含 Markdown 代码块）：
{
  "analysis": "简短的一句话分析 (e.g. ROAS 稳步上升，有扩量空间)",
  "strategy": "GROWTH" | "PROFIT" | "MAINTAIN",
  "suggestedTargetRoas": number | null, // 如果建议调整目标 ROAS
  "suggestedBudgetMultiplier": number | null, // e.g. 1.1 表示建议加预算 10%
  "reasoning": "详细的分析理由..."
}
`
  }

  private mockAnalysis(summary: EntitySummaryDTO): AiSuggestion {
    const roas = summary.roas
    if (roas > 2.0) {
      return {
        analysis: '表现优异，建议扩量',
        strategy: 'GROWTH',
        suggestedBudgetMultiplier: 1.2,
        reasoning: 'ROAS 远超一般及格线，且趋势良好。'
      }
    } else if (roas < 0.5) {
      return {
        analysis: '表现较差，建议控成本',
        strategy: 'PROFIT',
        suggestedBudgetMultiplier: 0.8,
        reasoning: 'ROAS 低迷，需要收缩预算或暂停。'
      }
    }
    return {
      analysis: '表现平稳',
      strategy: 'MAINTAIN',
      reasoning: '各项指标在正常范围内。'
    }
  }
}

export const aiService = new AiService()

