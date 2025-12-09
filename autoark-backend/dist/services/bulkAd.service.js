"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rerunTask = exports.retryFailedItems = exports.cancelTask = exports.getTaskList = exports.getTask = exports.executeTaskForAccount = exports.publishDraft = exports.validateDraft = exports.deleteDraft = exports.getDraftList = exports.getDraft = exports.updateDraft = exports.createDraft = void 0;
const AdDraft_1 = __importDefault(require("../models/AdDraft"));
const AdTask_1 = __importDefault(require("../models/AdTask"));
const TargetingPackage_1 = __importDefault(require("../models/TargetingPackage"));
const CopywritingPackage_1 = __importDefault(require("../models/CopywritingPackage"));
const CreativeGroup_1 = __importDefault(require("../models/CreativeGroup"));
const FbToken_1 = __importDefault(require("../models/FbToken"));
const AdMaterialMapping_1 = __importDefault(require("../models/AdMaterialMapping"));
const logger_1 = __importDefault(require("../utils/logger"));
const bulkCreate_api_1 = require("../integration/facebook/bulkCreate.api");
/**
 * 批量广告创建服务
 * 处理广告草稿的创建、验证、发布和任务管理
 */
// ==================== 草稿管理 ====================
/**
 * 创建广告草稿
 */
const createDraft = async (data, userId) => {
    const draft = new AdDraft_1.default({
        ...data,
        createdBy: userId,
        lastModifiedBy: userId,
    });
    // 计算预估数据
    if (draft.calculateEstimates) {
        draft.calculateEstimates();
    }
    await draft.save();
    logger_1.default.info(`[BulkAd] Draft created: ${draft._id}`);
    return draft;
};
exports.createDraft = createDraft;
/**
 * 更新广告草稿
 */
const updateDraft = async (draftId, data, userId) => {
    const draft = await AdDraft_1.default.findById(draftId);
    if (!draft) {
        throw new Error('Draft not found');
    }
    // 已发布的草稿不能修改
    if (draft.status === 'published') {
        throw new Error('Cannot update published draft');
    }
    Object.assign(draft, data, { lastModifiedBy: userId });
    // 重新计算预估数据
    if (draft.calculateEstimates) {
        draft.calculateEstimates();
    }
    // 重新验证
    draft.validation = { isValid: false, errors: [], warnings: [], validatedAt: undefined };
    await draft.save();
    logger_1.default.info(`[BulkAd] Draft updated: ${draftId}`);
    return draft;
};
exports.updateDraft = updateDraft;
/**
 * 获取草稿详情
 */
const getDraft = async (draftId) => {
    const draft = await AdDraft_1.default.findById(draftId)
        .populate('adset.targetingPackageId')
        .populate('ad.creativeGroupIds')
        .populate('ad.copywritingPackageIds');
    if (!draft) {
        throw new Error('Draft not found');
    }
    return draft;
};
exports.getDraft = getDraft;
/**
 * 获取草稿列表
 */
const getDraftList = async (query = {}) => {
    const { status, createdBy, page = 1, pageSize = 20 } = query;
    const filter = {};
    if (status)
        filter.status = status;
    if (createdBy)
        filter.createdBy = createdBy;
    const [list, total] = await Promise.all([
        AdDraft_1.default.find(filter)
            .sort({ createdAt: -1 })
            .skip((page - 1) * pageSize)
            .limit(pageSize)
            .lean(),
        AdDraft_1.default.countDocuments(filter),
    ]);
    return { list, total, page, pageSize };
};
exports.getDraftList = getDraftList;
/**
 * 删除草稿
 */
const deleteDraft = async (draftId) => {
    const draft = await AdDraft_1.default.findById(draftId);
    if (!draft) {
        throw new Error('Draft not found');
    }
    if (draft.status === 'published') {
        throw new Error('Cannot delete published draft');
    }
    await AdDraft_1.default.deleteOne({ _id: draftId });
    logger_1.default.info(`[BulkAd] Draft deleted: ${draftId}`);
    return { success: true };
};
exports.deleteDraft = deleteDraft;
/**
 * 验证草稿
 */
