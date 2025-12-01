"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const accountSchema = new mongoose_1.default.Schema({
    channel: { type: String, required: true }, // 'facebook' / 'tiktok'
    accountId: { type: String, required: true },
    name: String,
    currency: String,
    timezone: String,
    operator: String, // 优化师
    token: String,
    status: String,
}, { timestamps: true });
exports.default = mongoose_1.default.model('Account', accountSchema);
