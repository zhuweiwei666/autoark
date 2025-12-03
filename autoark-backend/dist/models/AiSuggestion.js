"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const aiSuggestionSchema = new mongoose_1.default.Schema({
    campaignId: { type: String, required: true, index: true },
    accountId: { type: String, required: true },
    date: { type: String, required: true }, // YYYY-MM-DD
    // AI 输出
    analysis: String,
    strategy: String,
    reasoning: String,
    suggestedParams: {
        targetRoas: Number,
        budgetCap: Number,
    },
    // 状态
    status: {
        type: String,
        enum: ['PENDING', 'APPLIED', 'REJECTED', 'IGNORED'],
        default: 'PENDING'
    },
    // 原始上下文快照
    contextSnapshot: Object,
}, { timestamps: true });
// 索引：每天每个 Campaign 只需一条建议
aiSuggestionSchema.index({ campaignId: 1, date: 1 }, { unique: true });
exports.default = mongoose_1.default.model('AiSuggestion', aiSuggestionSchema);
