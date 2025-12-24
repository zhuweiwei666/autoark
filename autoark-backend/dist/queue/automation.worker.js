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
exports.initAutomationWorker = void 0;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
const logger_1 = __importDefault(require("../utils/logger"));
const AutomationJob_1 = __importDefault(require("../models/AutomationJob"));
const FbToken_1 = __importDefault(require("../models/FbToken"));
let automationWorker = null;
const createWorkerOptions = (concurrency) => {
    const client = (0, redis_1.getRedisClient)();
    if (!client)
        throw new Error('Redis not configured');
    const connection = client.duplicate();
    // BullMQ required
    connection.options.maxRetriesPerRequest = null;
    return {
        connection,
        concurrency,
        limiter: { max: 50, duration: 60000 },
    };
};
const initAutomationWorker = () => {
    const client = (0, redis_1.getRedisClient)();
    if (!client) {
        logger_1.default.warn('[AutomationWorker] Worker not initialized (Redis not configured)');
        return;
    }
    automationWorker = new bullmq_1.Worker('automation.jobs', async (job) => {
        const { automationJobId } = job.data;
        const doc = await AutomationJob_1.default.findById(automationJobId);
        if (!doc)
            throw new Error('AutomationJob not found');
        // 幂等：已完成则直接返回
        if (doc.status === 'completed') {
            return { skipped: true, reason: 'already_completed' };
        }
        if (doc.status === 'cancelled') {
            return { skipped: true, reason: 'cancelled' };
        }
        doc.status = 'running';
        doc.startedAt = doc.startedAt || new Date();
        doc.attempts = Number(doc.attempts || 0) + 1;
        await doc.save();
        try {
            let result;
            const payload = doc.payload || {};
            // 使用动态导入打破循环依赖
            const { agentService } = await Promise.resolve().then(() => __importStar(require('../domain/agent/agent.service')));
            const bulkAdService = (await Promise.resolve().then(() => __importStar(require('../services/bulkAd.service')))).default;
            const fbSyncService = await Promise.resolve().then(() => __importStar(require('../services/facebook.sync.service')));
            const { syncFacebookUserAssets } = await Promise.resolve().then(() => __importStar(require('../services/facebookUser.service')));
            switch (doc.type) {
                case 'RUN_AGENT': {
                    if (!payload.agentId && !doc.agentId)
                        throw new Error('agentId is required');
                    const agentId = String(payload.agentId || doc.agentId);
                    result = await agentService.runAgent(agentId);
                    break;
                }
                case 'RUN_AGENT_AS_JOBS': {
                    if (!payload.agentId && !doc.agentId)
                        throw new Error('agentId is required');
                    const agentId = String(payload.agentId || doc.agentId);
                    result = await agentService.runAgentAsJobs(agentId);
                    break;
                }
                case 'EXECUTE_AGENT_OPERATION': {
                    const operationId = String(payload.operationId || '');
                    if (!operationId)
                        throw new Error('operationId is required');
                    // 可选：传递 agentId 用于 token scope
                    const agentId = payload.agentId ? String(payload.agentId) : undefined;
                    const agent = agentId ? await (require('../domain/agent/agent.model').AgentConfig).findById(agentId) : undefined;
                    result = await (agent ? agentService.executeOperation(operationId, agent) : agentService.executeOperation(operationId));
                    break;
                }
                case 'PUBLISH_DRAFT': {
                    const draftId = String(payload.draftId || '');
                    if (!draftId)
                        throw new Error('draftId is required');
                    result = await bulkAdService.publishDraft(draftId);
                    break;
                }
                case 'RUN_FB_FULL_SYNC': {
                    // 注意：runFullSync 内部已包含日志与错误处理
                    fbSyncService.runFullSync();
                    result = { started: true };
                    break;
                }
                case 'SYNC_FB_USER_ASSETS': {
                    const fbUserId = String(payload.fbUserId || '');
                    const tokenId = payload.tokenId ? String(payload.tokenId) : undefined;
                    if (!fbUserId)
                        throw new Error('fbUserId is required');
                    let token = payload.accessToken;
                    if (!token && tokenId) {
                        const t = await FbToken_1.default.findById(tokenId).lean();
                        token = t?.token;
                    }
                    if (!token)
                        throw new Error('accessToken or tokenId is required');
                    result = await syncFacebookUserAssets(fbUserId, token, tokenId);
                    break;
                }
                default:
                    throw new Error(`Unsupported job type: ${doc.type}`);
            }
            doc.status = 'completed';
            doc.result = result;
            doc.finishedAt = new Date();
            doc.lastError = undefined;
            await doc.save();
            return { success: true, result };
        }
        catch (e) {
            doc.status = 'failed';
            doc.lastError = e?.message || String(e);
            doc.finishedAt = new Date();
            await doc.save();
            throw e;
        }
    }, createWorkerOptions(5));
    automationWorker.on('failed', (job, err) => {
        logger_1.default.error(`[AutomationWorker] Job ${job?.id} failed:`, err);
    });
    automationWorker.on('error', (err) => {
        logger_1.default.error('[AutomationWorker] Worker error:', err);
    });
    logger_1.default.info('[AutomationWorker] Worker initialized');
};
exports.initAutomationWorker = initAutomationWorker;
exports.default = automationWorker;
