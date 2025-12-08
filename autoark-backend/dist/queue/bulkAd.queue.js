"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeTaskJobs = exports.getQueueStatus = exports.addBulkAdJobsBatch = exports.addBulkAdJob = exports.bulkAdQueue = void 0;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
const logger_1 = __importDefault(require("../utils/logger"));
/**
 * 批量广告创建任务队列
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
// 创建队列
exports.bulkAdQueue = null;
if (isRedisAvailable()) {
    try {
        exports.bulkAdQueue = new bullmq_1.Queue('bulk-ad-create', {
            connection: (0, redis_1.getRedisConnection)(),
            defaultJobOptions: {
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 5000,
                },
                removeOnComplete: {
                    count: 100, // 保留最近100个成功任务
                    age: 86400, // 或保留24小时
                },
                removeOnFail: {
                    count: 500, // 保留最近500个失败任务
                    age: 604800, // 或保留7天
                },
            },
        });
        logger_1.default.info('[BulkAdQueue] Queue initialized');
    }
    catch (error) {
        logger_1.default.warn('[BulkAdQueue] Failed to create queue, Redis may not be configured:', error);
    }
}
/**
 * 添加批量创建任务到队列
 */
const addBulkAdJob = async (taskId, accountId, priority = 1) => {
    if (!exports.bulkAdQueue) {
        logger_1.default.warn('[BulkAdQueue] Queue not available, skipping job');
        return null;
    }
    const jobId = `bulk-ad-${taskId}-${accountId}`;
    try {
        const job = await exports.bulkAdQueue.add('create-ads', {
            taskId,
            accountId,
            timestamp: Date.now(),
        }, {
            jobId,
            priority,
            delay: 0,
        });
        logger_1.default.info(`[BulkAdQueue] Job added: ${jobId}`);
        return job;
    }
    catch (error) {
        logger_1.default.error(`[BulkAdQueue] Failed to add job:`, error);
        throw error;
    }
};
exports.addBulkAdJob = addBulkAdJob;
/**
 * 批量添加任务
 */
const addBulkAdJobsBatch = async (taskId, accountIds, basePriority = 1) => {
    if (!exports.bulkAdQueue) {
        logger_1.default.warn('[BulkAdQueue] Queue not available, skipping batch');
        return [];
    }
    const jobs = accountIds.map((accountId, index) => ({
        name: 'create-ads',
        data: {
            taskId,
            accountId,
            timestamp: Date.now(),
        },
        opts: {
            jobId: `bulk-ad-${taskId}-${accountId}`,
            priority: basePriority + index, // 按顺序优先级递增
        },
    }));
    try {
        const results = await exports.bulkAdQueue.addBulk(jobs);
        logger_1.default.info(`[BulkAdQueue] ${results.length} jobs added for task ${taskId}`);
        return results;
    }
    catch (error) {
        logger_1.default.error(`[BulkAdQueue] Failed to add batch jobs:`, error);
        throw error;
    }
};
exports.addBulkAdJobsBatch = addBulkAdJobsBatch;
/**
 * 获取队列状态
 */
const getQueueStatus = async () => {
    if (!exports.bulkAdQueue) {
        return { available: false };
    }
    try {
        const [waiting, active, completed, failed, delayed] = await Promise.all([
            exports.bulkAdQueue.getWaitingCount(),
            exports.bulkAdQueue.getActiveCount(),
            exports.bulkAdQueue.getCompletedCount(),
            exports.bulkAdQueue.getFailedCount(),
            exports.bulkAdQueue.getDelayedCount(),
        ]);
        return {
            available: true,
            waiting,
            active,
            completed,
            failed,
            delayed,
            total: waiting + active + delayed,
        };
    }
    catch (error) {
        logger_1.default.error('[BulkAdQueue] Failed to get queue status:', error);
        return { available: false, error: error.message };
    }
};
exports.getQueueStatus = getQueueStatus;
/**
 * 清理队列中的特定任务
 */
const removeTaskJobs = async (taskId) => {
    if (!exports.bulkAdQueue) {
        return false;
    }
    try {
        // 获取所有等待中的任务
        const waiting = await exports.bulkAdQueue.getJobs(['waiting', 'delayed']);
        let removed = 0;
        for (const job of waiting) {
            if (job.data?.taskId === taskId) {
                await job.remove();
                removed++;
            }
        }
        logger_1.default.info(`[BulkAdQueue] Removed ${removed} jobs for task ${taskId}`);
        return true;
    }
    catch (error) {
        logger_1.default.error('[BulkAdQueue] Failed to remove task jobs:', error);
        return false;
    }
};
exports.removeTaskJobs = removeTaskJobs;
exports.default = exports.bulkAdQueue;
