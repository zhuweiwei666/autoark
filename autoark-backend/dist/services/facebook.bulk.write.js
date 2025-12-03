"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createUpdateOneOperation = exports.bulkWriteService = void 0;
const MetricsDaily_1 = __importDefault(require("../models/MetricsDaily"));
const RawInsights_1 = __importDefault(require("../models/RawInsights"));
const logger_1 = __importDefault(require("../utils/logger"));
/**
 * 批量写入服务
 * 使用 BulkWrite 提升写入性能（5x 提升）
 */
class BulkWriteService {
    constructor() {
        this.metricsBulkOps = [];
        this.rawInsightsBulkOps = [];
        this.BATCH_SIZE = 500;
    }
    /**
     * 添加 MetricsDaily 写入操作
     */
    addMetricsOperation(operation) {
        this.metricsBulkOps.push(operation);
        // 达到批次大小时自动执行
        if (this.metricsBulkOps.length >= this.BATCH_SIZE) {
            return this.flushMetrics();
        }
        return Promise.resolve();
    }
    /**
     * 添加 RawInsights 写入操作
     */
    addRawInsightsOperation(operation) {
        this.rawInsightsBulkOps.push(operation);
        // 达到批次大小时自动执行
        if (this.rawInsightsBulkOps.length >= this.BATCH_SIZE) {
            return this.flushRawInsights();
        }
        return Promise.resolve();
    }
    /**
     * 执行 MetricsDaily 批量写入
     */
    async flushMetrics() {
        if (this.metricsBulkOps.length === 0) {
            return { insertedCount: 0, modifiedCount: 0 };
        }
        try {
            const result = await MetricsDaily_1.default.bulkWrite(this.metricsBulkOps, {
                ordered: false, // 不按顺序执行，提高性能
            });
            const count = this.metricsBulkOps.length;
            this.metricsBulkOps = [];
            logger_1.default.debug(`[BulkWrite] MetricsDaily: ${count} operations executed`);
            return {
                insertedCount: result.insertedCount || 0,
                modifiedCount: result.modifiedCount || 0,
                matchedCount: result.matchedCount || 0,
            };
        }
        catch (error) {
            logger_1.default.error('[BulkWrite] MetricsDaily failed:', error);
            // 清空操作列表，避免重复执行
            this.metricsBulkOps = [];
            throw error;
        }
    }
    /**
     * 执行 RawInsights 批量写入
     */
    async flushRawInsights() {
        if (this.rawInsightsBulkOps.length === 0) {
            return { insertedCount: 0, modifiedCount: 0 };
        }
        try {
            const result = await RawInsights_1.default.bulkWrite(this.rawInsightsBulkOps, {
                ordered: false, // 不按顺序执行，提高性能
            });
            const count = this.rawInsightsBulkOps.length;
            this.rawInsightsBulkOps = [];
            logger_1.default.debug(`[BulkWrite] RawInsights: ${count} operations executed`);
            return {
                insertedCount: result.insertedCount || 0,
                modifiedCount: result.modifiedCount || 0,
                matchedCount: result.matchedCount || 0,
            };
        }
        catch (error) {
            logger_1.default.error('[BulkWrite] RawInsights failed:', error);
            // 清空操作列表，避免重复执行
            this.rawInsightsBulkOps = [];
            throw error;
        }
    }
    /**
     * 执行所有待处理的批量写入
     */
    async flushAll() {
        const [metricsResult, rawInsightsResult] = await Promise.all([
            this.flushMetrics(),
            this.flushRawInsights(),
        ]);
        return {
            metrics: metricsResult,
            rawInsights: rawInsightsResult,
        };
    }
    /**
     * 获取待处理操作数量
     */
    getPendingCount() {
        return {
            metrics: this.metricsBulkOps.length,
            rawInsights: this.rawInsightsBulkOps.length,
        };
    }
}
// 单例模式
exports.bulkWriteService = new BulkWriteService();
/**
 * 辅助函数：创建 updateOne 操作
 */
const createUpdateOneOperation = (filter, update, options = {}) => {
    return {
        updateOne: {
            filter,
            update: {
                $set: update,
                $unset: update.$unset || {},
            },
            upsert: options.upsert !== false,
        },
    };
};
exports.createUpdateOneOperation = createUpdateOneOperation;
