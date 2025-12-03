"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const optimizationStateSchema = new mongoose_1.default.Schema({
    entityType: {
        type: String,
        required: true,
        enum: ['account', 'campaign', 'adset', 'ad'],
    },
    entityId: { type: String, required: true },
    accountId: { type: String, required: true, index: true },
    // 当前状态
    currentBudget: Number,
    targetRoas: Number,
    status: String,
    bidAmount: Number,
    // 优化动作记录
    lastAction: String,
    lastActionTime: Date,
    lastCheckTime: Date,
    // AI 建议 (最新)
    aiSuggestion: {
        analysis: String,
        strategy: String,
        suggestedTargetRoas: Number,
        suggestedBudgetMultiplier: Number,
        reasoning: String,
        updatedAt: Date
    },
    // 历史记录 (保留最近 N 条)
    history: [
        {
            action: String,
            reason: String,
            timestamp: Date,
            details: Object
        }
    ]
}, { timestamps: true });
// 唯一索引：entityType + entityId
optimizationStateSchema.index({ entityType: 1, entityId: 1 }, { unique: true });
exports.default = mongoose_1.default.model('OptimizationState', optimizationStateSchema);