const validateDraft = async (draftId) => {
    const draft = await AdDraft_1.default.findById(draftId);
    if (!draft) {
        throw new Error('Draft not found');
    }
    // 简化验证逻辑
    const errors = [];
    const warnings = [];
    if (!draft.accounts || draft.accounts.length === 0) {
        errors.push({ field: 'accounts', message: '请至少选择一个广告账户', severity: 'error' });
    }
    if (!draft.campaign?.nameTemplate) {
        errors.push({ field: 'campaign.nameTemplate', message: '请填写广告系列名称', severity: 'error' });
    }
    if (!draft.campaign?.budget || draft.campaign.budget <= 0) {
        errors.push({ field: 'campaign.budget', message: '请填写有效的预算金额', severity: 'error' });
    }
    if (!draft.adset?.targetingPackageId && !draft.adset?.inlineTargeting) {
        errors.push({ field: 'adset.targeting', message: '请选择定向包或配置定向条件', severity: 'error' });
    }
    if (!draft.ad?.creativeGroupIds || draft.ad.creativeGroupIds.length === 0) {
        errors.push({ field: 'ad.creativeGroupIds', message: '请至少选择一个创意组', severity: 'error' });
    }
    if (!draft.ad?.copywritingPackageIds || draft.ad.copywritingPackageIds.length === 0) {
        errors.push({ field: 'ad.copywritingPackageIds', message: '请至少选择一个文案包', severity: 'error' });
    }
    const validation = {
        isValid: errors.length === 0,
        errors,
        warnings,
        validatedAt: new Date(),
    };
    draft.validation = validation;
    await draft.save();
    return validation;
};
exports.validateDraft = validateDraft;
// ==================== 发布流程 ====================
/**
 * 发布草稿（创建任务）
 */
const publishDraft = async (draftId, userId) => {
    const draft = await (0, exports.getDraft)(draftId);
    // 验证草稿
    const validation = await (0, exports.validateDraft)(draftId);
    if (!validation.isValid) {
        throw new Error(`Draft validation failed: ${validation.errors.map((e) => e.message).join(', ')}`);
    }
    // 计算预估
    const accountCount = draft.accounts?.length || 0;
    const creativeGroupCount = draft.ad?.creativeGroupIds?.length || 1;
    // 创建任务
    const task = new AdTask_1.default({
        taskType: 'BULK_AD_CREATE',
        status: 'pending',
        platform: 'facebook',
        draftId: draft._id,
        // 初始化任务项
        items: draft.accounts.map((account) => ({
            accountId: account.accountId,
            accountName: account.accountName,
            status: 'pending',
            progress: { current: 0, total: 3, percentage: 0 },
        })),
        // 保存配置快照
        configSnapshot: {
            accounts: draft.accounts,
            campaign: draft.campaign,
            adset: draft.adset,
            ad: draft.ad,
            publishStrategy: draft.publishStrategy,
        },
        // 设置预估总数
        progress: {
            totalAccounts: accountCount,
            totalCampaigns: accountCount,
            totalAdsets: accountCount,
            totalAds: accountCount * creativeGroupCount,
        },
        publishSettings: {
            schedule: draft.publishStrategy?.schedule || 'IMMEDIATE',
            scheduledTime: draft.publishStrategy?.scheduledTime,
        },
        createdBy: userId,
    });
    await task.save();
    // 更新草稿状态
    draft.status = 'published';
    draft.taskId = task._id;
    await draft.save();
    logger_1.default.info(`[BulkAd] Draft published, task created: ${task._id}`);
    // 检查 Redis 是否可用
    const { getRedisClient } = await Promise.resolve().then(() => __importStar(require('../config/redis')));
    const redisAvailable = (() => {
        try {
            return getRedisClient() !== null;
        }
        catch {
            return false;
        }
    })();
    if (redisAvailable) {
        // Redis 可用，使用队列异步执行
        logger_1.default.info(`[BulkAd] Redis available, adding task to queue`);
        const { addBulkAdJobsBatch } = await Promise.resolve().then(() => __importStar(require('../queue/bulkAd.queue')));
        const accountIds = task.items.map((item) => item.accountId);
        task.status = 'queued';
        task.queuedAt = new Date();
        await task.save();
        await addBulkAdJobsBatch(task._id.toString(), accountIds);
        logger_1.default.info(`[BulkAd] Task ${task._id} queued, ${accountIds.length} accounts`);
    }
    else {
        // Redis 不可用，直接同步执行
        logger_1.default.info(`[BulkAd] Redis unavailable, executing task synchronously`);
        executeTaskSynchronously(task._id.toString()).catch(err => {
            logger_1.default.error(`[BulkAd] Sync execution failed:`, err);
        });
    }
    return task;
};
exports.publishDraft = publishDraft;
/**
 * 同步执行任务（当 Redis 不可用时使用）
 */
