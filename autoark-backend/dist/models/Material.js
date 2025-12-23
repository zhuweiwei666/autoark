"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
/**
 * 素材数据模型 - AutoArk 素材库的核心
 *
 * 设计理念：
 * 1. 所有素材必须先上传到素材库
 * 2. 发布广告时从素材库选择，上传到 Facebook 并记录映射
 * 3. 通过映射关系实现精准数据归因
 * 4. 支持 AI 全自动化（素材库是单一真相源）
 */
const materialSchema = new mongoose_1.default.Schema({
    // 组织隔离
    organizationId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'Organization', index: true },
    // 素材名称
    name: { type: String, required: true },
    // 素材类型
    type: {
        type: String,
        required: true,
        enum: ['image', 'video'],
    },
    // 素材状态
    status: {
        type: String,
        default: 'uploaded',
        enum: ['uploading', 'uploaded', 'processing', 'ready', 'failed', 'deleted'],
    },
    // 存储信息
    storage: {
        provider: { type: String, default: 'r2' }, // r2, s3, local
        bucket: { type: String },
        key: { type: String }, // 存储路径/文件名
        url: { type: String, required: true }, // 公开访问 URL
    },
    // 文件信息
    file: {
        originalName: { type: String },
        mimeType: { type: String },
        size: { type: Number }, // 字节
        width: { type: Number }, // 图片/视频宽度
        height: { type: Number }, // 图片/视频高度
        duration: { type: Number }, // 视频时长（秒）
    },
    // 缩略图
    thumbnail: {
        url: { type: String },
        width: { type: Number },
        height: { type: Number },
    },
    // ========== 素材指纹系统（核心）==========
    // 唯一标识，用于去重和归因
    fingerprint: {
        pHash: { type: String }, // 感知哈希（图片）- 抗压缩、抗缩放
        md5: { type: String }, // 文件内容 MD5
        sha256: { type: String }, // SHA256（更安全）
        videoHash: { type: String }, // 视频帧采样哈希
    },
    // 组合指纹（用于唯一索引）
    fingerprintKey: { type: String, unique: true, sparse: true },
    // ========== Facebook 映射关系（多账户）==========
    // 同一个素材可能被上传到多个 Facebook 账户
    facebookMappings: [{
            accountId: { type: String, required: true }, // Facebook 账户 ID
            imageHash: { type: String }, // 图片上传后的 hash（图片素材）
            videoId: { type: String }, // 视频上传后的 ID（视频素材）
            uploadedAt: { type: Date },
            status: { type: String, enum: ['pending', 'uploaded', 'failed'], default: 'pending' },
        }],
    // 旧字段兼容（单账户场景）
    facebook: {
        imageHash: { type: String },
        videoId: { type: String },
        uploadedAt: { type: Date },
    },
    // 素材来源
    source: {
        type: { type: String, enum: ['upload', 'import'], default: 'upload' },
        importedAt: { type: Date },
        importedBy: { type: String },
    },
    // ========== 使用统计（实时更新）==========
    usage: {
        totalAds: { type: Number, default: 0 }, // 使用该素材的广告总数
        activeAds: { type: Number, default: 0 }, // 当前在跑的广告数
        totalCampaigns: { type: Number, default: 0 }, // 使用的广告系列数
        accounts: [{ type: String }], // 使用的账户列表
        optimizers: [{ type: String }], // 使用的投手列表
        lastUsedAt: { type: Date },
    },
    // ========== 累计效果指标（每日聚合更新）==========
    metrics: {
        totalSpend: { type: Number, default: 0 }, // 累计消耗
        totalRevenue: { type: Number, default: 0 }, // 累计收入
        totalImpressions: { type: Number, default: 0 }, // 累计展示
        totalClicks: { type: Number, default: 0 }, // 累计点击
        totalInstalls: { type: Number, default: 0 }, // 累计安装
        totalPurchases: { type: Number, default: 0 }, // 累计购买
        avgRoas: { type: Number, default: 0 }, // 平均 ROAS
        avgCtr: { type: Number, default: 0 }, // 平均 CTR
        avgCpi: { type: Number, default: 0 }, // 平均 CPI
        qualityScore: { type: Number, default: 50 }, // 质量评分 0-100
        firstUsedDate: { type: String }, // 首次使用日期
        lastActiveDate: { type: String }, // 最后有消耗日期
        activeDays: { type: Number, default: 0 }, // 有消耗的天数
        updatedAt: { type: Date },
    },
    // 标签和分类
    tags: [{ type: String }],
    folder: { type: String, default: '默认' },
    // 元数据
    createdBy: { type: String },
    notes: { type: String },
    // 🧪 自动测试
    autoTestStatus: {
        type: String,
        enum: ['pending', 'tested', 'failed', 'skipped'],
        default: 'pending'
    },
    autoTestAt: { type: Date },
    autoTestError: { type: String },
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
});
// 索引
materialSchema.index({ type: 1, status: 1 });
materialSchema.index({ folder: 1, createdAt: -1 });
materialSchema.index({ tags: 1 });
materialSchema.index({ createdBy: 1, createdAt: -1 });
materialSchema.index({ 'storage.url': 1 });
// 指纹索引（核心）
materialSchema.index({ fingerprintKey: 1 }, { unique: true, sparse: true });
materialSchema.index({ 'fingerprint.pHash': 1 });
materialSchema.index({ 'fingerprint.md5': 1 });
// Facebook 映射索引（用于归因）
materialSchema.index({ 'facebookMappings.imageHash': 1 });
materialSchema.index({ 'facebookMappings.videoId': 1 });
materialSchema.index({ 'facebookMappings.accountId': 1 });
materialSchema.index({ 'facebook.imageHash': 1 });
materialSchema.index({ 'facebook.videoId': 1 });
// 指标索引
materialSchema.index({ 'metrics.totalSpend': -1 });
materialSchema.index({ 'metrics.avgRoas': -1 });
materialSchema.index({ 'metrics.qualityScore': -1 });
// 自动测试索引
materialSchema.index({ autoTestStatus: 1, createdAt: -1 });
// 虚拟字段：文件大小（友好格式）
materialSchema.virtual('fileSizeFormatted').get(function () {
    const size = this.file?.size;
    if (!size)
        return '-';
    if (size < 1024)
        return `${size} B`;
    if (size < 1024 * 1024)
        return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 * 1024 * 1024)
        return `${(size / 1024 / 1024).toFixed(1)} MB`;
    return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
});
// 虚拟字段：视频时长（友好格式）
materialSchema.virtual('durationFormatted').get(function () {
    const duration = this.file?.duration;
    if (!duration)
        return '-';
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
});
exports.default = mongoose_1.default.model('Material', materialSchema);
