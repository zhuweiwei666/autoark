"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
/**
 * Facebook 授权用户模型
 * 存储授权用户的 Pixels、账户等信息，避免每次实时抓取
 */
const pixelSchema = new mongoose_1.default.Schema({
    pixelId: { type: String, required: true },
    name: { type: String, required: true },
    // 该 Pixel 可用于哪些账户
    accounts: [{
            accountId: { type: String, required: true },
            accountName: { type: String },
        }],
    lastSyncedAt: { type: Date, default: Date.now },
});
const catalogSchema = new mongoose_1.default.Schema({
    catalogId: { type: String, required: true },
    name: { type: String },
    business: {
        id: { type: String },
        name: { type: String },
    },
    lastSyncedAt: { type: Date, default: Date.now },
});
const facebookUserSchema = new mongoose_1.default.Schema({
    // Facebook 用户 ID
    fbUserId: { type: String, required: true, unique: true, index: true },
    fbUserName: { type: String },
    // 关联的 Token ID
    tokenId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'Token' },
    // 该用户拥有的所有 Pixels（跨账户汇总）
    pixels: [pixelSchema],
    // 该用户拥有的所有广告账户
    adAccounts: [{
            accountId: { type: String, required: true },
            name: { type: String },
            status: { type: Number }, // 1=active, 2=disabled, etc.
            currency: { type: String },
            timezone: { type: String },
        }],
    // 该用户拥有的所有粉丝页
    pages: [{
            pageId: { type: String, required: true },
            name: { type: String },
            accessToken: { type: String }, // Page access token
            // 可用于哪些账户
            accounts: [{
                    accountId: { type: String },
                }],
        }],
    // 该用户可访问的 Catalogs（Product Catalog）
    productCatalogs: [catalogSchema],
    // 同步状态
    lastSyncedAt: { type: Date },
    syncStatus: {
        type: String,
        enum: ['pending', 'syncing', 'completed', 'failed'],
        default: 'pending'
    },
    syncError: { type: String },
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
});
// 索引
facebookUserSchema.index({ 'pixels.pixelId': 1 });
facebookUserSchema.index({ 'adAccounts.accountId': 1 });
facebookUserSchema.index({ 'productCatalogs.catalogId': 1 });
facebookUserSchema.index({ tokenId: 1 });
exports.default = mongoose_1.default.model('FacebookUser', facebookUserSchema);
