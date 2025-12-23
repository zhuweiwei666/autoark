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
exports.buildIdempotencyKey = void 0;
exports.createAutomationJob = createAutomationJob;
exports.enqueueAutomationJob = enqueueAutomationJob;
exports.executeAutomationJobInline = executeAutomationJobInline;
exports.listAutomationJobs = listAutomationJobs;
exports.cancelAutomationJob = cancelAutomationJob;
exports.retryAutomationJob = retryAutomationJob;
const crypto_1 = __importDefault(require("crypto"));
const logger_1 = __importDefault(require("../utils/logger"));
const AutomationJob_1 = __importDefault(require("../models/AutomationJob"));
const automation_queue_1 = require("../queue/automation.queue");
const agent_service_1 = require("../domain/agent/agent.service");
const bulkAd_service_1 = __importDefault(require("./bulkAd.service"));
const fbSyncService = __importStar(require("./facebook.sync.service"));
const facebookUser_service_1 = require("./facebookUser.service");
const FbToken_1 = __importDefault(require("../models/FbToken"));
const buildIdempotencyKey = (type, payload, agentId) => {
    const raw = JSON.stringify({ type, agentId: agentId || null, payload: payload || {} });
    return crypto_1.default.createHash('sha256').update(raw).digest('hex').slice(0, 40);
};
exports.buildIdempotencyKey = buildIdempotencyKey;
async function createAutomationJob(input) {
    const idempotencyKey = input.idempotencyKey || (0, exports.buildIdempotencyKey)(input.type, input.payload, input.agentId);
    // 幂等创建：如果已存在则直接返回
    const doc = await AutomationJob_1.default.findOneAndUpdate({ idempotencyKey }, {
        $setOnInsert: {
            type: input.type,
            payload: input.payload || {},
            agentId: input.agentId,
            organizationId: input.organizationId,
            createdBy: input.createdBy,
            status: 'queued',
            queuedAt: new Date(),
        },
    }, { upsert: true, new: true });
    // 如果是新建/仍可执行，尝试入队
    if (doc.status === 'queued') {
        await enqueueAutomationJob(doc._id.toString(), input.priority || 1);
    }
    return doc;
}
async function enqueueAutomationJob(automationJobId, priority = 1) {
    const queued = await (0, automation_queue_1.addAutomationJob)(automationJobId, priority);
    if (!queued) {
        // Redis 不可用：同步执行兜底（避免“创建了 job 但永远不跑”）
        logger_1.default.warn('[AutomationJob] Queue unavailable, executing inline fallback');
        await executeAutomationJobInline(automationJobId);
    }
    return queued;
}
async function executeAutomationJobInline(automationJobId) {
    const doc = await AutomationJob_1.default.findById(automationJobId);
    if (!doc)
        throw new Error('AutomationJob not found');
    if (doc.status === 'completed')
        return doc;
    if (doc.status === 'cancelled')
        return doc;
    doc.status = 'running';
    doc.startedAt = doc.startedAt || new Date();
    doc.attempts = Number(doc.attempts || 0) + 1;
    await doc.save();
    try {
        const payload = doc.payload || {};
        let result;
        switch (doc.type) {
            case 'RUN_AGENT': {
                const agentId = String(payload.agentId || doc.agentId || '');
                if (!agentId)
                    throw new Error('agentId is required');
                result = await agent_service_1.agentService.runAgent(agentId);
                break;
            }
            case 'RUN_AGENT_AS_JOBS': {
                const agentId = String(payload.agentId || doc.agentId || '');
                if (!agentId)
                    throw new Error('agentId is required');
                result = await agent_service_1.agentService.runAgentAsJobs(agentId);
                break;
            }
            case 'EXECUTE_AGENT_OPERATION': {
                const operationId = String(payload.operationId || '');
                if (!operationId)
                    throw new Error('operationId is required');
                result = await agent_service_1.agentService.executeOperation(operationId);
                break;
            }
            case 'PUBLISH_DRAFT': {
                const draftId = String(payload.draftId || '');
                if (!draftId)
                    throw new Error('draftId is required');
                result = await bulkAd_service_1.default.publishDraft(draftId);
                break;
            }
            case 'RUN_FB_FULL_SYNC': {
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
                result = await (0, facebookUser_service_1.syncFacebookUserAssets)(fbUserId, token, tokenId);
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
        return doc;
    }
    catch (e) {
        doc.status = 'failed';
        doc.lastError = e?.message || String(e);
        doc.finishedAt = new Date();
        await doc.save();
        throw e;
    }
}
async function listAutomationJobs(query) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize || 20)));
    const filter = {};
    if (query.organizationId)
        filter.organizationId = query.organizationId;
    if (query.agentId)
        filter.agentId = query.agentId;
    if (query.status)
        filter.status = query.status;
    if (query.type)
        filter.type = query.type;
    const [list, total] = await Promise.all([
        AutomationJob_1.default.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize),
        AutomationJob_1.default.countDocuments(filter),
    ]);
    return { list, total, page, pageSize };
}
async function cancelAutomationJob(id) {
    const doc = await AutomationJob_1.default.findById(id);
    if (!doc)
        throw new Error('AutomationJob not found');
    if (doc.status === 'completed')
        return doc;
    doc.status = 'cancelled';
    doc.finishedAt = new Date();
    await doc.save();
    return doc;
}
async function retryAutomationJob(id) {
    const doc = await AutomationJob_1.default.findById(id);
    if (!doc)
        throw new Error('AutomationJob not found');
    if (doc.status !== 'failed')
        return doc;
    doc.status = 'queued';
    doc.lastError = undefined;
    doc.finishedAt = undefined;
    await doc.save();
    await enqueueAutomationJob(id, 1);
    return doc;
}
