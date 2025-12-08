"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
/**
 * Creative 模型 - 存储 Facebook 创意详情
 * 用于关联广告与素材，实现素材级别追踪
 */
const creativeSchema = new mongoose_1.default.Schema({
    // 基本信息
    channel: { type: String, default: 'facebook' },
    creativeId: { type: String, required: true, unique: true },
    name: String,
    status: String,
    // 素材类型
    type: { type: String, enum: ['image', 'video', 'carousel', 'collection', 'unknown'] },
    // 图片素材标识
    imageHash: String, // Facebook 图片 hash（关键：用于素材去重）
    imageUrl: String, // 图片 URL
    // 视频素材标识
    videoId: String, // Facebook 视频 ID（关键：用于素材去重）
    // 缩略图
    thumbnailUrl: String,
    // 旧字段兼容
    hash: String, // 等同于 imageHash
    storageUrl: String, // 等同于 thumbnailUrl 或 imageUrl
    // ========== 素材指纹系统 ==========
    // 本地存储（从 Facebook 下载后存到 R2）
    localStorageUrl: String, // 存储到 R2 的 URL
    localStorageKey: String, // R2 存储的 key
    downloaded: { type: Boolean, default: false },
    downloadedAt: Date,
    // 原素材标识（用于判断是否可再次上传）
    isOriginal: { type: Boolean, default: false }, // 是否为原素材（非缩略图）
    reusable: { type: Boolean, default: false }, // 是否可再次上传到 Facebook
    // 素材指纹（用于跨系统唯一识别）
    fingerprint: {
        pHash: String, // 感知哈希（图片主用）- 抗压缩、抗缩放
        md5: String, // 文件 MD5
        fileSize: Number, // 文件大小
        width: Number, // 实际宽度
        height: Number, // 实际高度
        isOriginal: Boolean, // 是否为原素材
    },
    // 素材尺寸
    width: Number,
    height: Number,
    duration: Number, // 视频时长（秒）
    // 关联信息
    accountId: String,
    // 标签和分类
    tags: [String],
    createdBy: String,
    // 关联的 Material（上传的素材）
    materialId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'Material' },
    // 原始数据
    raw: Object,
}, { timestamps: true });
// 索引
creativeSchema.index({ creativeId: 1 }, { unique: true });
creativeSchema.index({ imageHash: 1 });
creativeSchema.index({ videoId: 1 });
creativeSchema.index({ accountId: 1 });
creativeSchema.index({ materialId: 1 });
creativeSchema.index({ 'fingerprint.pHash': 1 });
creativeSchema.index({ 'fingerprint.md5': 1 });
creativeSchema.index({ downloaded: 1 });
creativeSchema.index({ reusable: 1 }); // 可复用素材查询
exports.default = mongoose_1.default.model('Creative', creativeSchema);
