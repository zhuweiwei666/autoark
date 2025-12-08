"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
/**
 * 广告-素材映射表
 *
 * 核心归因表：记录每条广告使用的素材
 * 当 AutoArk 发布广告时，记录 adId → materialId 的映射关系
 *
 * 优势：
 * 1. 精准归因 - 通过 adId 直接找到素材，不依赖 Facebook 的 hash
 * 2. 高效查询 - 直接关联，无需反查
 * 3. 100% 可靠 - 不会因 hash 变化丢失归因
 */
const adMaterialMappingSchema = new mongoose_1.default.Schema({
    // ========== 核心映射 ==========
    adId: { type: String, required: true, index: true }, // Facebook 广告 ID
    materialId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'Material', required: true, index: true },
    // ========== 广告层级信息 ==========
    accountId: { type: String, index: true }, // Facebook 账户 ID
    campaignId: { type: String, index: true }, // 广告系列 ID
    adsetId: { type: String, index: true }, // 广告组 ID
    creativeId: { type: String, index: true }, // 创意 ID
    // ========== 素材信息快照（冗余，便于查询）==========
    materialType: { type: String, enum: ['image', 'video'] },
    materialName: { type: String },
    materialUrl: { type: String }, // 素材库 URL
    // ========== Facebook 返回的标识（备用）==========
    fbImageHash: { type: String }, // Facebook 图片 hash
    fbVideoId: { type: String }, // Facebook 视频 ID
    // ========== 发布信息 ==========
    publishedBy: { type: String }, // 发布者（投手）
    publishedAt: { type: Date, default: Date.now },
    taskId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'AdTask' }, // 关联的任务
    // ========== 状态 ==========
    status: {
        type: String,
        enum: ['active', 'paused', 'deleted'],
        default: 'active',
        index: true,
    },
}, { timestamps: true });
// ========== 索引 ==========
// 唯一索引：一条广告对应一个素材
adMaterialMappingSchema.index({ adId: 1 }, { unique: true });
// 查询索引
adMaterialMappingSchema.index({ materialId: 1, status: 1 });
adMaterialMappingSchema.index({ accountId: 1, materialId: 1 });
adMaterialMappingSchema.index({ campaignId: 1, materialId: 1 });
adMaterialMappingSchema.index({ publishedBy: 1, publishedAt: -1 });
adMaterialMappingSchema.index({ publishedAt: -1 });
// ========== 静态方法 ==========
/**
 * 记录广告-素材映射（发布广告时调用）
 */
adMaterialMappingSchema.statics.recordMapping = async function (data) {
    return this.findOneAndUpdate({ adId: data.adId }, {
        $set: {
            ...data,
            publishedAt: new Date(),
            status: 'active',
        },
    }, { upsert: true, new: true });
};
/**
 * 根据 adId 获取素材 ID
 */
adMaterialMappingSchema.statics.getMaterialId = async function (adId) {
    const mapping = await this.findOne({ adId }).lean();
    return mapping?.materialId?.toString() || null;
};
/**
 * 批量获取 adId → materialId 映射
 */
adMaterialMappingSchema.statics.getMaterialIds = async function (adIds) {
    const mappings = await this.find({ adId: { $in: adIds } }).lean();
    const map = new Map();
    for (const m of mappings) {
        map.set(m.adId, m.materialId.toString());
    }
    return map;
};
/**
 * 获取素材的所有广告
 */
adMaterialMappingSchema.statics.getAdsByMaterial = async function (materialId) {
    return this.find({ materialId, status: 'active' }).lean();
};
/**
 * 统计素材使用情况
 */
adMaterialMappingSchema.statics.getMaterialUsageStats = async function (materialId) {
    const result = await this.aggregate([
        { $match: { materialId: new mongoose_1.default.Types.ObjectId(materialId) } },
        {
            $group: {
                _id: null,
                totalAds: { $sum: 1 },
                activeAds: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
                accounts: { $addToSet: '$accountId' },
                campaigns: { $addToSet: '$campaignId' },
                optimizers: { $addToSet: '$publishedBy' },
            },
        },
    ]);
    if (result.length === 0) {
        return { totalAds: 0, activeAds: 0, accounts: [], campaigns: [], optimizers: [] };
    }
    return {
        totalAds: result[0].totalAds,
        activeAds: result[0].activeAds,
        accounts: result[0].accounts.filter(Boolean),
        campaigns: result[0].campaigns.filter(Boolean),
        optimizers: result[0].optimizers.filter(Boolean),
    };
};
exports.default = mongoose_1.default.model('AdMaterialMapping', adMaterialMappingSchema);
