"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initBulkAdWorker = exports.startTaskExecution = exports.bulkAdWorker = void 0;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
const logger_1 = __importDefault(require("../utils/logger"));
const AdTask_1 = __importDefault(require("../models/AdTask"));
const bulkAd_service_1 = require("../services/bulkAd.service");
const bulkAd_queue_1 = require("./bulkAd.queue");
/**
 * 批量广告创建 Worker
 */
// 检查 Redis 是否可用
const isRedisAvailable = () => {
    try {
        const client = (0, redis_1.getRedisClient)();
        return client !== null;
    }
    catch {
        return false;
    }
};
// Worker 配置
let workerOptions = null;
if (isRedisAvailable()) {
    try {
        workerOptions = {
            connection: (0, redis_1.getRedisConnection)(),
            concurrency: 5,
            limiter: {
                max: 20,
                duration: 60000,
            },
        };
    }
    catch (error) {
        logger_1.default.warn('[BulkAdWorker] Failed to create worker options:', error);
    }
}
// 创建 Worker
exports.bulkAdWorker = (workerOptions) ? new bullmq_1.Worker('bulk-ad-create', async (job) => {
    const { taskId, accountId } = job.data;
    logger_1.default.info(`[BulkAdWorker] Processing job: task=${taskId}, account=${accountId}`);
    try {
        const task = await AdTask_1.default.findById(taskId);
        if (!task) {
            throw new Error('Task not found');
        }
        if (task.status === 'cancelled') {
            logger_1.default.info(`[BulkAdWorker] Task ${taskId} was cancelled, skipping`);
            return { skipped: true, reason: 'cancelled' };
        }
        if (task.status === 'pending' || task.status === 'queued') {
            task.status = 'processing';
            if (!task.startedAt) {
                task.startedAt = new Date();
            }
            await task.save();
        }
        const result = await (0, bulkAd_service_1.executeTaskForAccount)(taskId, accountId);
        logger_1.default.info(`[BulkAdWorker] Job completed: task=${taskId}, account=${accountId}`);
        return {
            success: true,
            ...result,
        };
    }
    catch (error) {
        logger_1.default.error(`[BulkAdWorker] Job failed: task=${taskId}, account=${accountId}`, error);
        throw error;
    }
}, workerOptions) : null;
// Worker 事件监听
if (exports.bulkAdWorker) {
    exports.bulkAdWorker.on('completed', async (job) => {
        logger_1.default.info(`[BulkAdWorker] Job ${job.id} completed`);
    });
    exports.bulkAdWorker.on('failed', async (job, error) => {
        logger_1.default.error(`[BulkAdWorker] Job ${job?.id} failed:`, error);
    });
    exports.bulkAdWorker.on('error', (error) => {
        logger_1.default.error(`[BulkAdWorker] Worker error:`, error);
    });
}
/**
 * 启动任务执行
 */
const startTaskExecution = async (taskId) => {
    const task = await AdTask_1.default.findById(taskId);
    if (!task) {
        throw new Error('Task not found');
    }
    const pendingItems = task.items.filter((item) => item.status === 'pending');
    if (pendingItems.length === 0) {
        logger_1.default.warn(`[BulkAdWorker] No pending items for task ${taskId}`);
        return { queued: 0 };
    }
    task.status = 'queued';
    task.queuedAt = new Date();
    await task.save();
    const accountIds = pendingItems.map((item) => item.accountId);
    await (0, bulkAd_queue_1.addBulkAdJobsBatch)(taskId, accountIds);
    logger_1.default.info(`[BulkAdWorker] Task ${taskId} started, ${accountIds.length} accounts queued`);
    return { queued: accountIds.length };
};
exports.startTaskExecution = startTaskExecution;
/**
 * 初始化 Worker
 */
const initBulkAdWorker = () => {
    if (!exports.bulkAdWorker) {
        logger_1.default.warn('[BulkAdWorker] Worker not initialized (Redis unavailable)');
        return;
    }
    logger_1.default.info('[BulkAdWorker] Bulk ad worker initialized');
};
exports.initBulkAdWorker = initBulkAdWorker;
exports.default = exports.bulkAdWorker;
