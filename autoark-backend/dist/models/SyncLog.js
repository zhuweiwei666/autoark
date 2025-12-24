"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const syncLogSchema = new mongoose_1.default.Schema({
    startTime: { type: Date, required: true },
    endTime: Date,
    channel: { type: String, default: 'facebook' }, // 'facebook' | 'tiktok'
    status: {
        type: String,
        enum: ['RUNNING', 'SUCCESS', 'FAILED'],
        default: 'RUNNING',
    },
    details: Object, // Summary of what was synced
    error: String,
}, { timestamps: true });
exports.default = mongoose_1.default.model('SyncLog', syncLogSchema);
