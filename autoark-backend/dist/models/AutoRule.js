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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutoRule = void 0;
const mongoose_1 = __importStar(require("mongoose"));
// ==================== Schema 定义 ====================
const conditionSchema = new mongoose_1.Schema({
    metric: {
        type: String,
        enum: ['roas', 'spend', 'ctr', 'cpm', 'cpc', 'impressions', 'clicks', 'installs', 'purchases'],
        required: true
    },
    operator: {
        type: String,
        enum: ['gt', 'gte', 'lt', 'lte', 'eq', 'between'],
        required: true
    },
    value: { type: Number, required: true },
    value2: { type: Number },
    timeRange: {
        type: String,
        enum: ['today', 'yesterday', 'last_3_days', 'last_7_days', 'lifetime'],
        default: 'last_3_days'
    },
}, { _id: false });
const actionSchema = new mongoose_1.Schema({
    type: {
        type: String,
        enum: ['auto_pause', 'auto_enable', 'budget_up', 'budget_down', 'alert', 'auto_test'],
        required: true
    },
    budgetChange: { type: Number },
    budgetChangePercent: { type: Number },
    maxBudget: { type: Number },
    minBudget: { type: Number },
    notifyWebhook: { type: String },
    notifyEmail: { type: String },
}, { _id: false });
const executionDetailSchema = new mongoose_1.Schema({
    entityId: { type: String, required: true },
    entityName: { type: String },
    action: { type: String, required: true },
    oldValue: { type: mongoose_1.Schema.Types.Mixed },
    newValue: { type: mongoose_1.Schema.Types.Mixed },
    success: { type: Boolean, required: true },
    error: { type: String },
}, { _id: false });
const executionSchema = new mongoose_1.Schema({
    executedAt: { type: Date, default: Date.now },
    entitiesChecked: { type: Number, default: 0 },
    entitiesAffected: { type: Number, default: 0 },
    details: [executionDetailSchema],
}, { _id: false });
const autoRuleSchema = new mongoose_1.Schema({
    name: { type: String, required: true },
    description: { type: String },
    entityLevel: {
        type: String,
        enum: ['campaign', 'adset', 'ad'],
        required: true
    },
    accountIds: [{ type: String }],
    campaignIds: [{ type: String }],
    conditions: { type: [conditionSchema], required: true },
    action: { type: actionSchema, required: true },
    schedule: {
        type: {
            type: String,
            enum: ['hourly', 'daily', 'custom'],
            default: 'hourly'
        },
        cron: { type: String },
        timezone: { type: String, default: 'Asia/Shanghai' },
    },
    limits: {
        maxExecutionsPerDay: { type: Number, default: 24 },
        maxEntitiesPerExecution: { type: Number, default: 50 },
        cooldownMinutes: { type: Number, default: 60 },
        requireApproval: { type: Boolean, default: false },
    },
    status: {
        type: String,
        enum: ['active', 'paused', 'draft'],
        default: 'draft'
    },
    stats: {
        totalExecutions: { type: Number, default: 0 },
        lastExecutedAt: { type: Date },
        totalEntitiesAffected: { type: Number, default: 0 },
    },
    executions: {
        type: [executionSchema],
        default: [],
        // 只保留最近 100 条
        validate: [(val) => val.length <= 100, 'Executions limit exceeded']
    },
    createdBy: { type: String, required: true },
}, {
    timestamps: true,
    collection: 'autorules'
});
// 索引
autoRuleSchema.index({ status: 1 });
autoRuleSchema.index({ 'schedule.type': 1 });
autoRuleSchema.index({ createdBy: 1 });
exports.AutoRule = mongoose_1.default.model('AutoRule', autoRuleSchema);
exports.default = exports.AutoRule;
