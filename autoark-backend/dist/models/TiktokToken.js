"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const TiktokTokenSchema = new mongoose_1.default.Schema({
    userId: { type: String, required: true, index: true },
    organizationId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'Organization', index: true }, // 组织隔离
    accessToken: { type: String, required: true },
    refreshToken: { type: String },
    openId: { type: String, index: true },
    advertiserIds: [{ type: String }],
    status: {
        type: String,
        enum: ['active', 'expired', 'invalid'],
        default: 'active',
        index: true,
    },
    lastCheckedAt: { type: Date },
    expiresAt: { type: Date },
    refreshTokenExpiresAt: { type: Date },
    tiktokUserName: { type: String },
}, {
    timestamps: true,
});
// 索引
TiktokTokenSchema.index({ status: 1, lastCheckedAt: -1 });
exports.default = mongoose_1.default.model('TiktokToken', TiktokTokenSchema);
