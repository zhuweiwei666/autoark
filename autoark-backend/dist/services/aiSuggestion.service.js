"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiSuggestionService = void 0;
const logger_1 = __importDefault(require("../utils/logger"));
const AiSuggestion_1 = require("../models/AiSuggestion");
const Aggregation_1 = require("../models/Aggregation");
const Campaign_1 = __importDefault(require("../models/Campaign"));
const AdSet_1 = __importDefault(require("../models/AdSet"));
const Ad_1 = __importDefault(require("../models/Ad"));
const FbToken_1 = __importDefault(require("../models/FbToken"));
const bulkCreate_api_1 = require("../integration/facebook/bulkCreate.api");
const dayjs_1 = __importDefault(require("dayjs"));
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
    async generateSuggestions() {
        logger_1.default.info('[AiSuggestion] Generating suggestions...');
        const suggestions = [];
        const today = (0, dayjs_1.default)().format('YYYY-MM-DD');
        const threeDaysAgo = (0, dayjs_1.default)().subtract(3, 'day').format('YYYY-MM-DD');
        // 1. 分析广告系列 - 找出低效的
        const campaigns = await Aggregation_1.AggCampaign.find({
            date: today,
            spend: { $gt: 10 }, // 消耗 > $10
        }).lean();
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
                });
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
                });
            }
        }
        // 2. 分析账户 - 找出需要关注的
        const accounts = await Aggregation_1.AggAccount.find({
            date: today,
            spend: { $gt: 50 },
        }).lean();
        for (const account of accounts) {
            if (account.roas < 0.5 && account.spend > 100) {
                suggestions.push({
                    type: 'alert',
                    priority: 'high',
                    entityType: 'campaign', // 账户级别用 campaign
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
                });
            }
        }
        // 保存建议到数据库
        const savedSuggestions = [];
        for (const suggestion of suggestions) {
            try {
                // 检查是否已有相同建议（避免重复）
                const existing = await AiSuggestion_1.AiSuggestion.findOne({
                    entityId: suggestion.entityId,
                    type: suggestion.type,
                    status: 'pending',
                });
                if (!existing) {
                    const saved = await AiSuggestion_1.AiSuggestion.create(suggestion);
                    savedSuggestions.push(saved);
                }
            }
            catch (error) {
                logger_1.default.error(`[AiSuggestion] Failed to save suggestion: ${error.message}`);
            }
        }
        logger_1.default.info(`[AiSuggestion] Generated ${savedSuggestions.length} new suggestions`);
        return savedSuggestions;
    }
    /**
     * 获取待处理的建议
     */
    async getPendingSuggestions(options) {
        const query = {
            status: 'pending',
            expiresAt: { $gt: new Date() },
        };
        if (options?.priority)
            query.priority = options.priority;
        if (options?.entityType)
            query.entityType = options.entityType;
        if (options?.accountId)
            query.accountId = options.accountId;
        return AiSuggestion_1.AiSuggestion.find(query)
            .sort({ priority: -1, createdAt: -1 })
            .limit(options?.limit || 50);
    }
    /**
     * 获取所有建议（包括已执行的）
     */
    async getSuggestions(options) {
        const query = {};
        if (options?.status)
            query.status = options.status;
        const [suggestions, total] = await Promise.all([
            AiSuggestion_1.AiSuggestion.find(query)
                .sort({ createdAt: -1 })
                .limit(options?.limit || 50)
                .skip(options?.skip || 0),
            AiSuggestion_1.AiSuggestion.countDocuments(query),
        ]);
        return { suggestions, total };
    }
    /**
     * 批准建议
     */
    async approveSuggestion(suggestionId, userId) {
        return AiSuggestion_1.AiSuggestion.findByIdAndUpdate(suggestionId, {
            status: 'approved',
            'execution.executedBy': userId,
        }, { new: true });
    }
    /**
     * 拒绝建议
     */
    async rejectSuggestion(suggestionId, userId) {
        return AiSuggestion_1.AiSuggestion.findByIdAndUpdate(suggestionId, {
            status: 'rejected',
            'execution.executedBy': userId,
        }, { new: true });
    }
    /**
     * 执行单个建议
     */
    async executeSuggestion(suggestionId, userId) {
        const suggestion = await AiSuggestion_1.AiSuggestion.findById(suggestionId);
        if (!suggestion) {
            throw new Error('Suggestion not found');
        }
        if (suggestion.status !== 'pending' && suggestion.status !== 'approved') {
            throw new Error('Suggestion cannot be executed');
        }
        try {
            // 获取 token
            const token = await this.getToken(suggestion.accountId);
            if (!token) {
                throw new Error('No valid token found');
            }
            // 执行操作
            let result = null;
            switch (suggestion.action.type) {
                case 'pause_campaign':
                    await (0, bulkCreate_api_1.updateCampaign)({ token, campaignId: suggestion.entityId, status: 'PAUSED' });
                    await Campaign_1.default.updateOne({ campaignId: suggestion.entityId }, { status: 'PAUSED' });
                    result = { newStatus: 'PAUSED' };
                    break;
                case 'pause_adset':
                    await (0, bulkCreate_api_1.updateAdSet)({ token, adsetId: suggestion.entityId, status: 'PAUSED' });
                    await AdSet_1.default.updateOne({ adsetId: suggestion.entityId }, { status: 'PAUSED' });
                    result = { newStatus: 'PAUSED' };
                    break;
                case 'pause_ad':
                    await (0, bulkCreate_api_1.updateAd)({ token, adId: suggestion.entityId, status: 'PAUSED' });
                    await Ad_1.default.updateOne({ adId: suggestion.entityId }, { status: 'PAUSED' });
                    result = { newStatus: 'PAUSED' };
                    break;
                case 'enable_ad':
                    await (0, bulkCreate_api_1.updateAd)({ token, adId: suggestion.entityId, status: 'ACTIVE' });
                    await Ad_1.default.updateOne({ adId: suggestion.entityId }, { status: 'ACTIVE' });
                    result = { newStatus: 'ACTIVE' };
                    break;
                case 'budget_increase':
                case 'budget_decrease':
                    // 获取当前预算并调整
                    const campaign = await Campaign_1.default.findOne({ campaignId: suggestion.entityId });
                    const currentBudget = campaign?.raw?.daily_budget / 100 || 0;
                    const changePercent = suggestion.action.params?.budgetChangePercent || 20;
                    const multiplier = suggestion.action.type === 'budget_increase' ? (1 + changePercent / 100) : (1 - changePercent / 100);
                    const newBudget = Math.max(10, currentBudget * multiplier);
                    await (0, bulkCreate_api_1.updateCampaign)({ token, campaignId: suggestion.entityId, dailyBudget: newBudget });
                    result = { oldBudget: currentBudget, newBudget };
                    break;
                case 'alert':
                    // 仅预警，不执行实际操作
                    result = { acknowledged: true };
                    break;
                default:
                    throw new Error(`Unsupported action type: ${suggestion.action.type}`);
            }
            // 更新建议状态
            suggestion.status = 'executed';
            suggestion.execution = {
                executedAt: new Date(),
                executedBy: userId,
                success: true,
                result,
            };
            await suggestion.save();
            logger_1.default.info(`[AiSuggestion] Executed suggestion: ${suggestion.title}`);
            return suggestion;
        }
        catch (error) {
            // 更新为失败状态
            suggestion.status = 'failed';
            suggestion.execution = {
                executedAt: new Date(),
                executedBy: userId,
                success: false,
                error: error.message,
            };
            await suggestion.save();
            logger_1.default.error(`[AiSuggestion] Failed to execute suggestion: ${error.message}`);
            throw error;
        }
    }
    /**
     * 批量执行建议
     */
    async executeBatch(suggestionIds, userId) {
        const results = [];
        let success = 0;
        let failed = 0;
        for (const id of suggestionIds) {
            try {
                await this.executeSuggestion(id, userId);
                results.push({ id, success: true });
                success++;
            }
            catch (error) {
                results.push({ id, success: false, error: error.message });
                failed++;
            }
        }
        return { success, failed, results };
    }
    /**
     * 清理过期建议
     */
    async cleanupExpired() {
        const result = await AiSuggestion_1.AiSuggestion.updateMany({ status: 'pending', expiresAt: { $lt: new Date() } }, { status: 'expired' });
        if (result.modifiedCount > 0) {
            logger_1.default.info(`[AiSuggestion] Cleaned up ${result.modifiedCount} expired suggestions`);
        }
        return result.modifiedCount;
    }
    /**
     * 获取统计信息
     */
    async getStats() {
        const [pending, executed, failed, rejected, byPriority] = await Promise.all([
            AiSuggestion_1.AiSuggestion.countDocuments({ status: 'pending', expiresAt: { $gt: new Date() } }),
            AiSuggestion_1.AiSuggestion.countDocuments({ status: 'executed' }),
            AiSuggestion_1.AiSuggestion.countDocuments({ status: 'failed' }),
            AiSuggestion_1.AiSuggestion.countDocuments({ status: 'rejected' }),
            AiSuggestion_1.AiSuggestion.aggregate([
                { $match: { status: 'pending', expiresAt: { $gt: new Date() } } },
                { $group: { _id: '$priority', count: { $sum: 1 } } },
            ]),
        ]);
        const priorityMap = { high: 0, medium: 0, low: 0 };
        byPriority.forEach((p) => {
            priorityMap[p._id] = p.count;
        });
        return {
            pending,
            executed,
            failed,
            rejected,
            byPriority: priorityMap,
        };
    }
    /**
     * 获取 token
     */
    async getToken(accountId) {
        const token = await FbToken_1.default.findOne({
            accounts: { $elemMatch: { accountId } },
            isValid: true,
        });
        return token?.token || null;
    }
}
exports.aiSuggestionService = new AiSuggestionService();
exports.default = exports.aiSuggestionService;
