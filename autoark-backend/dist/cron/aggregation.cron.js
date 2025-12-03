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
const node_cron_1 = __importDefault(require("node-cron"));
const aggregationService = __importStar(require("../services/facebook.aggregation.service"));
const purchaseCorrectionService = __importStar(require("../services/facebook.purchase.correction"));
const logger_1 = __importDefault(require("../utils/logger"));
const dayjs_1 = __importDefault(require("dayjs"));
/**
 * 数据聚合定时任务
 * 将 Ad 级别的数据向上聚合为 AdSet → Campaign → Account 级别
 */
const initAggregationCron = () => {
    // 每小时的第 10 分钟执行聚合（避免与其他任务冲突）
    node_cron_1.default.schedule('10 * * * *', async () => {
        const startTime = Date.now();
        const today = (0, dayjs_1.default)().format('YYYY-MM-DD');
        const yesterday = (0, dayjs_1.default)().subtract(1, 'day').format('YYYY-MM-DD');
        logger_1.default.info('[Aggregation Cron] Starting metrics aggregation...');
        try {
            // 聚合今天和昨天的数据
            await Promise.all([
                aggregationService.aggregateMetricsByLevel(today),
                aggregationService.aggregateMetricsByLevel(yesterday),
            ]);
            const duration = Date.now() - startTime;
            logger_1.default.info(`[Aggregation Cron] Metrics aggregation completed in ${duration}ms`);
        }
        catch (error) {
            const duration = Date.now() - startTime;
            logger_1.default.error(`[Aggregation Cron] Metrics aggregation failed after ${duration}ms:`, error);
        }
    });
    // 每天凌晨 3 点执行 Purchase 值修正（在数据聚合之后）
    node_cron_1.default.schedule('0 3 * * *', async () => {
        const startTime = Date.now();
        const today = (0, dayjs_1.default)().format('YYYY-MM-DD');
        const yesterday = (0, dayjs_1.default)().subtract(1, 'day').format('YYYY-MM-DD');
        const last7dStart = (0, dayjs_1.default)().subtract(7, 'day').format('YYYY-MM-DD');
        logger_1.default.info('[Purchase Correction Cron] Starting purchase value correction...');
        try {
            // 修正最近 7 天的数据
            await purchaseCorrectionService.correctPurchaseValuesForDateRange(last7dStart, today);
            const duration = Date.now() - startTime;
            logger_1.default.info(`[Purchase Correction Cron] Purchase correction completed in ${duration}ms`);
        }
        catch (error) {
            const duration = Date.now() - startTime;
            logger_1.default.error(`[Purchase Correction Cron] Purchase correction failed after ${duration}ms:`, error);
        }
    });
    logger_1.default.info('[Aggregation Cron] Aggregation cron job initialized (runs at :10 every hour)');
    logger_1.default.info('[Purchase Correction Cron] Purchase correction cron job initialized (runs at 3:00 AM daily)');
};
exports.default = initAggregationCron;
