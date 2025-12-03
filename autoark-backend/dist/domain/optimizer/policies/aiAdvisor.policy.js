"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiAdvisorPolicy = void 0;
const ai_service_1 = require("../../ai/ai.service");
const OptimizationState_1 = __importDefault(require("../../../models/OptimizationState"));
const logger_1 = __importDefault(require("../../../utils/logger"));
/**
 * AI 顾问策略
 * 不直接执行动作，而是分析数据并更新 AI 建议到数据库
 * 前端可以看到这些建议，或者其他策略可以参考这些建议
 */
class AiAdvisorPolicy {
    constructor() {
        this.name = 'ai-advisor-policy';
    }
    async apply(ctx) {
        const { summary, currentBudget, targetRoas = 1.0, entityId, entityType } = ctx;
        // 1. 调用 AI 分析
        // 为了节省 Token，可以加一些限制条件，比如只分析 spend > $50 的 campaign
        if (summary.spend < 50) {
            return { type: 'NOOP', reason: 'Spend too low for AI analysis' };
        }
        try {
            // 检查最近是否已经分析过 (例如 24 小时内)
            const existingState = await OptimizationState_1.default.findOne({ entityType, entityId }).select('aiSuggestion').lean();
            if (existingState?.aiSuggestion?.updatedAt) {
                const lastUpdate = new Date(existingState.aiSuggestion.updatedAt).getTime();
                const now = Date.now();
                // 如果 12 小时内分析过，这就跳过
                if (now - lastUpdate < 12 * 60 * 60 * 1000) {
                    return { type: 'NOOP', reason: 'AI analysis is fresh' };
                }
            }
            const suggestion = await ai_service_1.aiService.analyzeCampaign(summary, currentBudget, targetRoas);
            // 2. 保存建议到 OptimizationState
            await OptimizationState_1.default.findOneAndUpdate({ entityType, entityId }, {
                $set: {
                    aiSuggestion: {
                        ...suggestion,
                        updatedAt: new Date()
                    }
                }
            }, { upsert: true });
            logger_1.default.info(`[AiAdvisor] Updated suggestion for ${entityId}: ${suggestion.strategy}`);
            return { type: 'NOOP', reason: 'AI analysis updated' };
        }
        catch (error) {
            logger_1.default.error(`[AiAdvisor] Failed to analyze ${entityId}:`, error);
            return { type: 'NOOP', reason: 'AI analysis failed' };
        }
    }
}
exports.AiAdvisorPolicy = AiAdvisorPolicy;
