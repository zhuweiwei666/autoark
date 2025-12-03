"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getQueueStatus = exports.addAccountSyncJob = exports.syncCampaignsFromAdAccountsV2 = void 0;
const Account_1 = __importDefault(require("../models/Account"));
const facebook_queue_1 = require("../queue/facebook.queue");
const logger_1 = __importDefault(require("../utils/logger"));
// 检查队列是否可用
const isQueueAvailable = () => {
    return facebook_queue_1.accountQueue !== null && facebook_queue_1.campaignQueue !== null && facebook_queue_1.adQueue !== null;
};
/**
 * 调度器：扫描账户并推送到队列
 */
const syncCampaignsFromAdAccountsV2 = async () => {
    if (!isQueueAvailable()) {
        throw new Error('Queue system not available. Please configure REDIS_URL environment variable.');
    }
    const startTime = Date.now();
    try {
        // 1. 获取所有有效的广告账户
        const accounts = await Account_1.default.find({ status: 'active' });
        logger_1.default.info(`[Scheduler] Starting sync for ${accounts.length} active ad accounts`);
        if (accounts.length === 0) {
            logger_1.default.warn('[Scheduler] No active accounts found');
            return { syncedAccounts: 0, jobsQueued: 0 };
        }
        // 2. 为每个账户推送同步任务到 accountQueue
        const jobs = [];
        for (const account of accounts) {
            if (!account.token) {
                logger_1.default.warn(`[Scheduler] Account ${account.accountId} has no token, skipping`);
                continue;
            }
            // 推送到 accountQueue
            const job = await facebook_queue_1.accountQueue.add('sync-account', {
                accountId: account.accountId,
                token: account.token,
            }, {
                priority: 1,
                jobId: `account-sync-${account.accountId}-${Date.now()}`, // 每次运行生成新 jobId
            });
            jobs.push(job);
        }
        logger_1.default.info(`[Scheduler] Queued ${jobs.length} account sync jobs in ${Date.now() - startTime}ms`);
        return { syncedAccounts: accounts.length, jobsQueued: jobs.length };
    }
    catch (error) {
        logger_1.default.error('[Scheduler] Failed to queue account sync jobs:', error);
        throw error;
    }
};
exports.syncCampaignsFromAdAccountsV2 = syncCampaignsFromAdAccountsV2;
// 兼容旧接口
const addAccountSyncJob = async (accountId, token) => {
    if (facebook_queue_1.accountQueue) {
        await facebook_queue_1.accountQueue.add('sync-account', { accountId, token });
        return true;
    }
    return false;
};
exports.addAccountSyncJob = addAccountSyncJob;
// 获取队列状态
const getQueueStatus = async () => {
    if (!isQueueAvailable()) {
        return {
            available: false,
            queues: {}
        };
    }
    const [accountCounts, campaignCounts, adCounts] = await Promise.all([
        facebook_queue_1.accountQueue.getJobCounts(),
        facebook_queue_1.campaignQueue.getJobCounts(),
        facebook_queue_1.adQueue.getJobCounts(),
    ]);
    return {
        available: true,
        queues: {
            account: accountCounts,
            campaign: campaignCounts,
            ad: adCounts,
        }
    };
};
exports.getQueueStatus = getQueueStatus;
