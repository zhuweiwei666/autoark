"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.retryJob = exports.cancelJob = exports.getJob = exports.getJobs = exports.createJob = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const logger_1 = __importDefault(require("../utils/logger"));
const AutomationJob_1 = __importDefault(require("../models/AutomationJob"));
const automationJob_service_1 = require("../services/automationJob.service");
const User_1 = require("../models/User");
const createJob = async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ success: false, error: '未认证' });
        const { type, payload, agentId, idempotencyKey, priority } = req.body || {};
        if (!type)
            return res.status(400).json({ success: false, error: 'type is required' });
        const organizationId = req.user.organizationId && mongoose_1.default.Types.ObjectId.isValid(req.user.organizationId)
            ? new mongoose_1.default.Types.ObjectId(req.user.organizationId)
            : undefined;
        const job = await (0, automationJob_service_1.createAutomationJob)({
            type,
            payload,
            agentId,
            idempotencyKey,
            priority,
            organizationId,
            createdBy: req.user.userId,
        });
        res.json({ success: true, data: job });
    }
    catch (e) {
        logger_1.default.error('[AutomationJob] Create job failed:', e);
        res.status(500).json({ success: false, error: e.message });
    }
};
exports.createJob = createJob;
const getJobs = async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ success: false, error: '未认证' });
        const { status, type, agentId, page, pageSize } = req.query;
        const organizationId = req.user.role !== User_1.UserRole.SUPER_ADMIN &&
            req.user.organizationId &&
            mongoose_1.default.Types.ObjectId.isValid(req.user.organizationId)
            ? new mongoose_1.default.Types.ObjectId(req.user.organizationId)
            : undefined;
        const data = await (0, automationJob_service_1.listAutomationJobs)({
            organizationId,
            status: status,
            type: type,
            agentId: agentId,
            page: Number(page || 1),
            pageSize: Number(pageSize || 20),
        });
        res.json({ success: true, data });
    }
    catch (e) {
        logger_1.default.error('[AutomationJob] Get jobs failed:', e);
        res.status(500).json({ success: false, error: e.message });
    }
};
exports.getJobs = getJobs;
const getJob = async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ success: false, error: '未认证' });
        const doc = await AutomationJob_1.default.findById(req.params.id);
        if (!doc)
            return res.status(404).json({ success: false, error: 'Job not found' });
        // 组织隔离：非超管只能看自己组织
        if (req.user.role !== User_1.UserRole.SUPER_ADMIN && req.user.organizationId) {
            if (String(doc.organizationId || '') !== String(req.user.organizationId)) {
                return res.status(403).json({ success: false, error: 'Forbidden' });
            }
        }
        res.json({ success: true, data: doc });
    }
    catch (e) {
        logger_1.default.error('[AutomationJob] Get job failed:', e);
        res.status(500).json({ success: false, error: e.message });
    }
};
exports.getJob = getJob;
const cancelJob = async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ success: false, error: '未认证' });
        const doc = await AutomationJob_1.default.findById(req.params.id);
        if (!doc)
            return res.status(404).json({ success: false, error: 'Job not found' });
        if (req.user.role !== User_1.UserRole.SUPER_ADMIN && req.user.organizationId) {
            if (String(doc.organizationId || '') !== String(req.user.organizationId)) {
                return res.status(403).json({ success: false, error: 'Forbidden' });
            }
        }
        const updated = await (0, automationJob_service_1.cancelAutomationJob)(req.params.id);
        res.json({ success: true, data: updated });
    }
    catch (e) {
        logger_1.default.error('[AutomationJob] Cancel job failed:', e);
        res.status(500).json({ success: false, error: e.message });
    }
};
exports.cancelJob = cancelJob;
const retryJob = async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ success: false, error: '未认证' });
        const doc = await AutomationJob_1.default.findById(req.params.id);
        if (!doc)
            return res.status(404).json({ success: false, error: 'Job not found' });
        if (req.user.role !== User_1.UserRole.SUPER_ADMIN && req.user.organizationId) {
            if (String(doc.organizationId || '') !== String(req.user.organizationId)) {
                return res.status(403).json({ success: false, error: 'Forbidden' });
            }
        }
        const updated = await (0, automationJob_service_1.retryAutomationJob)(req.params.id);
        res.json({ success: true, data: updated });
    }
    catch (e) {
        logger_1.default.error('[AutomationJob] Retry job failed:', e);
        res.status(500).json({ success: false, error: e.message });
    }
};
exports.retryJob = retryJob;
