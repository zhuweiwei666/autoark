"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.addAutomationJob = exports.automationQueue = void 0;
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
exports.automationQueue = null;
if (isRedisAvailable()) {
    try {
        exports.automationQueue = new bullmq_1.Queue('automation.jobs', {
            connection: (0, redis_1.getRedisConnection)(),
            defaultJobOptions: {
                attempts: 5,
                backoff: { type: 'exponential', delay: 2000 },
                removeOnComplete: { count: 200, age: 86400 },
                removeOnFail: { count: 500, age: 86400 * 7 },
            },
        });
        logger_1.default.info('[AutomationQueue] Queue initialized');
    }
    catch (e) {
        logger_1.default.warn('[AutomationQueue] Failed to create queue, Redis may not be configured:', e);
    }
}
const addAutomationJob = async (automationJobId, priority = 1) => {
    if (!exports.automationQueue) {
        logger_1.default.warn('[AutomationQueue] Queue not available, skipping enqueue');
        return null;
    }
    const jobId = `automation-${automationJobId}`;
    return exports.automationQueue.add('run', { automationJobId }, { jobId, priority });
};
exports.addAutomationJob = addAutomationJob;
