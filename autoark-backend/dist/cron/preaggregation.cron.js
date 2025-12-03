"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_cron_1 = __importDefault(require("node-cron"));
const preaggregation_service_1 = require("../services/preaggregation.service");
const logger_1 = __importDefault(require("../utils/logger"));
/**
 * 初始化预聚合定时任务
 * - 每小时执行一次预聚合（在每小时的第 5 分钟执行，避免与其他任务冲突）
 * - 每天凌晨 2 点执行一次完整预聚合
 */
const initPreaggregationCron = () => {
    // 每小时的第 5 分钟执行预聚合（更新今天的数据）
    node_cron_1.default.schedule('5 * * * *', async () => {
        const startTime = Date.now();
        logger_1.default.info('[Preaggregation Cron] Starting hourly preaggregation...');
        try {
            await (0, preaggregation_service_1.preaggregateCampaignMetrics)();
            const duration = Date.now() - startTime;
            logger_1.default.info(`[Preaggregation Cron] Hourly preaggregation completed in ${duration}ms`);
        }
        catch (error) {
            const duration = Date.now() - startTime;
            logger_1.default.error(`[Preaggregation Cron] Hourly preaggregation failed after ${duration}ms:`, error);
        }
    });
    // 每天凌晨 2 点执行完整预聚合（更新所有日期范围）
    node_cron_1.default.schedule('0 2 * * *', async () => {
        const startTime = Date.now();
        logger_1.default.info('[Preaggregation Cron] Starting daily full preaggregation...');
        try {
            await (0, preaggregation_service_1.preaggregateCampaignMetrics)();
            const duration = Date.now() - startTime;
            logger_1.default.info(`[Preaggregation Cron] Daily full preaggregation completed in ${duration}ms`);
        }
        catch (error) {
            const duration = Date.now() - startTime;
            logger_1.default.error(`[Preaggregation Cron] Daily full preaggregation failed after ${duration}ms:`, error);
        }
    });
    logger_1.default.info('[Preaggregation Cron] Preaggregation cron jobs initialized');
};
exports.default = initPreaggregationCron;
