"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const adSchema = new mongoose_1.default.Schema({
    adId: { type: String, required: true, unique: true },
    adsetId: String,
    campaignId: String,
    accountId: String,
    channel: { type: String, default: 'facebook' },
    name: String,
    status: String,
    creativeId: String,
    created_time: Date,
    updated_time: Date,
    raw: Object,
}, { timestamps: true });
exports.default = mongoose_1.default.model('Ad', adSchema);
