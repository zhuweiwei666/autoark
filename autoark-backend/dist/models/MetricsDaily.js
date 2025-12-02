"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const metricsDailySchema = new mongoose_1.default.Schema({
    date: { type: String, required: true }, // YYYY-MM-DD
    channel: { type: String, default: 'facebook' },
    accountId: String,
    campaignId: String,
    adsetId: String,
    adId: String,
    // Metrics
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    spendUsd: { type: Number, default: 0 },
    cpc: Number,
    ctr: Number,
    cpm: Number,
    installs: { type: Number, default: 0 },
    conversions: { type: Number, default: 0 }, // Generic conversions if installs not specific
    // New fields for detailed insights
    actions: mongoose_1.default.Schema.Types.Mixed, // Array of {action_type, value}
    action_values: mongoose_1.default.Schema.Types.Mixed, // Array of {action_type, value}
    purchase_roas: Number,
    purchase_value: Number,
    mobile_app_install_count: Number, // Example for specific event count
    raw: Object,
}, { timestamps: true });
// Compound unique index for upsert (ad level)
metricsDailySchema.index({ adId: 1, date: 1 }, { unique: true });
// New compound unique index for campaign level insights
metricsDailySchema.index({ campaignId: 1, date: 1 }, { unique: true });
exports.default = mongoose_1.default.model('MetricsDaily', metricsDailySchema);
