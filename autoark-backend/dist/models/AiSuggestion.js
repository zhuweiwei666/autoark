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
exports.AiSuggestion = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const aiSuggestionSchema = new mongoose_1.Schema({
    type: {
        type: String,
        enum: ['pause_ad', 'pause_adset', 'pause_campaign', 'enable_ad',
            'budget_increase', 'budget_decrease', 'bid_adjust',
            'targeting_adjust', 'creative_replace', 'scale_up', 'alert'],
        required: true
    },
    priority: {
        type: String,
        enum: ['high', 'medium', 'low'],
        default: 'medium'
    },
    entityType: {
        type: String,
        enum: ['campaign', 'adset', 'ad', 'material'],
        required: true
    },
    entityId: { type: String, required: true },
    entityName: { type: String },
    accountId: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String },
    reason: { type: String },
    currentMetrics: {
        roas: { type: Number },
        spend: { type: Number },
        ctr: { type: Number },
        cpm: { type: Number },
        impressions: { type: Number },
    },
    action: {
        type: { type: String, required: true },
        params: { type: mongoose_1.Schema.Types.Mixed },
    },
    expectedImpact: { type: String },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'executed', 'failed', 'expired'],
        default: 'pending'
    },
    execution: {
        executedAt: { type: Date },
        executedBy: { type: String },
        success: { type: Boolean },
        error: { type: String },
        result: { type: mongoose_1.Schema.Types.Mixed },
    },
    expiresAt: {
        type: Date,
        default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) // 默认 24 小时后过期
    },
    source: {
        type: String,
        enum: ['auto_analysis', 'chat', 'health_check', 'rule_suggestion'],
        default: 'auto_analysis'
    },
    sourceId: { type: String },
}, {
    timestamps: true,
    collection: 'aisuggestions'
});
// 索引
aiSuggestionSchema.index({ status: 1, priority: -1 });
aiSuggestionSchema.index({ entityId: 1, entityType: 1 });
aiSuggestionSchema.index({ accountId: 1 });
aiSuggestionSchema.index({ expiresAt: 1 });
aiSuggestionSchema.index({ createdAt: -1 });
exports.AiSuggestion = mongoose_1.default.model('AiSuggestion', aiSuggestionSchema);
exports.default = exports.AiSuggestion;
