"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runBatchOptimization = exports.runOptimizationForCampaign = void 0;
const optimizer_runner_1 = require("../domain/optimizer/optimizer.runner");
const simpleRoas_policy_1 = require("../domain/optimizer/policies/simpleRoas.policy");
const stopLoss_policy_1 = require("../domain/optimizer/policies/stopLoss.policy");
const aiAdvisor_policy_1 = require("../domain/optimizer/policies/aiAdvisor.policy");
const Campaign_1 = __importDefault(require("../models/Campaign"));
const logger_1 = __importDefault(require("../utils/logger"));
// 初始化 Runner，注入策略
// 策略顺序：AI 分析 -> 止损 -> 常规优化
const runner = new optimizer_runner_1.OptimizerRunner([
    new aiAdvisor_policy_1.AiAdvisorPolicy(), // 先让 AI 分析并保存建议
    new stopLoss_policy_1.StopLossPolicy(),
    new simpleRoas_policy_1.SimpleRoasPolicy(),
]);
/**
 * 手动触发优化 (单个 Campaign)
 */
const runOptimizationForCampaign = async (req, res) => {
    const { campaignId } = req.params;
    // 异步执行
    runner.runForCampaign(campaignId).catch(err => {
        logger_1.default.error(`[Optimizer] Manual run failed for ${campaignId}:`, err);
    });
    res.json({ success: true, message: 'Optimization queued' });
};
exports.runOptimizationForCampaign = runOptimizationForCampaign;
/**
 * 批量触发优化 (所有活跃 Campaign)
 */
const runBatchOptimization = async (req, res) => {
    const campaigns = await Campaign_1.default.find({ status: 'ACTIVE' }).select('campaignId').lean();
    logger_1.default.info(`[Optimizer] Starting batch optimization for ${campaigns.length} campaigns`);
    // 简单的并发控制
    const batchSize = 10;
    for (let i = 0; i < campaigns.length; i += batchSize) {
        const batch = campaigns.slice(i, i + batchSize);
        await Promise.all(batch.map(c => runner.runForCampaign(c.campaignId)));
    }
    res.json({ success: true, message: `Optimization started for ${campaigns.length} campaigns` });
};
exports.runBatchOptimization = runBatchOptimization;
