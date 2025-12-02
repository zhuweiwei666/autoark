"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const campaignSchema = new mongoose_1.default.Schema({
    campaignId: { type: String, required: true, unique: true },
    accountId: String,
    channel: { type: String, default: 'facebook' },
    name: String,
    status: String,
    objective: String,
    buying_type: String, // 购买类型，如 AUCTION
    daily_budget: String, // 日预算
    budget_remaining: String, // 剩余预算
    created_time: Date,
    updated_time: Date,
    raw: Object,
}, { timestamps: true });
exports.default = mongoose_1.default.model('Campaign', campaignSchema);
