"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyAiSuggestion = exports.getAiSuggestions = exports.generateAiSuggestion = void 0;
const metrics_service_1 = require("../domain/analytics/metrics.service");
const llm_advisor_1 = require("../domain/optimizer/ai/llm.advisor");
const OptimizationState_1 = __importDefault(require("../models/OptimizationState"));
const AiSuggestion_1 = __importDefault(require("../models/AiSuggestion"));
const Campaign_1 = __importDefault(require("../models/Campaign"));
const dayjs_1 = __importDefault(require("dayjs"));
const logger_1 = __importDefault(require("../utils/logger"));
/**
 * 获取 AI 建议
 * 触发一次 LLM 分析并保存建议
 */
const generateAiSuggestion = async (req, res) => {
    try {
        const { campaignId } = req.params;
        const today = (0, dayjs_1.default)().format('YYYY-MM-DD');
        // 1. 检查今天是否已有建议
        const existing = await AiSuggestion_1.default.findOne({ campaignId, date: today });
        if (existing) {
            return res.json({ success: true, data: existing, message: 'Returned existing suggestion' });
        }
        // 2. 获取数据
        const summary = await metrics_service_1.metricsService.getEntitySummary({
            entityType: 'campaign',
            entityId: campaignId,
            window: '7d',
        });
        // 3. 获取当前配置
        let optState = await OptimizationState_1.default.findOne({ entityType: 'campaign', entityId: campaignId }).lean();
        if (!optState) {
            // Fallback to campaign data
            const campaign = await Campaign_1.default.findOne({ campaignId }).lean();
            if (!campaign)
                throw new Error('Campaign not found');
            optState = {
                targetRoas: 1.0,
                currentBudget: parseFloat(campaign.daily_budget || '0') / 100,
                accountId: campaign.accountId
            };
        }
        // 4. 调用 AI
        const advice = await llm_advisor_1.llmAdvisor.getCampaignAdvice(summary, {
            targetRoas: optState.targetRoas || 1.0,
            currentBudget: optState.currentBudget || 0
        });
        // 5. 保存建议
        const suggestion = await AiSuggestion_1.default.create({
            campaignId,
            accountId: optState.accountId,
            date: today,
            analysis: advice.analysis,
            strategy: advice.strategy,
            reasoning: advice.reasoning,
            suggestedParams: advice.parameterUpdates,
            contextSnapshot: { summary, currentConfig: optState },
            status: 'PENDING'
        });
        res.json({ success: true, data: suggestion });
    }
    catch (error) {
        logger_1.default.error('[AI Controller] Failed to generate suggestion:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};
exports.generateAiSuggestion = generateAiSuggestion;
/**
 * 获取 AI 建议历史
 */
const getAiSuggestions = async (req, res) => {
    try {
        const { campaignId } = req.query;
        const query = {};
        if (campaignId)
            query.campaignId = campaignId;
        const suggestions = await AiSuggestion_1.default.find(query)
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();
        res.json({ success: true, data: suggestions });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
exports.getAiSuggestions = getAiSuggestions;
/**
 * 应用 AI 建议 (更新 OptimizationState)
 */
const applyAiSuggestion = async (req, res) => {
    try {
        const { id } = req.params;
        const suggestion = await AiSuggestion_1.default.findById(id);
        if (!suggestion) {
            return res.status(404).json({ success: false, message: 'Suggestion not found' });
        }
        if (suggestion.status === 'APPLIED') {
            return res.json({ success: true, message: 'Already applied' });
        }
        // 更新 OptimizationState
        if (suggestion.suggestedParams) {
            const update = {};
            if (suggestion.suggestedParams.targetRoas)
                update.targetRoas = suggestion.suggestedParams.targetRoas;
            // 预算调整通常由 ExecutionService 执行，这里我们更新 Target ROAS 等参数，
            // 让 PolicyEngine 基于新参数去跑。
            // 如果建议包含 budgetCap，也可以更新。
            await OptimizationState_1.default.findOneAndUpdate({ entityType: 'campaign', entityId: suggestion.campaignId }, { $set: update }, { upsert: true });
        }
        // 更新建议状态
        suggestion.status = 'APPLIED';
        await suggestion.save();
        res.json({ success: true, message: 'Suggestion applied successfully' });
    }
    catch (error) {
        logger_1.default.error('[AI Controller] Failed to apply suggestion:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};
exports.applyAiSuggestion = applyAiSuggestion;
