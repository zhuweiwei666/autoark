"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const automationJobSchema = new mongoose_1.default.Schema({
    type: { type: String, required: true, index: true },
    status: {
        type: String,
        enum: ['queued', 'running', 'completed', 'failed', 'cancelled'],
        default: 'queued',
        index: true,
    },
    // 幂等：同一个 key 只会有一个 job（重复创建将返回已存在的 job）
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    // 归属（审计/隔离）
    organizationId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'Organization' },
    createdBy: { type: String },
    agentId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'AgentConfig' },
    // 执行载荷（确定性输入）
    payload: { type: mongoose_1.default.Schema.Types.Mixed, default: {} },
    // 执行信息
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    lastError: { type: String },
    result: { type: mongoose_1.default.Schema.Types.Mixed },
    queuedAt: { type: Date, default: Date.now },
    startedAt: { type: Date },
    finishedAt: { type: Date },
}, { timestamps: true });
automationJobSchema.index({ organizationId: 1, createdAt: -1 });
automationJobSchema.index({ agentId: 1, createdAt: -1 });
exports.default = mongoose_1.default.model('AutomationJob', automationJobSchema);