const executeTaskSynchronously = async (taskId) => {
    const task = await AdTask_1.default.findById(taskId);
    if (!task) {
        throw new Error('Task not found');
    }
    task.status = 'processing';
    task.startedAt = new Date();
    await task.save();
    logger_1.default.info(`[BulkAd] Starting sync execution for task ${taskId}`);
    let successCount = 0;
    let failCount = 0;
    for (const item of task.items) {
        if (item.status === 'cancelled')
            continue;
        try {
            logger_1.default.info(`[BulkAd] Processing account: ${item.accountId}`);
            item.status = 'processing';
            await task.save();
            await (0, exports.executeTaskForAccount)(taskId, item.accountId);
            item.status = 'completed';
            successCount++;
            logger_1.default.info(`[BulkAd] Account ${item.accountId} completed`);
        }
        catch (error) {
            item.status = 'failed';
            item.error = error.message;
            failCount++;
            logger_1.default.error(`[BulkAd] Account ${item.accountId} failed:`, error);
        }
        // 更新进度
        const completedCount = task.items.filter((i) => i.status === 'completed' || i.status === 'failed').length;
        task.progress.percentage = Math.round((completedCount / task.items.length) * 100);
        await task.save();
    }
    // 任务完成
    task.status = failCount === 0 ? 'completed' : (successCount === 0 ? 'failed' : 'partial');
    task.completedAt = new Date();
    task.results = {
        totalAccounts: task.items.length,
        successCount,
        failCount,
        createdCampaigns: successCount,
        createdAdsets: successCount,
        createdAds: successCount,
    };
    await task.save();
    logger_1.default.info(`[BulkAd] Task ${taskId} completed: ${successCount} success, ${failCount} failed`);
};
// ==================== 任务执行 ====================
/**
 * 执行单个账户的广告创建任务
 */
