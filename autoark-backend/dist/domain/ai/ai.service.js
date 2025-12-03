"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiService = void 0;
const generative_ai_1 = require("@google/generative-ai");
const logger_1 = __importDefault(require("../../utils/logger"));
const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || 'gemini-pro';
class AiService {
    constructor() {
        this.model = null;
        if (LLM_API_KEY) {
            const genAI = new generative_ai_1.GoogleGenerativeAI(LLM_API_KEY);
            this.model = genAI.getGenerativeModel({ model: LLM_MODEL });
        }
        else {
            logger_1.default.warn('[AiService] LLM_API_KEY not found, AI features will be disabled/mocked.');
        }
    }
    /**
     * 分析 Campaign 数据并给出建议
     */
    async analyzeCampaign(summary, currentBudget, targetRoas) {
        if (!this.model) {
            // Mock response if no API key
            return this.mockAnalysis(summary);
        }
        try {
            const prompt = this.buildPrompt(summary, currentBudget, targetRoas);
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const content = response.text();
            if (!content)
                throw new Error('No content from LLM');
            // 简单的 JSON 解析 (实际生产中可能需要更强的容错)
            // 假设 LLM 返回纯 JSON 或包含 JSON 的文本
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch)
                throw new Error('Failed to parse JSON from LLM response');
            return JSON.parse(jsonMatch[0]);
        }
        catch (error) {
            logger_1.default.error('[AiService] Analysis failed:', error);
            return {
                analysis: 'AI 分析服务暂时不可用',
                strategy: 'MAINTAIN',
                reasoning: `Error: ${error.message}`
            };
        }
    }
    buildPrompt(summary, currentBudget, targetRoas) {
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
`;
    }
    mockAnalysis(summary) {
        const roas = summary.roas;
        if (roas > 2.0) {
            return {
                analysis: '表现优异，建议扩量',
                strategy: 'GROWTH',
                suggestedBudgetMultiplier: 1.2,
                reasoning: 'ROAS 远超一般及格线，且趋势良好。'
            };
        }
        else if (roas < 0.5) {
            return {
                analysis: '表现较差，建议控成本',
                strategy: 'PROFIT',
                suggestedBudgetMultiplier: 0.8,
                reasoning: 'ROAS 低迷，需要收缩预算或暂停。'
            };
        }
        return {
            analysis: '表现平稳',
            strategy: 'MAINTAIN',
            reasoning: '各项指标在正常范围内。'
        };
    }
}
exports.aiService = new AiService();
