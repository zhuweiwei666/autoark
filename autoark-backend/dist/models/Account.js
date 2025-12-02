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
    timezone: String,
    operator: String, // 优化师
    token: String,
    status: String,
    balance: Number, // 余额 (可能需要更大的类型，例如 Decimal128，取决于精度要求)
    spendCap: String, // 花费上限
    amountSpent: String, // 已花费
    accountStatus: Number, // Facebook 返回的具体状态码
    disableReason: Number, // 禁用原因
}, { timestamps: true });
exports.default = mongoose_1.default.model('Account', accountSchema);