// 原子更新任务项状态（避免并发冲突）
async function updateTaskItemAtomic(taskId, accountId, update) {
    return AdTask_1.default.findOneAndUpdate({ _id: taskId, 'items.accountId': accountId }, { $set: update }, { new: true });
}
// 原子更新任务进度
async function updateTaskProgressAtomic(taskId) {
    const task = await AdTask_1.default.findById(taskId);
    if (!task)
        return;
    const items = task.items || [];
    // 兼容 'success' 和 'completed' 状态（修复状态不一致问题）
    const successCount = items.filter((i) => i.status === 'success' || i.status === 'completed').length;
    const failedCount = items.filter((i) => i.status === 'failed').length;
    const totalAds = items.reduce((sum, i) => sum + (i.result?.createdCount || 0), 0);
    const percentage = items.length > 0 ? Math.round(((successCount + failedCount) / items.length) * 100) : 0;
    const allDone = successCount + failedCount === items.length;
    // 使用 'completed' 作为成功状态，与前端 STATUS_MAP 保持一致
    const status = allDone ? (failedCount === items.length ? 'failed' : successCount === items.length ? 'completed' : 'partial') : 'running';
    await AdTask_1.default.findByIdAndUpdate(taskId, {
        $set: {
            'progress.successAccounts': successCount,
            'progress.failedAccounts': failedCount,
            'progress.createdAds': totalAds,
            'progress.percentage': percentage,
            status,
            ...(allDone ? { completedAt: new Date() } : {}),
        }
    });
}
const executeTaskForAccount = async (taskId, accountId) => {
    const task = await AdTask_1.default.findById(taskId);
    if (!task) {
        throw new Error('Task not found');
    }
    const item = task.items.find((i) => i.accountId === accountId);
    if (!item) {
        throw new Error('Task item not found');
    }
    // 获取 Token
    const fbToken = await FbToken_1.default.findOne({ status: 'active' });
    if (!fbToken) {
        throw new Error('No active Facebook token found');
    }
    const token = fbToken.token;
    const config = task.configSnapshot;
    const accountConfig = config.accounts.find((a) => a.accountId === accountId);
    if (!accountConfig) {
        throw new Error('Account config not found');
    }
    // 验证必要配置
    if (!accountConfig.pageId) {
        throw new Error(`账户 ${accountConfig.accountName || accountId} 没有配置 Facebook 主页，无法创建广告`);
    }
    // 原子更新状态为处理中
    await updateTaskItemAtomic(taskId, accountId, {
        'items.$.status': 'processing',
        'items.$.startedAt': new Date(),
    });
    try {
        // ==================== 1. 创建 Campaign ====================
        const campaignName = generateName(config.campaign.nameTemplate, {
            accountName: accountConfig.accountName,
            date: new Date().toISOString().slice(0, 10),
        });
        const campaignResult = await (0, bulkCreate_api_1.createCampaign)({
            accountId,
            token,
            name: campaignName,
            objective: config.campaign.objective || 'OUTCOME_SALES',
            status: config.campaign.status || 'PAUSED',
            buyingType: config.campaign.buyingType,
            specialAdCategories: config.campaign.specialAdCategories,
            dailyBudget: config.campaign.budgetType === 'DAILY' ? config.campaign.budget : undefined,
            lifetimeBudget: config.campaign.budgetType === 'LIFETIME' ? config.campaign.budget : undefined,
            bidStrategy: config.campaign.bidStrategy,
            spendCap: config.campaign.spendCap,
        });
        if (!campaignResult.success) {
            throw new Error(`Campaign creation failed: ${campaignResult.error?.message}`);
        }
        const campaignId = campaignResult.id;
        // 原子更新 campaign 结果
        await updateTaskItemAtomic(taskId, accountId, {
            'items.$.result.campaignId': campaignId,
            'items.$.result.campaignName': campaignName,
        });
        // ==================== 2. 获取定向配置 ====================
        let targeting = {};
        if (config.adset.targetingPackageId) {
            const targetingPackage = await TargetingPackage_1.default.findById(config.adset.targetingPackageId);
            if (targetingPackage && targetingPackage.toFacebookTargeting) {
                targeting = targetingPackage.toFacebookTargeting();
            }
        }
        else if (config.adset.inlineTargeting) {
            targeting = config.adset.inlineTargeting;
        }
        // ==================== 3. 创建 AdSet ====================
        const adsetName = generateName(config.adset.nameTemplate, {
            accountName: accountConfig.accountName,
            campaignName,
            date: new Date().toISOString().slice(0, 10),
        });
        // 计算 AdSet 预算
        // CBO 模式: 预算在 Campaign 级别设置，AdSet 不设置预算
        // 非 CBO 模式: 每个 AdSet 必须单独设置预算
        let adsetBudget;
        if (config.campaign.budgetOptimization) {
            // CBO 模式，AdSet 不设置预算
            adsetBudget = undefined;
            logger_1.default.info(`[BulkAd] CBO enabled, campaign budget: ${config.campaign.budget}`);
        }
        else {
            // 非 CBO 模式，使用 AdSet 预算
            adsetBudget = config.adset.budget || config.campaign.budget;
            if (!adsetBudget) {
                throw new Error('非 CBO 模式下必须设置广告组预算');
            }
            logger_1.default.info(`[BulkAd] Non-CBO mode, adset budget: ${adsetBudget}`);
        }
        // DSA 受益方：使用 Pixel 名称（欧盟合规）
        const dsaBeneficiary = accountConfig.pixelName || accountConfig.pixelId || undefined;
        const adsetResult = await (0, bulkCreate_api_1.createAdSet)({
            accountId,
            token,
            campaignId,
            name: adsetName,
            status: config.adset.status || 'PAUSED',
            targeting,
            optimizationGoal: config.adset.optimizationGoal || 'OFFSITE_CONVERSIONS',
            billingEvent: config.adset.billingEvent || 'IMPRESSIONS',
            bidStrategy: config.adset.bidStrategy,
            bidAmount: config.adset.bidAmount,
            dailyBudget: adsetBudget,
            startTime: config.adset.startTime?.toISOString?.(),
            endTime: config.adset.endTime?.toISOString?.(),
            promotedObject: accountConfig.pixelId ? {
                pixel_id: accountConfig.pixelId,
                custom_event_type: accountConfig.conversionEvent || 'PURCHASE',
            } : undefined,
            dsa_beneficiary: dsaBeneficiary,
            dsa_payor: dsaBeneficiary,
        });
        if (!adsetResult.success) {
            throw new Error(`AdSet creation failed: ${adsetResult.error?.message}`);
        }
        const adsetId = adsetResult.id;
        // 原子更新 adset 结果
        await updateTaskItemAtomic(taskId, accountId, {
            'items.$.result.adsetIds': [adsetId],
        });
        // ==================== 4. 获取创意组和文案包 ====================
        const creativeGroups = await CreativeGroup_1.default.find({
            _id: { $in: config.ad.creativeGroupIds || [] },
        });
        const copywritingPackages = await CopywritingPackage_1.default.find({
            _id: { $in: config.ad.copywritingPackageIds || [] },
        });
        if (creativeGroups.length === 0) {
            throw new Error('No creative groups found');
        }
        if (copywritingPackages.length === 0) {
            throw new Error('No copywriting packages found');
        }
        // ==================== 5. 创建广告 ====================
        // 遍历每个创意组的每个素材，为每个素材创建一条广告
        const adIds = [];
        const adsDetails = [];
        let globalAdIndex = 0;
        for (let cgIndex = 0; cgIndex < creativeGroups.length; cgIndex++) {
            const creativeGroup = creativeGroups[cgIndex];
            const copywriting = copywritingPackages[cgIndex % copywritingPackages.length];
            // 获取所有有效素材
            const validMaterials = creativeGroup.materials?.filter((m) => m.status === 'uploaded' || m.url) || [];
            if (validMaterials.length === 0) {
                logger_1.default.warn(`[BulkAd] No material found in creative group: ${creativeGroup.name}`);
                continue;
            }
            logger_1.default.info(`[BulkAd] Processing creative group "${creativeGroup.name}" with ${validMaterials.length} materials`);
            // 为每个素材创建一条广告
            for (let matIndex = 0; matIndex < validMaterials.length; matIndex++) {
                const material = validMaterials[matIndex];
                globalAdIndex++;
                // 处理素材引用
                let materialRef = {};
                if (material.type === 'image') {
                    if (material.facebookImageHash) {
                        materialRef.image_hash = material.facebookImageHash;
                    }
                    else if (material.url) {
                        materialRef.image_url = material.url;
                        logger_1.default.info(`[BulkAd] Using image URL directly: ${material.url}`);
                    }
                }
                else if (material.type === 'video') {
                    if (material.facebookVideoId) {
                        materialRef.video_id = material.facebookVideoId;
                        if (material.thumbnailUrl) {
                            materialRef.thumbnail_url = material.thumbnailUrl;
                        }
                    }
                    else if (material.url) {
                        // 视频必须先上传到 Facebook
                        logger_1.default.info(`[BulkAd] Uploading video ${matIndex + 1}/${validMaterials.length}: ${material.name}`);
                        const uploadResult = await (0, bulkCreate_api_1.uploadVideoFromUrl)({
                            accountId,
                            token,
                            videoUrl: material.url,
                            title: material.name,
                        });
                        if (uploadResult.success) {
                            materialRef.video_id = uploadResult.id;
                            materialRef.thumbnail_url = uploadResult.thumbnailUrl || material.thumbnailUrl || material.url;
                        }
                        else {
                            logger_1.default.error(`[BulkAd] Video upload failed, skipping: ${uploadResult.error}`);
                            continue;
                        }
                    }
                }
                // 检查是否有有效素材
                if (!materialRef.image_hash && !materialRef.image_url && !materialRef.video_id) {
                    logger_1.default.warn(`[BulkAd] No valid material reference for material: ${material.name}, skipping`);
                    continue;
                }
                // 创建 Ad Creative
                const creativeName = `${adsetName}_creative_${globalAdIndex}`;
                const linkData = {
                    link: copywriting.links?.websiteUrl || '',
                    message: copywriting.content?.primaryTexts?.[0] || '',
                    name: copywriting.content?.headlines?.[0] || '',
                    description: copywriting.content?.descriptions?.[0] || '',
                    call_to_action: {
                        type: copywriting.callToAction || 'SHOP_NOW',
                        value: { link: copywriting.links?.websiteUrl || '' },
                    },
                };
                // 添加显示链接（caption）
                if (copywriting.links?.displayLink) {
                    linkData.caption = copywriting.links.displayLink;
                }
                const objectStorySpec = {
                    page_id: accountConfig.pageId,
                    link_data: linkData,
                };
                if (materialRef.image_hash) {
                    objectStorySpec.link_data.image_hash = materialRef.image_hash;
                }
                else if (materialRef.image_url) {
                    objectStorySpec.link_data.picture = materialRef.image_url;
                }
                else if (materialRef.video_id) {
                    // 视频广告：使用 video_data 替代 link_data
                    const link = objectStorySpec.link_data.link;
                    const message = objectStorySpec.link_data.message;
                    const title = objectStorySpec.link_data.name;
                    const description = objectStorySpec.link_data.description;
                    const caption = objectStorySpec.link_data.caption;
                    // 使用用户选择的 CTA，不做强制转换
                    const ctaType = copywriting.callToAction || 'SHOP_NOW';
                    delete objectStorySpec.link_data;
                    const videoData = {
                        video_id: materialRef.video_id,
                        image_url: materialRef.thumbnail_url,
                        message: message,
                        link_description: description || title,
                        call_to_action: {
                            type: ctaType,
                            value: { link: link },
                        },
                    };
                    // 添加显示链接
                    if (caption) {
                        videoData.caption = caption;
                    }
                    objectStorySpec.video_data = videoData;
                    logger_1.default.info(`[BulkAd] Video creative with thumbnail: ${materialRef.thumbnail_url}`);
                }
                if (accountConfig.instagramAccountId) {
                    objectStorySpec.instagram_actor_id = accountConfig.instagramAccountId;
                }
                const creativeResult = await (0, bulkCreate_api_1.createAdCreative)({
                    accountId,
                    token,
                    name: creativeName,
                    objectStorySpec,
                });
                if (!creativeResult.success) {
                    logger_1.default.error(`[BulkAd] Failed to create creative for material ${matIndex + 1}:`, creativeResult.error);
                    continue;
                }
                const creativeId = creativeResult.id;
                // 创建 Ad
                const adName = generateName(config.ad.nameTemplate, {
                    accountName: accountConfig.accountName,
                    campaignName,
                    adsetName,
                    creativeGroupName: creativeGroup.name,
                    materialName: material.name || `素材${matIndex + 1}`,
                    index: globalAdIndex,
                    date: new Date().toISOString().slice(0, 10),
                });
                const adResult = await (0, bulkCreate_api_1.createAd)({
                    accountId,
                    token,
                    adsetId,
                    creativeId,
                    name: adName,
                    status: config.ad.status || 'PAUSED',
                    urlTags: config.ad.tracking?.urlTags,
                });
                if (!adResult.success) {
                    logger_1.default.error(`[BulkAd] Failed to create ad for material ${matIndex + 1}:`, adResult.error);
                    continue;
                }
                adIds.push(adResult.id);
                // 记录广告详情（用于审核状态追踪）
                adsDetails.push({
                    adId: adResult.id,
                    adName,
                    adsetId,
                    creativeId,
                    materialId: material._id?.toString(),
                    effectiveStatus: 'PENDING_REVIEW', // 新创建的广告默认为审核中
                });
                logger_1.default.info(`[BulkAd] Created ad ${globalAdIndex}: ${adName}`);
            }
        }
        // ==================== 6. 完成任务 ====================
        // 如果没有创建任何广告，标记为失败
        const finalStatus = adIds.length > 0 ? 'success' : 'failed';
        const errorInfo = adIds.length === 0 ? [{
                entityType: 'ad',
                errorCode: 'NO_ADS_CREATED',
                errorMessage: '素材创建失败，未能创建任何广告',
                timestamp: new Date(),
            }] : undefined;
        // 原子更新状态
        const updateData = {
            'items.$.status': finalStatus,
            'items.$.result.adIds': adIds,
            'items.$.result.createdCount': adIds.length,
            'items.$.completedAt': new Date(),
            'items.$.ads': adsDetails, // 保存广告详情用于审核追踪
        };
        if (errorInfo) {
            updateData['items.$.errors'] = errorInfo;
        }
        await updateTaskItemAtomic(taskId, accountId, updateData);
        // 同步创建 Ad 记录到数据库（用于后续审核状态追踪）
        try {
            const Ad = require('../models/Ad').default;
            for (const adDetail of adsDetails) {
                await Ad.findOneAndUpdate({ adId: adDetail.adId }, {
                    $set: {
                        adId: adDetail.adId,
                        name: adDetail.adName,
                        adsetId: adDetail.adsetId,
                        adsetName,
                        campaignId,
                        campaignName,
                        accountId,
                        creativeId: adDetail.creativeId,
                        materialId: adDetail.materialId,
                        taskId,
                        effectiveStatus: 'PENDING_REVIEW',
                        status: config.ad.status || 'PAUSED',
                    },
                }, { upsert: true });
                // 【关键修复】建立 Ad-Material 映射（用于素材数据归因）
                if (adDetail.materialId) {
                    try {
                        await AdMaterialMapping_1.default.recordMapping({
                            adId: adDetail.adId,
                            materialId: adDetail.materialId,
                            accountId,
                            campaignId,
                            adsetId: adDetail.adsetId,
                            creativeId: adDetail.creativeId,
                            publishedBy: task.createdBy?.toString(),
                            taskId,
                        });
                        logger_1.default.info(`[BulkAd] Recorded ad-material mapping: ${adDetail.adId} -> ${adDetail.materialId}`);
                    }
                    catch (mappingErr) {
                        logger_1.default.warn(`[BulkAd] Failed to record ad-material mapping:`, mappingErr.message);
                    }
                }
            }
            logger_1.default.info(`[BulkAd] Saved ${adsDetails.length} ad records for review tracking`);
        }
        catch (adSaveErr) {
            logger_1.default.warn(`[BulkAd] Failed to save ad records:`, adSaveErr.message);
        }
        // 更新总体进度（原子操作）
        await updateTaskProgressAtomic(taskId);
        logger_1.default.info(`[BulkAd] Task ${finalStatus} for account ${accountId}: ${adIds.length} ads created`);
        return {
            success: true,
            campaignId,
            adsetIds: [adsetId],
            adIds,
        };
    }
    catch (error) {
        logger_1.default.error(`[BulkAd] Task failed for account ${accountId}:`, error);
        // 原子更新失败状态
        await updateTaskItemAtomic(taskId, accountId, {
            'items.$.status': 'failed',
            'items.$.completedAt': new Date(),
            'items.$.errors': [{
                    entityType: 'general',
                    errorCode: 'EXECUTION_ERROR',
                    errorMessage: error.message,
                    timestamp: new Date(),
                }],
        });
        // 更新总体进度（原子操作）
        await updateTaskProgressAtomic(taskId);
        throw error;
    }
};
exports.executeTaskForAccount = executeTaskForAccount;
// 更新任务总体进度
function updateTaskProgress(task) {
    const items = task.items || [];
    // 兼容 'success' 和 'completed' 状态
    const completed = items.filter((i) => ['success', 'completed', 'failed', 'skipped'].includes(i.status));
    const successful = items.filter((i) => i.status === 'success' || i.status === 'completed');
    const failed = items.filter((i) => i.status === 'failed');
    let totalAdsCreated = 0;
    for (const item of items) {
        if (item.result?.adIds) {
            totalAdsCreated += item.result.adIds.length;
        }
    }
    task.progress = {
        ...task.progress,
        completedAccounts: completed.length,
        successAccounts: successful.length,
        failedAccounts: failed.length,
        createdAds: totalAdsCreated,
        percentage: items.length > 0 ? Math.round((completed.length / items.length) * 100) : 0,
    };
    if (completed.length === items.length) {
        if (failed.length === 0) {
            task.status = 'success';
        }
        else if (successful.length > 0) {
            task.status = 'partial_success';
        }
        else {
            task.status = 'failed';
        }
        task.completedAt = new Date();
    }
}
// ==================== 任务管理 ====================
/**
 * 获取任务详情
 */
