"use strict";
/**
 * 📊 预聚合数据定时刷新
 *
 * - 服务启动时立即刷新一次
 * - 每 10 分钟刷新最近 3 天的数据
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initAggregationCron = initAggregationCron;
const node_cron_1 = __importDefault(require("node-cron"));
const logger_1 = __importDefault(require("../utils/logger"));
const aggregation_service_1 = require("../services/aggregation.service");
function initAggregationCron() {
    // 🚀 服务启动时立即刷新一次（异步，不阻塞启动）
    setTimeout(async () => {
        logger_1.default.info('[AggregationCron] Starting initial refresh...');
        try {
            await (0, aggregation_service_1.refreshRecentDays)();
            logger_1.default.info('[AggregationCron] Initial refresh completed');
        }
        catch (error) {
            logger_1.default.error('[AggregationCron] Initial refresh failed:', error.message);
        }
    }, 5000); // 延迟5秒启动，等待数据库连接稳定
    // 每 10 分钟刷新一次
    node_cron_1.default.schedule('*/10 * * * *', async () => {
        logger_1.default.info('[AggregationCron] Starting scheduled refresh...');
        try {
            await (0, aggregation_service_1.refreshRecentDays)();
            logger_1.default.info('[AggregationCron] Scheduled refresh completed');
        }
        catch (error) {
            logger_1.default.error('[AggregationCron] Scheduled refresh failed:', error.message);
        }
    });
    logger_1.default.info('[AggregationCron] Aggregation cron initialized (runs every 10 minutes)');
}
exports.default = initAggregationCron;
