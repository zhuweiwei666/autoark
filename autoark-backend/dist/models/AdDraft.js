"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
/**
 * 广告草稿数据模型
 * 用于保存批量广告创建的配置（发布前）
 */
// 账户配置 Schema
const accountConfigSchema = new mongoose_1.default.Schema({
    accountId: { type: String, required: true },
    accountName: { type: String },
    pageId: { type: String },
    pageName: { type: String },
    instagramAccountId: { type: String },
    pixelId: { type: String },
    pixelName: { type: String },
    domain: { type: String },
    conversionEvent: { type: String, default: 'PURCHASE' },
}, { _id: false });
// 广告系列配置 Schema
const campaignConfigSchema = new mongoose_1.default.Schema({
    nameTemplate: { type: String, required: true },
    status: { type: String, default: 'PAUSED', enum: ['ACTIVE', 'PAUSED'] },
    objective: { type: String, default: 'OUTCOME_SALES' },
    buyingType: { type: String, default: 'AUCTION', enum: ['AUCTION', 'RESERVED'] },
    spendCap: { type: Number },
    budgetOptimization: { type: Boolean, default: true }, // CBO
    budgetType: { type: String, default: 'DAILY', enum: ['DAILY', 'LIFETIME'] },
    budget: { type: Number, required: true },
    bidStrategy: { type: String, default: 'LOWEST_COST_WITHOUT_CAP' },
    bidAmount: { type: Number },
    specialAdCategories: [{ type: String }],
}, { _id: false });
// 广告组配置 Schema
const adsetConfigSchema = new mongoose_1.default.Schema({
    nameTemplate: { type: String, required: true },
    status: { type: String, default: 'PAUSED', enum: ['ACTIVE', 'PAUSED'] },
    // 倍率：每个 Campaign 下创建多少个广告组
    multiplier: { type: Number, default: 1, min: 1, max: 10 },
    // 预算（如果不使用 CBO）
    budgetType: { type: String, enum: ['DAILY', 'LIFETIME'] },
    budget: { type: Number },
    // 排期
    startTime: { type: Date },
    endTime: { type: Date },
    // 优化目标
    optimizationGoal: { type: String, default: 'OFFSITE_CONVERSIONS' },
    billingEvent: { type: String, default: 'IMPRESSIONS' },
    // 出价
    bidStrategy: { type: String },
    bidAmount: { type: Number },
    costCap: { type: Number },
    // 归因设置（新版：支持点击/浏览/互动观看）
    attribution: {
        clickWindow: { type: Number, default: 1 }, // 点击后归因窗口（天）
        viewWindow: { type: Number, default: 1 }, // 浏览后归因窗口（天），0 表示不启用
        engagedViewWindow: { type: Number, default: 1 }, // 互动观看后归因窗口（天），0 表示不启用
    },
    // 兼容旧字段（历史草稿可能使用 attributionSpec）
    attributionSpec: {
        clickWindow: { type: Number },
        viewWindow: { type: Number },
    },
    // 投放速度
    pacingType: { type: String, default: 'standard', enum: ['standard', 'no_pacing'] },
    // 版位配置
    placement: {
        type: { type: String, default: 'AUTOMATIC', enum: ['AUTOMATIC', 'MANUAL'] },
        platforms: [{ type: String }], // ['facebook', 'instagram', 'audience_network', 'messenger']
        positions: [{ type: String }], // ['feed', 'story', 'reels', 'right_column', etc.]
    },
    // 设备配置
    device: {
        deviceType: { type: String, default: 'ALL', enum: ['ALL', 'Android', 'iOS'] },
        includedDevices: [{ type: String }],
        excludedDevices: [{ type: String }],
        osVersionMin: { type: String },
        osVersionMax: { type: String },
        wifiOnly: { type: Boolean, default: false },
    },
    // 定向包引用（或内联定向配置）
    // 兼容前端传空字符串：'' -> undefined（避免 CastError）
    targetingPackageId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'TargetingPackage',
        set: (v) => (v === '' ? undefined : v),
    },
    inlineTargeting: { type: Object }, // 如果不使用定向包，直接配置
}, { _id: false });
// 广告配置 Schema
const adConfigSchema = new mongoose_1.default.Schema({
    nameTemplate: { type: String, required: true },
    status: { type: String, default: 'PAUSED', enum: ['ACTIVE', 'PAUSED'] },
    // 追踪配置
    tracking: {
        websiteEvent: { type: Boolean, default: true },
        appEvent: { type: Boolean, default: false },
        urlTags: { type: String },
    },
    // 广告格式
    format: { type: String, default: 'SINGLE', enum: ['SINGLE', 'CAROUSEL', 'COLLECTION'] },
    // 创意组引用列表
    creativeGroupIds: [{ type: mongoose_1.default.Schema.Types.ObjectId, ref: 'CreativeGroup' }],
    // 文案包引用列表
    copywritingPackageIds: [{ type: mongoose_1.default.Schema.Types.ObjectId, ref: 'CopywritingPackage' }],
    // 动态素材设置
    dynamicCreative: { type: Boolean, default: false },
}, { _id: false });
// 发布策略 Schema
const publishStrategySchema = new mongoose_1.default.Schema({
    // 定向分配级别
    targetingLevel: { type: String, default: 'ADSET', enum: ['CAMPAIGN', 'ADSET'] },
    // 创意组分配级别
    creativeLevel: { type: String, default: 'ADSET', enum: ['ACCOUNT', 'CAMPAIGN', 'ADSET'] },
    // 文案包分配方式
    copywritingMode: { type: String, default: 'SHARED', enum: ['SHARED', 'SEQUENTIAL'] },
    // 发布计划
    schedule: { type: String, default: 'IMMEDIATE', enum: ['IMMEDIATE', 'SCHEDULED'] },
    scheduledTime: { type: Date },
}, { _id: false });
const adDraftSchema = new mongoose_1.default.Schema({
    // 组织隔离
    organizationId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'Organization', index: true },
    // 草稿基本信息
    name: { type: String, required: true },
    status: {
        type: String,
        default: 'draft',
        enum: ['draft', 'ready', 'published', 'failed'],
    },
    // 账户配置（支持多账户）
    accounts: [accountConfigSchema],
    // 广告系列配置
    campaign: campaignConfigSchema,
    // 广告组配置
    adset: adsetConfigSchema,
    // 广告配置
    ad: adConfigSchema,
    // 发布策略
    publishStrategy: publishStrategySchema,
    // 预估数据
    estimates: {
        totalCampaigns: { type: Number, default: 0 },
        totalAdsets: { type: Number, default: 0 },
        totalAds: { type: Number, default: 0 },
        dailyBudget: { type: Number, default: 0 },
    },
    // 验证结果
    validation: {
        isValid: { type: Boolean, default: false },
        errors: [{
                field: String,
                message: String,
                severity: { type: String, enum: ['error', 'warning'] },
            }],
        warnings: [{
                field: String,
                message: String,
            }],
        validatedAt: { type: Date },
    },
    // 关联的任务（发布后）
    taskId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'AdTask' },
    // 元数据
    createdBy: { type: String },
    lastModifiedBy: { type: String },
    notes: { type: String },
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
});
// 索引
adDraftSchema.index({ status: 1, createdAt: -1 });
adDraftSchema.index({ 'accounts.accountId': 1 });
adDraftSchema.index({ createdBy: 1, createdAt: -1 });
// 计算预估数据
adDraftSchema.methods.calculateEstimates = function () {
    const accountCount = this.accounts?.length || 0;
    const creativeGroupCount = this.ad?.creativeGroupIds?.length || 1;
    const copywritingCount = this.ad?.copywritingPackageIds?.length || 1;
    const adsetMultiplier = Math.min(10, Math.max(1, Number(this.adset?.multiplier || 1)));
    // 根据发布策略计算
    let totalCampaigns = accountCount;
    let totalAdsets = accountCount * adsetMultiplier;
    let totalAds = accountCount;
    // 说明：目前发布逻辑是“每个账户一个 Campaign”，且每个 Campaign 下可创建 N 个广告组（倍率）
    // targetingLevel 仅影响未来的分配策略，这里仍按倍率计算广告组数。
    if (this.publishStrategy?.creativeLevel === 'ADSET') {
        // 每个广告组使用所有创意组
        totalAds = totalAdsets * creativeGroupCount;
    }
    else if (this.publishStrategy?.creativeLevel === 'CAMPAIGN') {
        totalAds = totalCampaigns * creativeGroupCount;
    }
    else {
        totalAds = accountCount * creativeGroupCount;
    }
    // 如果文案包是顺序分配，广告数量可能翻倍
    if (this.publishStrategy?.copywritingMode === 'SEQUENTIAL') {
        totalAds = totalAds * copywritingCount;
    }
    this.estimates = {
        totalCampaigns,
        totalAdsets,
        totalAds,
        dailyBudget: this.campaign?.budgetOptimization
            ? (this.campaign?.budget || 0) * accountCount
            : (this.adset?.budget || this.campaign?.budget || 0) * totalAdsets,
    };
    return this.estimates;
};
// 验证草稿配置
adDraftSchema.methods.validate = async function () {
    const errors = [];
    const warnings = [];
    // 验证账户
    if (!this.accounts || this.accounts.length === 0) {
        errors.push({ field: 'accounts', message: '请至少选择一个广告账户', severity: 'error' });
    }
    else {
        for (const account of this.accounts) {
            if (!account.pageId) {
                errors.push({ field: `accounts.${account.accountId}.pageId`, message: `账户 ${account.accountName} 未选择 Facebook 主页`, severity: 'error' });
            }
            if (!account.pixelId) {
                warnings.push({ field: `accounts.${account.accountId}.pixelId`, message: `账户 ${account.accountName} 未选择 Pixel` });
            }
        }
    }
    // 验证广告系列
    if (!this.campaign?.nameTemplate) {
        errors.push({ field: 'campaign.nameTemplate', message: '请填写广告系列名称', severity: 'error' });
    }
    if (!this.campaign?.budget || this.campaign.budget <= 0) {
        errors.push({ field: 'campaign.budget', message: '请填写有效的预算金额', severity: 'error' });
    }
    // 验证广告组
    if (!this.adset?.nameTemplate) {
        errors.push({ field: 'adset.nameTemplate', message: '请填写广告组名称', severity: 'error' });
    }
    if (!this.adset?.targetingPackageId && !this.adset?.inlineTargeting) {
        errors.push({ field: 'adset.targeting', message: '请选择定向包或配置定向条件', severity: 'error' });
    }
    // 验证广告
    if (!this.ad?.nameTemplate) {
        errors.push({ field: 'ad.nameTemplate', message: '请填写广告名称', severity: 'error' });
    }
    if (!this.ad?.creativeGroupIds || this.ad.creativeGroupIds.length === 0) {
        errors.push({ field: 'ad.creativeGroupIds', message: '请至少选择一个创意组', severity: 'error' });
    }
    if (!this.ad?.copywritingPackageIds || this.ad.copywritingPackageIds.length === 0) {
        errors.push({ field: 'ad.copywritingPackageIds', message: '请至少选择一个文案包', severity: 'error' });
    }
    this.validation = {
        isValid: errors.length === 0,
        errors,
        warnings,
        validatedAt: new Date(),
    };
    return this.validation;
};
exports.default = mongoose_1.default.model('AdDraft', adDraftSchema);
