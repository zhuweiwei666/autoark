"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const FbTokenSchema = new mongoose_1.default.Schema({
    userId: { type: String, required: true, index: true },
    organizationId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'Organization', index: true }, // 组织隔离
    token: { type: String, required: true },
    optimizer: { type: String, index: true }, // 优化师名称，支持筛选
    status: {
        type: String,
        enum: ['active', 'expired', 'invalid'],
        default: 'active',
        index: true,
    },
    lastCheckedAt: { type: Date }, // 最后检查时间
    expiresAt: { type: Date }, // token 过期时间
    fbUserId: { type: String }, // Facebook 用户 ID
    fbUserName: { type: String }, // Facebook 用户名称
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
}, {
    timestamps: true, // 自动管理 createdAt 和 updatedAt
});
// 索引：优化师 + 创建日期，用于筛选
FbTokenSchema.index({ optimizer: 1, createdAt: -1 });
// 索引：状态 + 最后检查时间
FbTokenSchema.index({ status: 1, lastCheckedAt: -1 });
exports.default = mongoose_1.default.model('FbToken', FbTokenSchema);
