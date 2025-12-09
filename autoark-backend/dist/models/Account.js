"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const accountSchema = new mongoose_1.default.Schema({
    channel: { type: String, required: true }, // 'facebook' / 'tiktok'
    accountId: { type: String, required: true, index: true },
    name: String,
    timezone: String,
    operator: String, // 优化师
    token: String,
    status: String,
    balance: Number,
    spendCap: String,
    amountSpent: String,
    accountStatus: Number,
    disableReason: Number,
    // ==================== 权限和组织管理 ====================
    organizationId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Organization',
        index: true,
        // 未分配的账户可以为空
    },
    // ==================== 标签和分组 ====================
    tags: [{
            type: String,
            trim: true,
            maxlength: 30,
        }], // 标签：['电商', '品牌A', '测试账户'] 等
    groupId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'AccountGroup',
        index: true,
    }, // 所属分组
    // ==================== 分配信息 ====================
    assignedBy: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User',
    }, // 谁分配的
    assignedAt: {
        type: Date,
    }, // 分配时间
    notes: {
        type: String,
        maxlength: 500,
    }, // 备注说明
    createdBy: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User',
    },
}, { timestamps: true });
// 索引
accountSchema.index({ accountId: 1, channel: 1 }, { unique: true });
accountSchema.index({ organizationId: 1, status: 1 });
accountSchema.index({ tags: 1 });
accountSchema.index({ groupId: 1 });
accountSchema.index({ createdBy: 1 });
exports.default = mongoose_1.default.model('Account', accountSchema);
