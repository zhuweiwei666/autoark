"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.backfillMaterialMetrics = exports.runManualAggregation = exports.stopMaterialMetricsCron = exports.initMaterialMetricsCron = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const dayjs_1 = __importDefault(require("dayjs"));
const logger_1 = __importDefault(require("../utils/logger"));
const materialMetrics_service_1 = require("../services/materialMetrics.service");
const materialTracking_service_1 = require("../services/materialTracking.service");
/**
 * 素材指标聚合定时任务
 * 每天凌晨 4:00 运行：
 * 1. 聚合 Facebook 指标到 MaterialMetrics（按素材维度）
 * 2. 将 MaterialMetrics 数据归因到 Material 素材库（全链路追踪）
 */
let cronJob = null;
const initMaterialMetricsCron = () => {
    // 每小时的第 30 分钟执行 (避免与其他整点任务冲突)
    cronJob = node_cron_1.default.schedule('30 * * * *', async () => {
        logger_1.default.info('[MaterialMetricsCron] Starting hourly material metrics aggregation');
        try {
            const today = (0, dayjs_1.default)().format('YYYY-MM-DD');
            const yesterday = (0, dayjs_1.default)().subtract(1, 'day').format('YYYY-MM-DD');
            // 1. 聚合昨天的数据 (确保最终数据一致性)
            const yesterdayResult = await (0, materialMetrics_service_1.aggregateMaterialMetrics)(yesterday);
            await (0, materialTracking_service_1.aggregateMetricsToMaterials)(yesterday);
            logger_1.default.info(`[MaterialMetricsCron] Aggregated yesterday (${yesterday})`);
            // 2. 聚合今天的数据 (实时更新)
            const todayResult = await (0, materialMetrics_service_1.aggregateMaterialMetrics)(today);
            await (0, materialTracking_service_1.aggregateMetricsToMaterials)(today);
            logger_1.default.info(`[MaterialMetricsCron] Aggregated today (${today})`);
        }
        catch (error) {
            logger_1.default.error('[MaterialMetricsCron] Hourly aggregation failed:', error);
        }
    }, {
        timezone: 'Asia/Shanghai'
    });
    logger_1.default.info('[MaterialMetricsCron] Material metrics cron initialized (runs hourly at :30)');
};
exports.initMaterialMetricsCron = initMaterialMetricsCron;
const stopMaterialMetricsCron = () => {
    if (cronJob) {
        cronJob.stop();
        cronJob = null;
        logger_1.default.info('[MaterialMetricsCron] Cron job stopped');
    }
};
exports.stopMaterialMetricsCron = stopMaterialMetricsCron;
// 手动触发聚合（用于补数据或测试）
const runManualAggregation = async (date) => {
    const targetDate = date || (0, dayjs_1.default)().format('YYYY-MM-DD');
    logger_1.default.info(`[MaterialMetricsCron] Manual aggregation triggered for ${targetDate}`);
    return (0, materialMetrics_service_1.aggregateMaterialMetrics)(targetDate);
};
exports.runManualAggregation = runManualAggregation;
// 批量补数据
const backfillMaterialMetrics = async (startDate, endDate) => {
    logger_1.default.info(`[MaterialMetricsCron] Backfilling material metrics from ${startDate} to ${endDate}`);
    const results = [];
    let currentDate = (0, dayjs_1.default)(startDate);
    const end = (0, dayjs_1.default)(endDate);
    while (currentDate.isBefore(end) || currentDate.isSame(end, 'day')) {
        const dateStr = currentDate.format('YYYY-MM-DD');
        try {
            const result = await (0, materialMetrics_service_1.aggregateMaterialMetrics)(dateStr);
            results.push({ date: dateStr, result });
            logger_1.default.info(`[MaterialMetricsCron] Backfill complete for ${dateStr}`);
        }
        catch (error) {
            logger_1.default.error(`[MaterialMetricsCron] Backfill failed for ${dateStr}:`, error);
            results.push({ date: dateStr, result: { error: String(error) } });
        }
        currentDate = currentDate.add(1, 'day');
    }
    return results;
};
exports.backfillMaterialMetrics = backfillMaterialMetrics;
