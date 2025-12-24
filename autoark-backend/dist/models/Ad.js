"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
/**
 * Ad 模型 - 存储 Facebook 广告详情
 *
 * 🎯 素材归因核心：
 * - materialId: 直接关联到素材库的素材
 * - 广告发布时记录，数据聚合时直接 JOIN
 *
 * 🔍 审核状态追踪：
 * - effectiveStatus: 广告有效状态
 * - reviewFeedback: 被拒原因详情
 */
const adSchema = new mongoose_1.default.Schema({
    adId: { type: String, required: true, unique: true },
    adsetId: String,
    adsetName: String,
    campaignId: String,
    campaignName: String,
    accountId: String,
    channel: { type: String, default: 'facebook' },
    platform: { type: String, enum: ['facebook', 'tiktok'], default: 'facebook', index: true },
    name: String,
    status: String,
    // ========== 审核状态追踪 ==========
    effectiveStatus: {
        type: String,
        enum: [
            'ACTIVE', // 审核通过，投放中
            'PAUSED', // 暂停
            'DELETED', // 已删除
            'PENDING_REVIEW', // 审核中
            'DISAPPROVED', // 审核被拒
            'PREAPPROVED', // 预批准
            'PENDING_BILLING_INFO', // 待支付信息
            'CAMPAIGN_PAUSED', // 广告系列暂停
            'ADSET_PAUSED', // 广告组暂停
            'ARCHIVED', // 已归档
            'IN_PROCESS', // 处理中
            'WITH_ISSUES', // 有问题
        ],
    },
    reviewFeedback: {
        // 全局审核结果
        global: { type: mongoose_1.default.Schema.Types.Mixed },
        // 具体政策违规
        placement: { type: mongoose_1.default.Schema.Types.Mixed }, // 版位问题
        bodyPolicy: { type: String }, // 文案违规原因
        imagePolicy: { type: String }, // 图片违规原因
        videoPolicy: { type: String }, // 视频违规原因
        landingPagePolicy: { type: String }, // 落地页违规原因
    },
    reviewStatusUpdatedAt: Date, // 上次检查审核状态的时间
    // Creative 关联
    creativeId: String,
    // ========== 素材归因（核心）==========
    // 直接关联到 AutoArk 素材库
    materialId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'Material' },
    // Facebook 素材标识（备用/兼容）
    imageHash: String, // 图片 hash
    videoId: String, // 视频 ID
    thumbnailUrl: String, // 缩略图 URL
    // 关联到发布任务
    taskId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'AdTask' },
    created_time: Date,
    updated_time: Date,
    raw: Object,
}, { timestamps: true });
// 索引
adSchema.index({ adId: 1 }, { unique: true });
adSchema.index({ campaignId: 1 });
adSchema.index({ adsetId: 1 });
adSchema.index({ accountId: 1 });
adSchema.index({ creativeId: 1 });
adSchema.index({ materialId: 1 }); // 🎯 素材归因索引
adSchema.index({ imageHash: 1 });
adSchema.index({ videoId: 1 });
adSchema.index({ taskId: 1 }); // 任务关联索引
adSchema.index({ effectiveStatus: 1 }); // 审核状态索引
adSchema.index({ effectiveStatus: 1, reviewStatusUpdatedAt: 1 }); // 复合索引：查找需要更新状态的广告
exports.default = mongoose_1.default.model('Ad', adSchema);
