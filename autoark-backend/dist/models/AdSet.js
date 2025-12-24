"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const adSetSchema = new mongoose_1.default.Schema({
    adsetId: { type: String, required: true, unique: true },
    accountId: String,
    campaignId: String,
    channel: { type: String, default: 'facebook' },
    platform: { type: String, enum: ['facebook', 'tiktok'], default: 'facebook', index: true },
    name: String,
    status: String,
    optimizationGoal: String,
    budget: Number,
    created_time: Date,
    updated_time: Date,
    raw: Object,
}, { timestamps: true });
exports.default = mongoose_1.default.model('AdSet', adSetSchema);