const getTask = async (taskId) => {
    const task = await AdTask_1.default.findById(taskId).populate('draftId');
    if (!task) {
        throw new Error('Task not found');
    }
    return task;
};
exports.getTask = getTask;
/**
 * 获取任务列表
 */
const getTaskList = async (query = {}) => {
    const { status, taskType, platform, createdBy, page = 1, pageSize = 20 } = query;
    const filter = {};
    if (status)
        filter.status = status;
    if (taskType)
        filter.taskType = taskType;
    if (platform)
        filter.platform = platform;
    if (createdBy)
        filter.createdBy = createdBy;
    const [list, total] = await Promise.all([
        AdTask_1.default.find(filter)
            .sort({ createdAt: -1 })
            .skip((page - 1) * pageSize)
            .limit(pageSize)
            .lean(),
        AdTask_1.default.countDocuments(filter),
    ]);
    return { list, total, page, pageSize };
};
exports.getTaskList = getTaskList;
/**
 * 取消任务
 */
const cancelTask = async (taskId) => {
    const task = await AdTask_1.default.findById(taskId);
    if (!task) {
        throw new Error('Task not found');
    }
    if (['success', 'partial_success', 'failed', 'cancelled'].includes(task.status)) {
        throw new Error('Cannot cancel completed task');
    }
    task.status = 'cancelled';
    task.completedAt = new Date();
    await task.save();
    logger_1.default.info(`[BulkAd] Task cancelled: ${taskId}`);
    return task;
};
exports.cancelTask = cancelTask;
/**
 * 重试失败的任务项
 */
