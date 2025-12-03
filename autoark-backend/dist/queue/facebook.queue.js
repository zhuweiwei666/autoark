"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.queueOptions = exports.adQueue = exports.campaignQueue = exports.accountQueue = exports.initQueues = void 0;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
const logger_1 = __importDefault(require("../utils/logger"));
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
// 队列配置（仅在 Redis 可用时创建）
let queueOptions = null;
exports.queueOptions = queueOptions;
let accountQueue = null;
exports.accountQueue = accountQueue;
let campaignQueue = null;
exports.campaignQueue = campaignQueue;
let adQueue = null;
exports.adQueue = adQueue;
if (isRedisAvailable()) {
    try {
        exports.queueOptions = queueOptions = {
            connection: (0, redis_1.getRedisConnection)(),
            defaultJobOptions: {
                attempts: 5, // 重试 5 次
                backoff: {
                    type: 'exponential',
                    delay: 1000, // 1s, 2s, 4s, 8s, 16s
                },
                removeOnComplete: {
                    age: 3600, // 保留1小时
                    count: 1000, // 最多保留1000个
                },
                removeOnFail: {
                    age: 86400 * 3, // 失败任务保留3天，便于排查
                },
            },
        };
        // 1. 账户同步队列
        // 任务：{ accountId, token }
        exports.accountQueue = accountQueue = new bullmq_1.Queue('facebook.account.sync', queueOptions);
        // 2. 广告系列同步队列
        // 任务：{ accountId, campaignId, token }
        exports.campaignQueue = campaignQueue = new bullmq_1.Queue('facebook.campaign.sync', queueOptions);
        // 3. 广告同步队列 (包含 Insights 拉取)
        // 任务：{ accountId, campaignId, adId, token }
        exports.adQueue = adQueue = new bullmq_1.Queue('facebook.ad.sync', queueOptions);
    }
    catch (error) {
        logger_1.default.warn('[Queue] Failed to initialize queues, Redis may not be configured:', error);
    }
}
const initQueues = () => {
    if (!accountQueue || !campaignQueue || !adQueue)
        return;
    const queues = [
        { name: 'facebook.account.sync', queue: accountQueue },
        { name: 'facebook.campaign.sync', queue: campaignQueue },
        { name: 'facebook.ad.sync', queue: adQueue },
    ];
    queues.forEach(({ name, queue }) => {
        queue.on('error', (err) => {
            logger_1.default.error(`[Queue] ${name} error:`, err);
        });
        // 可以在这里添加更多全局事件监听
    });
    logger_1.default.info('[Queue] Facebook sync queues initialized');
};
exports.initQueues = initQueues;
