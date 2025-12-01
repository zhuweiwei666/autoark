"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAiOptimizerDaily = exports.runAiOptimizerForAdSet = void 0;
const models_1 = require("../models");
const analyzer = __importStar(require("./analyzer"));
const recommender = __importStar(require("./recommender"));
const logger_1 = __importDefault(require("../utils/logger"));
const runAiOptimizerForAdSet = async (adsetId) => {
    logger_1.default.info(`[AI Optimizer] Running for AdSet: ${adsetId}`);
    // 1. Fetch last 7 days metrics
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);
    const metrics = await models_1.MetricsDaily.find({
        adsetId,
        date: {
            $gte: startDate.toISOString().split('T')[0],
            $lte: endDate.toISOString().split('T')[0],
        },
    }).sort({ date: 1 });
    if (metrics.length === 0) {
        logger_1.default.info(`[AI Optimizer] No metrics found for AdSet ${adsetId}, skipping.`);
        return null;
    }
    // 2. Analyze with LLM
    const analysisResult = await analyzer.analyzeMetrics(metrics);
    // 3. Generate Recommendations
    const recommendedActions = recommender.mapRecommendations(analysisResult);
    // 4. Log/Persist Results
    const decisionRecord = {
        adsetId,
        analysis: analysisResult.analysis,
        reasoning: analysisResult.reasoning,
        actions: recommendedActions,
        timestamp: new Date(),
    };
    // Log to OpsLog for visibility
    if (recommendedActions.length > 0) {
        await models_1.OpsLog.create({
            operator: 'AI_Optimizer_Agent',
            channel: metrics[0].channel || 'unknown',
            action: 'AI_PROPOSAL',
            before: {},
            after: { decision: decisionRecord },
            reason: analysisResult.analysis,
            related: {
                adsetId,
                confidence: recommendedActions.map((a) => a.confidence),
            },
        });
    }
    logger_1.default.info(`[AI Optimizer] Finished for AdSet ${adsetId}. Actions proposed: ${recommendedActions.length}`);
    return decisionRecord;
};
exports.runAiOptimizerForAdSet = runAiOptimizerForAdSet;
const runAiOptimizerDaily = async () => {
    logger_1.default.info('Starting Daily AI Optimizer Execution...');
    // Get all active AdSets (mocking by distinct adSetIds from recent metrics for now)
    // In real implementation, query AdSet model where status = 'ACTIVE'
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const activeAdSets = await models_1.MetricsDaily.distinct('adsetId', {
        date: yesterday,
    });
    logger_1.default.info(`[AI Optimizer] Found ${activeAdSets.length} active AdSets to analyze.`);
    let processedCount = 0;
    for (const adsetId of activeAdSets) {
        try {
            await (0, exports.runAiOptimizerForAdSet)(adsetId);
            processedCount++;
        }
        catch (error) {
            logger_1.default.error(`[AI Optimizer] Error processing AdSet ${adsetId}`, error);
        }
    }
    logger_1.default.info(`Daily AI Optimizer Execution Completed. Processed ${processedCount} AdSets.`);
};
exports.runAiOptimizerDaily = runAiOptimizerDaily;