const retryFailedItems = async (taskId) => {
    const task = await AdTask_1.default.findById(taskId);
    if (!task) {
        throw new Error('Task not found');
    }
    const failedItems = task.items.filter((i) => i.status === 'failed');
    if (failedItems.length === 0) {
        throw new Error('No failed items to retry');
    }
    // 重置失败项状态
    for (const item of failedItems) {
        item.status = 'pending';
        item.errors = [];
        item.startedAt = undefined;
        item.completedAt = undefined;
    }
    task.status = 'pending';
    task.retryInfo = {
        retryCount: (task.retryInfo?.retryCount || 0) + 1,
        lastRetryAt: new Date(),
    };
    await task.save();
    logger_1.default.info(`[BulkAd] Task retry initiated: ${taskId}`);
    return task;
};
exports.retryFailedItems = retryFailedItems;
/**
 * 重新执行任务（基于原任务配置创建新任务）
 */
const rerunTask = async (taskId) => {
    const originalTask = await AdTask_1.default.findById(taskId);
    if (!originalTask) {
        throw new Error('Task not found');
    }
    if (!originalTask.configSnapshot || !originalTask.configSnapshot.accounts) {
        throw new Error('Task config snapshot not found');
    }
    const config = originalTask.configSnapshot;
    // 创建新任务
    const newTask = new AdTask_1.default({
        taskType: originalTask.taskType,
        status: 'pending',
        platform: originalTask.platform,
        draftId: originalTask.draftId,
        configSnapshot: config,
        publishSettings: originalTask.publishSettings,
        notes: `重新执行自任务 ${taskId}`,
        items: config.accounts.map((acc) => ({
            accountId: acc.accountId,
            accountName: acc.accountName || acc.accountId,
            status: 'pending',
            progress: { current: 0, total: 0, percentage: 0 },
        })),
        progress: {
            totalAccounts: config.accounts.length,
            completedAccounts: 0,
            successAccounts: 0,
            failedAccounts: 0,
            percentage: 0,
        },
    });
    await newTask.save();
    logger_1.default.info(`[BulkAd] Task rerun created: ${newTask._id} (from ${taskId})`);
    // 检查 Redis 是否可用
    const { getRedisClient } = await Promise.resolve().then(() => __importStar(require('../config/redis')));
    const redisAvailable = (() => {
        try {
            return getRedisClient() !== null;
        }
        catch {
            return false;
        }
    })();
    if (redisAvailable) {
        // Redis 可用，使用队列异步执行
        logger_1.default.info(`[BulkAd] Redis available, adding task to queue`);
        const { addBulkAdJobsBatch } = await Promise.resolve().then(() => __importStar(require('../queue/bulkAd.queue')));
        const accountIds = config.accounts.map((acc) => acc.accountId);
        newTask.status = 'queued';
        newTask.queuedAt = new Date();
        await newTask.save();
        await addBulkAdJobsBatch(newTask._id.toString(), accountIds);
        logger_1.default.info(`[BulkAd] Task ${newTask._id} queued, ${accountIds.length} accounts`);
    }
    else {
        // Redis 不可用，直接同步执行
        logger_1.default.info(`[BulkAd] Redis unavailable, executing task synchronously`);
        newTask.status = 'processing';
        newTask.startedAt = new Date();
        await newTask.save();
        for (const acc of config.accounts) {
            try {
                await (0, exports.executeTaskForAccount)(newTask._id.toString(), acc.accountId);
            }
            catch (err) {
                logger_1.default.error(`[BulkAd] Failed for account ${acc.accountId}:`, err.message);
            }
        }
    }
    return newTask;
};
exports.rerunTask = rerunTask;
// ==================== 辅助函数 ====================
/**
 * 生成名称（支持模板变量）
 */
function generateName(template, variables) {
    let name = template || '';
    for (const [key, value] of Object.entries(variables)) {
        name = name.replace(new RegExp(`\\{${key}\\}`, 'gi'), String(value || ''));
    }
    name = name.replace(/_{2,}/g, '_').replace(/^_|_$/g, '');
    return name;
}
exports.default = {
    createDraft: exports.createDraft,
    updateDraft: exports.updateDraft,
    getDraft: exports.getDraft,
    getDraftList: exports.getDraftList,
    deleteDraft: exports.deleteDraft,
    validateDraft: exports.validateDraft,
    publishDraft: exports.publishDraft,
    executeTaskForAccount: exports.executeTaskForAccount,
    getTask: exports.getTask,
    getTaskList: exports.getTaskList,
    cancelTask: exports.cancelTask,
    retryFailedItems: exports.retryFailedItems,
    rerunTask: exports.rerunTask,
};
