"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const aggregation_cron_1 = require("./aggregation.cron");
const accountSync_cron_1 = require("./accountSync.cron");
const facebookUserAssets_cron_1 = require("./facebookUserAssets.cron");
const agentAutoRun_cron_1 = require("./agentAutoRun.cron");
const tiktokSync_cron_1 = require("./tiktokSync.cron");
const logger_1 = __importDefault(require("../utils/logger"));
const initCronJobs = () => {
    // 📊 统一预聚合 (Every 10 minutes) - 前端页面和 AI 共用的数据源
    (0, aggregation_cron_1.initAggregationCron)();
    // 📊 账户同步 (Hourly + Startup)
    (0, accountSync_cron_1.initAccountSyncCron)();
    // 👤 Facebook 用户资产缓存同步（Every 6 hours）
    (0, facebookUserAssets_cron_1.initFacebookUserAssetsCron)();
    // 🧠 Agent 自动运行（Planner/Executor jobs）
    (0, agentAutoRun_cron_1.initAgentAutoRunCron)();
    // 📊 TikTok 资产同步 (Hourly + Startup)
    (0, tiktokSync_cron_1.initTiktokSyncCron)();
    logger_1.default.info('Cron jobs initialized');
};
exports.default = initCronJobs;
