"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_cron_1 = __importDefault(require("node-cron"));
// Hourly Metrics 已废弃，由 V2 Queue-based Sync 统一处理
// import fetchFacebookMetrics from './fetchFacebookMetrics'
const rules_1 = require("../rules");
const ai_1 = require("../ai");
const materialMetrics_cron_1 = require("./materialMetrics.cron");
const aggregation_cron_1 = require("./aggregation.cron");
const rule_cron_1 = require("./rule.cron");
const materialAutoTest_cron_1 = require("./materialAutoTest.cron");
const aiSuggestion_cron_1 = require("./aiSuggestion.cron");
const accountSync_cron_1 = require("./accountSync.cron");
const facebookUserAssets_cron_1 = require("./facebookUserAssets.cron");
const agentAutoRun_cron_1 = require("./agentAutoRun.cron");
const logger_1 = __importDefault(require("../utils/logger"));
const initCronJobs = () => {
    // [DEPRECATED] Facebook Data Sync (Hourly) - 已由 V2 Queue-based Sync 替代
    // cron.schedule(SCHEDULES.FETCH_FB_HOURLY, () => {
    //   fetchFacebookMetrics().catch((err) =>
    //     logger.error('Unhandled error in Facebook fetch cron', err),
    //   )
    // })
    // Rule Engine (Daily at 1 AM)
    node_cron_1.default.schedule('0 1 * * *', () => {
        (0, rules_1.runRulesDaily)().catch((err) => logger_1.default.error('Unhandled error in Rule Engine cron', err));
    });
    // AI Optimizer (Daily at 3 AM)
    node_cron_1.default.schedule('0 3 * * *', () => {
        (0, ai_1.runAiOptimizerDaily)().catch((err) => logger_1.default.error('Unhandled error in AI Optimizer cron', err));
    });
    // Material Metrics Aggregation (Daily at 4 AM)
    (0, materialMetrics_cron_1.initMaterialMetricsCron)();
    // 📊 统一预聚合 (Every 10 minutes) - 前端页面和 AI 共用的数据源
    (0, aggregation_cron_1.initAggregationCron)();
    // 🤖 自动化规则引擎 (Hourly + Daily)
    (0, rule_cron_1.initRuleCron)();
    // 🧪 素材自动测试 (Every 10 minutes)
    (0, materialAutoTest_cron_1.initMaterialAutoTestCron)();
    // 🤖 AI 优化建议 (Hourly)
    (0, aiSuggestion_cron_1.initAiSuggestionCron)();
    // 📊 账户同步 (Hourly + Startup)
    (0, accountSync_cron_1.initAccountSyncCron)();
    // 👤 Facebook 用户资产缓存同步（Every 6 hours）
    (0, facebookUserAssets_cron_1.initFacebookUserAssetsCron)();
    // 🧠 Agent 自动运行（Planner/Executor jobs）
    (0, agentAutoRun_cron_1.initAgentAutoRunCron)();
    logger_1.default.info('Cron jobs initialized');
};
exports.default = initCronJobs;
