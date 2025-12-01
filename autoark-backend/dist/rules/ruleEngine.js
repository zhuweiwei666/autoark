"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runRulesDaily = exports.runRulesForAdSet = exports.evaluateRules = void 0;
const models_1 = require("../models");
const ruleDefinitions_1 = require("./ruleDefinitions");
const logger_1 = __importDefault(require("../utils/logger"));
const evaluateRules = (metrics) => {
    const triggeredRules = [];
    const recommendedActions = [];
    for (const rule of ruleDefinitions_1.RULES) {
        try {
            if (rule.condition(metrics)) {
                triggeredRules.push(rule);
                recommendedActions.push({
                    type: rule.action,
                    params: rule.params,
                    ruleName: rule.name,
                });
            }
        }
        catch (err) {
            logger_1.default.error(`Error evaluating rule ${rule.name}`, err);
        }
    }
    return { triggeredRules, recommendedActions };
};
exports.evaluateRules = evaluateRules;
const runRulesForAdSet = async (adsetId, date) => {
    // 1. Fetch latest metrics for this AdSet
    // In reality, rules might run on Ad level or AdSet level.
    // For simplicity, let's assume we aggregate ad metrics for the adset or fetch adset level metrics.
    // Using MetricsDaily which is Ad level, we might need to fetch for specific Ads under this AdSet or aggregate.
    // Let's implement for "Ads" since most rules (Pause Ad) are Ad level, but Budget is AdSet level.
    // Mixed approach: Fetch all Ads for this AdSet
    const targetDate = date || new Date().toISOString().split('T')[0]; // Today or specific date
    // Usually we check "Yesterday" for complete data, or "Today" for real-time.
    // Let's assume we check "Yesterday" as per the cron job context.
    // Find metrics for ads in this adset
    const metricsList = await models_1.MetricsDaily.find({ adsetId, date: targetDate });
    const results = [];
    for (const metrics of metricsList) {
        const { triggeredRules, recommendedActions } = (0, exports.evaluateRules)(metrics);
        if (triggeredRules.length > 0) {
            logger_1.default.info(`Rules triggered for Ad ${metrics.adId}: ${triggeredRules.map((r) => r.name).join(', ')}`);
            // Log to OpsLog (Simulation / Recommendation)
            for (const action of recommendedActions) {
                await models_1.OpsLog.create({
                    operator: 'System_RuleEngine',
                    channel: metrics.channel,
                    action: action.type,
                    before: { status: 'UNKNOWN' }, // TODO: Fetch current status
                    after: { planned: action.params },
                    reason: `Rule Triggered: ${action.ruleName}`,
                    related: {
                        adId: metrics.adId,
                        adsetId: metrics.adsetId,
                        campaignId: metrics.campaignId,
                        metrics: {
                            cpi: metrics.cpiUsd,
                            roi: metrics.roiD0,
                            spend: metrics.spendUsd,
                        },
                    },
                });
                // Optionally execute action immediately or wait for approval
                // await actions.executeAction(action.type, metrics.adId, action.params);
                // For 'Budget' actions, targetId should be adsetId.
                const targetId = action.type.includes('BUDGET')
                    ? metrics.adsetId
                    : metrics.adId;
                // Simulating Execution Call
                // await actions.executeAction(action.type, targetId, action.params);
            }
            results.push({
                adId: metrics.adId,
                triggeredRules: triggeredRules.map((r) => r.name),
                recommendedActions,
            });
        }
    }
    return results;
};
exports.runRulesForAdSet = runRulesForAdSet;
const runRulesDaily = async () => {
    logger_1.default.info('Starting Daily Rule Engine Execution...');
    // Check yesterday's data
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    // Get all active AdSets or Ads to check
    // For simplicity, let's iterate over MetricsDaily from yesterday directly to find active entities with data
    const metrics = await models_1.MetricsDaily.find({ date: yesterday });
    let totalTriggered = 0;
    for (const metric of metrics) {
        const { triggeredRules, recommendedActions } = (0, exports.evaluateRules)(metric);
        if (triggeredRules.length > 0) {
            totalTriggered++;
            logger_1.default.info(`[RuleEngine] Triggered ${triggeredRules.length} rules for Ad ${metric.adId}`);
            for (const action of recommendedActions) {
                const targetId = action.type.includes('BUDGET')
                    ? metric.adsetId
                    : metric.adId;
                await models_1.OpsLog.create({
                    operator: 'System_RuleEngine',
                    channel: metric.channel,
                    action: action.type,
                    before: {},
                    after: { params: action.params },
                    reason: `Daily Scan Rule: ${action.ruleName}`,
                    related: {
                        adId: metric.adId,
                        metricId: metric._id,
                    },
                });
                // In fully automated mode, we would call:
                // await actions.executeAction(action.type, targetId, action.params);
            }
        }
    }
    logger_1.default.info(`Daily Rule Engine Execution Completed. Triggered rules on ${totalTriggered} records.`);
};
exports.runRulesDaily = runRulesDaily;
