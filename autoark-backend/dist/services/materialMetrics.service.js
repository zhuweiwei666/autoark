"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDecliningMaterials = exports.getRecommendedMaterials = exports.getMaterialUsage = exports.findDuplicateMaterials = exports.getMaterialTrend = exports.getMaterialRankings = exports.aggregateMaterialMetrics = void 0;
const dayjs_1 = __importDefault(require("dayjs"));
const logger_1 = __importDefault(require("../utils/logger"));
const Ad_1 = __importDefault(require("../models/Ad"));
const MetricsDaily_1 = __importDefault(require("../models/MetricsDaily"));
const MaterialMetrics_1 = __importDefault(require("../models/MaterialMetrics"));
const Material_1 = __importDefault(require("../models/Material"));
const Creative_1 = __importDefault(require("../models/Creative"));
const materialSync_service_1 = require("./materialSync.service");
/**
 * 素材指标聚合服务
 * 将广告级别的数据聚合到素材级别
 */
// 从广告数据中提取素材信息
// 优先使用 Ad 模型中存储的字段（同步时已提取），其次从 raw 数据中提取
const extractCreativeInfo = (ad) => {
    // 优先使用 Ad 模型中直接存储的字段
    let creativeId = ad.creativeId;
    let imageHash = ad.imageHash;
    let videoId = ad.videoId;
    let thumbnailUrl = ad.thumbnailUrl;
    // 如果没有，尝试从 raw 数据中提取
    if (!imageHash && !videoId) {
        const raw = ad.raw || {};
        const creative = raw.creative || {};
        if (!creativeId)
            creativeId = creative.id;
        imageHash = creative.image_hash;
        videoId = creative.video_id;
        thumbnailUrl = thumbnailUrl || creative.thumbnail_url || creative.image_url;
        // 从 object_story_spec 提取
        if (!imageHash && !videoId && creative.object_story_spec) {
            const spec = creative.object_story_spec;
            imageHash = spec.link_data?.image_hash || spec.photo_data?.image_hash;
            videoId = spec.video_data?.video_id || spec.link_data?.video_id;
        }
    }
    return { creativeId, imageHash, videoId, thumbnailUrl };
};
// 从 action_values 提取购买值
const extractPurchaseValue = (actionValues) => {
    if (!actionValues)
        return 0;
    for (const av of actionValues) {
        if (av.action_type === 'purchase' || av.action_type === 'omni_purchase') {
            return parseFloat(av.value) || 0;
        }
    }
    return 0;
};
// 从 actions 提取特定 action 的数量
const getActionCount = (actions, actionType) => {
    if (!actions)
        return 0;
    const action = actions.find((a) => a.action_type === actionType);
    return action ? parseInt(action.value, 10) : 0;
};
// 从广告系列名称提取投手
const extractOptimizer = (campaignName) => {
    if (!campaignName)
        return 'unknown';
    const parts = campaignName.split('_');
    return parts[0] || 'unknown';
};
/**
 * 聚合指定日期的素材级别指标
 *
 * 🎯 精准归因逻辑：
 * 1. 优先使用 Ad.materialId（直接关联，100% 可靠）
 * 2. 回退到 imageHash/videoId 反查（兼容旧数据）
 */
const aggregateMaterialMetrics = async (date) => {
    logger_1.default.info(`[MaterialMetrics] Aggregating material metrics for ${date}`);
    const stats = { processed: 0, created: 0, updated: 0, errors: 0, directMatch: 0, fallbackMatch: 0 };
    try {
        // 1. 获取所有广告及其素材信息
        const ads = await Ad_1.default.find({}).lean();
        logger_1.default.info(`[MaterialMetrics] Found ${ads.length} ads to process`);
        // 1.1 获取所有 Creative 信息（包含本地存储 URL 和指纹）
        const creatives = await Creative_1.default.find({}).lean();
        const creativeInfoMap = new Map();
        for (const creative of creatives) {
            creativeInfoMap.set(creative.creativeId, {
                localStorageUrl: creative.localStorageUrl,
                originalUrl: creative.imageUrl || creative.thumbnailUrl,
                fingerprint: creative.fingerprint?.pHash,
                name: creative.name,
                downloaded: creative.downloaded,
                materialId: creative.materialId, // Creative 也可能关联到 Material
            });
        }
        logger_1.default.info(`[MaterialMetrics] Loaded ${creativeInfoMap.size} creatives with details`);
        // 1.2 获取所有 Material（用于 hash 反查）
        const materials = await Material_1.default.find({ status: 'uploaded' }).lean();
        const materialByHash = new Map();
        const materialByVideoId = new Map();
        for (const m of materials) {
            const mat = m;
            // 通过 Facebook 映射查找
            if (mat.facebook?.imageHash)
                materialByHash.set(mat.facebook.imageHash, mat);
            if (mat.facebook?.videoId)
                materialByVideoId.set(mat.facebook.videoId, mat);
            // 通过 facebookMappings 查找
            for (const mapping of (mat.facebookMappings || [])) {
                if (mapping.imageHash)
                    materialByHash.set(mapping.imageHash, mat);
                if (mapping.videoId)
                    materialByVideoId.set(mapping.videoId, mat);
            }
        }
        logger_1.default.info(`[MaterialMetrics] Built material lookup: ${materialByHash.size} by hash, ${materialByVideoId.size} by videoId`);
        // 2. 构建 adId -> 素材信息 的映射
        // 🎯 关键：优先使用 Ad.materialId（直接归因）
        const adCreativeMap = new Map();
        for (const ad of ads) {
            const creativeInfo = extractCreativeInfo(ad);
            const creativeDetail = creativeInfo.creativeId ? creativeInfoMap.get(creativeInfo.creativeId) : null;
            // 🎯 优先使用 Ad.materialId（直接归因）
            let materialId = ad.materialId?.toString();
            let matchType = 'none';
            if (materialId) {
                matchType = 'direct';
            }
            else if (creativeDetail?.materialId) {
                // 其次使用 Creative.materialId
                materialId = creativeDetail.materialId.toString();
                matchType = 'direct';
            }
            else {
                // 回退：通过 hash 反查
                const imageHash = creativeInfo.imageHash;
                const videoId = creativeInfo.videoId;
                if (imageHash && materialByHash.has(imageHash)) {
                    materialId = materialByHash.get(imageHash)._id.toString();
                    matchType = 'fallback';
                }
                else if (videoId && materialByVideoId.has(videoId)) {
                    materialId = materialByVideoId.get(videoId)._id.toString();
                    matchType = 'fallback';
                }
            }
            // 只要有素材信息就记录
            if (creativeInfo.creativeId || materialId) {
                adCreativeMap.set(ad.adId, {
                    materialId,
                    ...creativeInfo,
                    localStorageUrl: creativeDetail?.localStorageUrl,
                    originalUrl: creativeDetail?.originalUrl || creativeInfo.thumbnailUrl,
                    fingerprint: creativeDetail?.fingerprint,
                    creativeName: creativeDetail?.name,
                    matchType,
                });
            }
        }
        const directCount = Array.from(adCreativeMap.values()).filter(v => v.matchType === 'direct').length;
        const fallbackCount = Array.from(adCreativeMap.values()).filter(v => v.matchType === 'fallback').length;
        logger_1.default.info(`[MaterialMetrics] Ad-Material mapping: ${directCount} direct, ${fallbackCount} fallback, ${adCreativeMap.size - directCount - fallbackCount} none`);
        // 3. 获取当天的 ad 级别指标
        const adMetrics = await MetricsDaily_1.default.find({
            date,
            adId: { $exists: true, $ne: null },
            spendUsd: { $gt: 0 }
        }).lean();
        logger_1.default.info(`[MaterialMetrics] Found ${adMetrics.length} ad metrics for ${date}`);
        // 4. 按素材聚合指标
        // 🎯 优先使用 materialId 作为 key（精准归因）
        // 回退使用 creativeId（兼容）
        const materialAggregation = new Map();
        for (const metric of adMetrics) {
            const creativeInfo = adCreativeMap.get(metric.adId);
            if (!creativeInfo)
                continue;
            // 🎯 优先使用 materialId（精准归因），其次 creativeId（兼容）
            const materialKey = creativeInfo.materialId || creativeInfo.creativeId;
            if (!materialKey)
                continue;
            stats.processed++;
            // 统计匹配类型
            if (creativeInfo.matchType === 'direct')
                stats.directMatch++;
            else if (creativeInfo.matchType === 'fallback')
                stats.fallbackMatch++;
            // 提取 actions 数据
            const rawActions = metric.raw?.actions || [];
            const rawActionValues = metric.raw?.action_values || [];
            if (!materialAggregation.has(materialKey)) {
                materialAggregation.set(materialKey, {
                    date,
                    // 🎯 精准归因：记录 materialId
                    materialId: creativeInfo.materialId,
                    creativeId: creativeInfo.creativeId,
                    imageHash: creativeInfo.imageHash,
                    videoId: creativeInfo.videoId,
                    thumbnailUrl: creativeInfo.thumbnailUrl,
                    materialType: creativeInfo.videoId ? 'video' : 'image',
                    // 素材展示信息
                    localStorageUrl: creativeInfo.localStorageUrl,
                    originalUrl: creativeInfo.originalUrl,
                    fingerprint: creativeInfo.fingerprint,
                    creativeName: creativeInfo.creativeName,
                    // 归因类型（用于诊断）
                    matchType: creativeInfo.matchType,
                    accountIds: new Set(),
                    campaignIds: new Set(),
                    adsetIds: new Set(),
                    adIds: new Set(),
                    optimizers: new Set(),
                    spend: 0,
                    impressions: 0,
                    clicks: 0,
                    conversions: 0,
                    installs: 0,
                    purchases: 0,
                    purchaseValue: 0,
                    leads: 0,
                    videoViews: 0,
                    postEngagement: 0,
                });
            }
            const agg = materialAggregation.get(materialKey);
            // 聚合维度
            if (metric.accountId)
                agg.accountIds.add(metric.accountId);
            if (metric.campaignId)
                agg.campaignIds.add(metric.campaignId);
            if (metric.adsetId)
                agg.adsetIds.add(metric.adsetId);
            if (metric.adId)
                agg.adIds.add(metric.adId);
            // 从 raw 数据获取 campaign name，或者从 campaignId 推断投手
            const campaignName = metric.campaignName || metric.raw?.campaign_name || '';
            if (campaignName)
                agg.optimizers.add(extractOptimizer(campaignName));
            // 聚合指标
            agg.spend += metric.spendUsd || 0;
            agg.impressions += metric.impressions || 0;
            agg.clicks += metric.clicks || 0;
            agg.conversions += metric.conversions || 0;
            // 从 raw 数据提取详细指标
            agg.installs += getActionCount(rawActions, 'mobile_app_install');
            agg.purchases += getActionCount(rawActions, 'purchase') || getActionCount(rawActions, 'omni_purchase');
            agg.leads += getActionCount(rawActions, 'lead');
            agg.videoViews += getActionCount(rawActions, 'video_view');
            agg.postEngagement += getActionCount(rawActions, 'post_engagement');
            // 购买价值
            const purchaseVal = metric.purchase_value || extractPurchaseValue(rawActionValues);
            agg.purchaseValue += purchaseVal;
        }
        logger_1.default.info(`[MaterialMetrics] Aggregated ${materialAggregation.size} unique materials (direct: ${stats.directMatch}, fallback: ${stats.fallbackMatch})`);
        // 5. 保存到数据库
        for (const [materialKey, agg] of materialAggregation) {
            try {
                // 🎯 优先使用聚合时已确定的 materialId（精准归因）
                let materialId = agg.materialId;
                let materialName = agg.creativeName;
                // 如果没有 materialId，尝试反查（兼容旧数据）
                if (!materialId) {
                    let materialDoc = null;
                    if (agg.imageHash) {
                        materialDoc = await Material_1.default.findOne({
                            $or: [
                                { 'facebook.imageHash': agg.imageHash },
                                { 'facebookMappings.imageHash': agg.imageHash },
                            ]
                        }).lean();
                    }
                    else if (agg.videoId) {
                        materialDoc = await Material_1.default.findOne({
                            $or: [
                                { 'facebook.videoId': agg.videoId },
                                { 'facebookMappings.videoId': agg.videoId },
                            ]
                        }).lean();
                    }
                    if (materialDoc) {
                        materialId = materialDoc._id.toString();
                        materialName = materialName || materialDoc.name;
                    }
                }
                // 计算派生指标
                const ctr = agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0;
                const cpc = agg.clicks > 0 ? agg.spend / agg.clicks : 0;
                const cpm = agg.impressions > 0 ? (agg.spend / agg.impressions) * 1000 : 0;
                const cpi = agg.installs > 0 ? agg.spend / agg.installs : 0;
                const roas = agg.spend > 0 ? agg.purchaseValue / agg.spend : 0;
                // 计算质量评分
                let qualityScore = 50;
                if (roas >= 3)
                    qualityScore += 30;
                else if (roas >= 2)
                    qualityScore += 25;
                else if (roas >= 1.5)
                    qualityScore += 20;
                else if (roas >= 1)
                    qualityScore += 10;
                else if (roas < 0.5)
                    qualityScore -= 10;
                if (ctr >= 2)
                    qualityScore += 10;
                else if (ctr >= 1)
                    qualityScore += 5;
                else if (ctr < 0.5)
                    qualityScore -= 5;
                qualityScore = Math.max(0, Math.min(100, qualityScore));
                // 构建查询条件
                const filter = { date };
                // 🎯 优先使用 materialId 作为唯一标识（精准归因）
                if (materialId) {
                    filter.materialId = materialId;
                }
                else if (agg.creativeId) {
                    filter.creativeId = agg.creativeId;
                }
                else if (agg.imageHash) {
                    filter.imageHash = agg.imageHash;
                }
                else if (agg.videoId) {
                    filter.videoId = agg.videoId;
                }
                const result = await MaterialMetrics_1.default.findOneAndUpdate(filter, {
                    date,
                    materialId, // 🎯 精准归因
                    creativeId: agg.creativeId,
                    imageHash: agg.imageHash,
                    videoId: agg.videoId,
                    thumbnailUrl: agg.thumbnailUrl,
                    materialType: agg.materialType,
                    materialName,
                    // 素材展示信息
                    localStorageUrl: agg.localStorageUrl,
                    originalUrl: agg.originalUrl,
                    fingerprint: agg.fingerprint,
                    matchType: agg.matchType, // 记录归因类型
                    accountIds: Array.from(agg.accountIds),
                    campaignIds: Array.from(agg.campaignIds),
                    adsetIds: Array.from(agg.adsetIds),
                    adIds: Array.from(agg.adIds),
                    optimizers: Array.from(agg.optimizers),
                    spend: agg.spend,
                    impressions: agg.impressions,
                    clicks: agg.clicks,
                    conversions: agg.conversions,
                    installs: agg.installs,
                    purchases: agg.purchases,
                    purchaseValue: agg.purchaseValue,
                    leads: agg.leads,
                    videoViews: agg.videoViews,
                    postEngagement: agg.postEngagement,
                    ctr,
                    cpc,
                    cpm,
                    cpi,
                    roas,
                    qualityScore,
                    activeAdsCount: agg.adIds.size,
                    totalAdsCount: agg.adIds.size,
                }, { upsert: true, new: true });
                if (result.createdAt === result.updatedAt) {
                    stats.created++;
                }
                else {
                    stats.updated++;
                }
            }
            catch (err) {
                logger_1.default.error(`[MaterialMetrics] Error saving material ${materialKey}:`, err);
                stats.errors++;
            }
        }
        logger_1.default.info(`[MaterialMetrics] Aggregation complete: ${JSON.stringify(stats)}`);
        return stats;
    }
    catch (error) {
        logger_1.default.error('[MaterialMetrics] Aggregation failed:', error);
        throw error;
    }
};
exports.aggregateMaterialMetrics = aggregateMaterialMetrics;
/**
 * 获取素材排行榜
 */
const getMaterialRankings = async (options) => {
    const { dateRange, sortBy = 'roas', limit = 20, materialType } = options;
    const match = {
        date: { $gte: dateRange.start, $lte: dateRange.end },
        spend: { $gt: 5 }
    };
    if (materialType)
        match.materialType = materialType;
    const results = await MaterialMetrics_1.default.aggregate([
        { $match: match },
        {
            $group: {
                _id: { $ifNull: ['$creativeId', { $ifNull: ['$imageHash', '$videoId'] }] },
                creativeId: { $first: '$creativeId' },
                materialId: { $first: '$materialId' },
                materialType: { $first: '$materialType' },
                materialName: { $first: '$materialName' },
                thumbnailUrl: { $first: '$thumbnailUrl' },
                imageHash: { $first: '$imageHash' },
                videoId: { $first: '$videoId' },
                totalSpend: { $sum: '$spend' },
                totalImpressions: { $sum: '$impressions' },
                totalClicks: { $sum: '$clicks' },
                totalPurchaseValue: { $sum: '$purchaseValue' },
                totalInstalls: { $sum: '$installs' },
                totalPurchases: { $sum: '$purchases' },
                avgQualityScore: { $avg: '$qualityScore' },
                daysActive: { $sum: 1 },
                allAdIds: { $push: '$adIds' },
                allCampaignIds: { $push: '$campaignIds' },
                allOptimizers: { $push: '$optimizers' },
            }
        },
        {
            $addFields: {
                roas: { $cond: [{ $gt: ['$totalSpend', 0] }, { $divide: ['$totalPurchaseValue', '$totalSpend'] }, 0] },
                ctr: { $cond: [{ $gt: ['$totalImpressions', 0] }, { $multiply: [{ $divide: ['$totalClicks', '$totalImpressions'] }, 100] }, 0] },
                cpi: { $cond: [{ $gt: ['$totalInstalls', 0] }, { $divide: ['$totalSpend', '$totalInstalls'] }, 0] },
            }
        },
        { $sort: { [sortBy === 'qualityScore' ? 'avgQualityScore' : sortBy === 'spend' ? 'totalSpend' : sortBy]: -1 } },
        { $limit: limit },
        {
            $project: {
                materialKey: '$_id',
                creativeId: 1,
                materialId: 1,
                materialType: 1,
                materialName: 1,
                thumbnailUrl: 1,
                imageHash: 1,
                videoId: 1,
                spend: { $round: ['$totalSpend', 2] },
                impressions: '$totalImpressions',
                clicks: '$totalClicks',
                purchaseValue: { $round: ['$totalPurchaseValue', 2] },
                installs: '$totalInstalls',
                purchases: '$totalPurchases',
                roas: { $round: ['$roas', 2] },
                ctr: { $round: ['$ctr', 2] },
                cpi: { $round: ['$cpi', 2] },
                qualityScore: { $round: ['$avgQualityScore', 0] },
                daysActive: 1,
                uniqueAdsCount: {
                    $size: {
                        $reduce: {
                            input: '$allAdIds',
                            initialValue: [],
                            in: { $setUnion: ['$$value', '$$this'] }
                        }
                    }
                },
                uniqueCampaignsCount: {
                    $size: {
                        $reduce: {
                            input: '$allCampaignIds',
                            initialValue: [],
                            in: { $setUnion: ['$$value', '$$this'] }
                        }
                    }
                },
                optimizers: {
                    $reduce: {
                        input: '$allOptimizers',
                        initialValue: [],
                        in: { $setUnion: ['$$value', '$$this'] }
                    }
                },
            }
        }
    ]);
    // 后处理：为每个结果生成指纹并查找本地素材
    const enrichedResults = await Promise.all(results.map(async (item) => {
        // 生成指纹
        const fingerprint = (0, materialSync_service_1.generateFingerprint)({
            imageHash: item.imageHash,
            videoId: item.videoId,
            creativeId: item.creativeId,
        });
        // 查找本地素材（通过 fingerprintKey 或 Facebook 映射）
        let localMaterial = null;
        if (fingerprint) {
            localMaterial = await Material_1.default.findOne({ fingerprintKey: fingerprint }).lean();
        }
        // 如果没找到，尝试通过 Facebook 映射查找
        if (!localMaterial && (item.imageHash || item.videoId)) {
            localMaterial = await Material_1.default.findOne({
                $or: [
                    { 'facebook.imageHash': item.imageHash },
                    { 'facebook.videoId': item.videoId },
                    { 'facebookMappings.imageHash': item.imageHash },
                    { 'facebookMappings.videoId': item.videoId },
                ].filter(q => Object.values(q)[0])
            }).lean();
        }
        return {
            ...item,
            fingerprint,
            // 优先使用本地素材的信息
            materialName: localMaterial?.name || item.materialName || `素材_${fingerprint?.substring(0, 12) || 'unknown'}`,
            thumbnailUrl: localMaterial?.storage?.url || item.thumbnailUrl,
            localMaterialId: localMaterial?._id?.toString(),
            hasLocalMaterial: !!localMaterial,
        };
    }));
    return enrichedResults;
};
exports.getMaterialRankings = getMaterialRankings;
/**
 * 获取素材历史趋势
 */
const getMaterialTrend = async (materialKey, days = 7) => {
    const endDate = (0, dayjs_1.default)().format('YYYY-MM-DD');
    const startDate = (0, dayjs_1.default)().subtract(days, 'day').format('YYYY-MM-DD');
    const match = {
        date: { $gte: startDate, $lte: endDate }
    };
    if (materialKey.imageHash)
        match.imageHash = materialKey.imageHash;
    if (materialKey.videoId)
        match.videoId = materialKey.videoId;
    return MaterialMetrics_1.default.find(match)
        .sort({ date: 1 })
        .select('date spend impressions clicks purchaseValue installs roas ctr qualityScore')
        .lean();
};
exports.getMaterialTrend = getMaterialTrend;
// ==================== 素材去重 ====================
/**
 * 识别重复素材
 * 基于 imageHash 或 thumbnailUrl 识别使用相同素材的创意
 */
const findDuplicateMaterials = async () => {
    const Creative = require('../models/Creative').default;
    // 按 imageHash 分组找重复
    const duplicatesByHash = await Creative.aggregate([
        {
            $match: {
                imageHash: { $exists: true, $ne: null }
            }
        },
        {
            $group: {
                _id: '$imageHash',
                count: { $sum: 1 },
                creativeIds: { $push: '$creativeId' },
                accounts: { $addToSet: '$accountId' },
                thumbnails: { $addToSet: '$thumbnailUrl' },
            }
        },
        { $match: { count: { $gt: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 50 }
    ]);
    // 按 videoId 分组找重复
    const duplicatesByVideo = await Creative.aggregate([
        {
            $match: {
                videoId: { $exists: true, $ne: null }
            }
        },
        {
            $group: {
                _id: '$videoId',
                count: { $sum: 1 },
                creativeIds: { $push: '$creativeId' },
                accounts: { $addToSet: '$accountId' },
                thumbnails: { $addToSet: '$thumbnailUrl' },
            }
        },
        { $match: { count: { $gt: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 50 }
    ]);
    return {
        byImageHash: duplicatesByHash.map((d) => ({
            imageHash: d._id,
            usageCount: d.count,
            creativeIds: d.creativeIds,
            accountsCount: d.accounts.length,
            thumbnail: d.thumbnails[0],
        })),
        byVideoId: duplicatesByVideo.map((d) => ({
            videoId: d._id,
            usageCount: d.count,
            creativeIds: d.creativeIds,
            accountsCount: d.accounts.length,
            thumbnail: d.thumbnails[0],
        })),
    };
};
exports.findDuplicateMaterials = findDuplicateMaterials;
/**
 * 获取某个素材的所有使用情况
 */
const getMaterialUsage = async (params) => {
    const Creative = require('../models/Creative').default;
    const Ad = require('../models/Ad').default;
    const match = {};
    if (params.imageHash)
        match.imageHash = params.imageHash;
    if (params.videoId)
        match.videoId = params.videoId;
    if (params.creativeId)
        match.creativeId = params.creativeId;
    // 找到所有使用该素材的 Creative
    const creatives = await Creative.find(match).lean();
    const creativeIds = creatives.map((c) => c.creativeId);
    // 找到所有使用这些 Creative 的 Ad
    const ads = await Ad.find({ creativeId: { $in: creativeIds } })
        .select('adId name status campaignId adsetId accountId')
        .lean();
    // 获取这些广告的历史表现
    const adIds = ads.map((a) => a.adId);
    const metrics = await MaterialMetrics_1.default.aggregate([
        {
            $match: {
                adIds: { $elemMatch: { $in: adIds } }
            }
        },
        {
            $group: {
                _id: null,
                totalSpend: { $sum: '$spend' },
                totalRevenue: { $sum: '$purchaseValue' },
                totalImpressions: { $sum: '$impressions' },
                totalClicks: { $sum: '$clicks' },
                daysActive: { $sum: 1 },
            }
        }
    ]);
    const performance = metrics[0] || { totalSpend: 0, totalRevenue: 0, totalImpressions: 0, totalClicks: 0, daysActive: 0 };
    return {
        material: {
            imageHash: params.imageHash,
            videoId: params.videoId,
            thumbnail: creatives[0]?.thumbnailUrl,
            type: creatives[0]?.type,
        },
        usage: {
            creativeCount: creatives.length,
            adCount: ads.length,
            accountCount: new Set(ads.map((a) => a.accountId)).size,
            campaignCount: new Set(ads.map((a) => a.campaignId)).size,
        },
        performance: {
            spend: Math.round(performance.totalSpend * 100) / 100,
            revenue: Math.round(performance.totalRevenue * 100) / 100,
            roas: performance.totalSpend > 0 ? Math.round((performance.totalRevenue / performance.totalSpend) * 100) / 100 : 0,
            impressions: performance.totalImpressions,
            clicks: performance.totalClicks,
            daysActive: performance.daysActive,
        },
        ads: ads.slice(0, 20), // 限制返回数量
    };
};
exports.getMaterialUsage = getMaterialUsage;
// ==================== 素材推荐 ====================
/**
 * 获取推荐素材
 * 基于历史表现数据，推荐高质量素材用于新广告
 */
const getRecommendedMaterials = async (options = {}) => {
    const { type, minSpend = 50, minRoas = 1.0, minDays = 3, excludeCreativeIds = [], limit = 20 } = options;
    const sevenDaysAgo = (0, dayjs_1.default)().subtract(7, 'day').format('YYYY-MM-DD');
    const today = (0, dayjs_1.default)().format('YYYY-MM-DD');
    const matchStage = {
        date: { $gte: sevenDaysAgo, $lte: today },
        spend: { $gt: 0 }
    };
    if (type)
        matchStage.materialType = type;
    const recommendations = await MaterialMetrics_1.default.aggregate([
        { $match: matchStage },
        {
            $group: {
                _id: '$creativeId',
                imageHash: { $first: '$imageHash' },
                videoId: { $first: '$videoId' },
                thumbnailUrl: { $first: '$thumbnailUrl' },
                materialType: { $first: '$materialType' },
                totalSpend: { $sum: '$spend' },
                totalRevenue: { $sum: '$purchaseValue' },
                totalImpressions: { $sum: '$impressions' },
                totalClicks: { $sum: '$clicks' },
                totalInstalls: { $sum: '$installs' },
                avgQualityScore: { $avg: '$qualityScore' },
                daysActive: { $sum: 1 },
                optimizers: { $push: '$optimizers' },
                campaigns: { $push: '$campaignIds' },
            }
        },
        {
            $addFields: {
                roas: { $cond: [{ $gt: ['$totalSpend', 0] }, { $divide: ['$totalRevenue', '$totalSpend'] }, 0] },
                ctr: { $cond: [{ $gt: ['$totalImpressions', 0] }, { $multiply: [{ $divide: ['$totalClicks', '$totalImpressions'] }, 100] }, 0] },
            }
        },
        {
            $match: {
                totalSpend: { $gte: minSpend },
                roas: { $gte: minRoas },
                daysActive: { $gte: minDays },
                _id: { $nin: excludeCreativeIds }
            }
        },
        {
            $addFields: {
                // 综合推荐分：ROAS权重50% + 质量分权重30% + 活跃天数权重20%
                recommendScore: {
                    $add: [
                        { $multiply: [{ $min: ['$roas', 5] }, 10] }, // ROAS 最高贡献 50 分
                        { $multiply: ['$avgQualityScore', 0.3] }, // 质量分贡献 30 分
                        { $multiply: ['$daysActive', 2.86] } // 7天活跃贡献 20 分
                    ]
                }
            }
        },
        { $sort: { recommendScore: -1 } },
        { $limit: limit },
        {
            $project: {
                creativeId: '$_id',
                imageHash: 1,
                videoId: 1,
                thumbnailUrl: 1,
                materialType: 1,
                spend: { $round: ['$totalSpend', 2] },
                revenue: { $round: ['$totalRevenue', 2] },
                roas: { $round: ['$roas', 2] },
                ctr: { $round: ['$ctr', 2] },
                impressions: '$totalImpressions',
                clicks: '$totalClicks',
                installs: '$totalInstalls',
                qualityScore: { $round: ['$avgQualityScore', 0] },
                daysActive: 1,
                recommendScore: { $round: ['$recommendScore', 0] },
                // 使用该素材的投手（展开嵌套数组）
                usedByOptimizers: {
                    $reduce: {
                        input: '$optimizers',
                        initialValue: [],
                        in: { $setUnion: ['$$value', '$$this'] }
                    }
                },
                // 使用的广告系列数
                campaignCount: {
                    $size: {
                        $reduce: {
                            input: '$campaigns',
                            initialValue: [],
                            in: { $setUnion: ['$$value', '$$this'] }
                        }
                    }
                },
                // 推荐理由
                reason: {
                    $concat: [
                        'ROAS ', { $toString: { $round: ['$roas', 2] } },
                        ', 消耗 $', { $toString: { $round: ['$totalSpend', 0] } },
                        ', 活跃 ', { $toString: '$daysActive' }, ' 天'
                    ]
                }
            }
        }
    ]);
    return {
        recommendations,
        criteria: {
            minSpend,
            minRoas,
            minDays,
            dateRange: { from: sevenDaysAgo, to: today },
        },
        totalFound: recommendations.length,
    };
};
exports.getRecommendedMaterials = getRecommendedMaterials;
/**
 * 获取表现下滑的素材（预警）
 * 用于识别需要替换的素材
 */
const getDecliningMaterials = async (options = {}) => {
    const { minSpend = 30, declineThreshold = 30, limit = 20 } = options;
    const today = (0, dayjs_1.default)().format('YYYY-MM-DD');
    const threeDaysAgo = (0, dayjs_1.default)().subtract(3, 'day').format('YYYY-MM-DD');
    const sevenDaysAgo = (0, dayjs_1.default)().subtract(7, 'day').format('YYYY-MM-DD');
    // 获取最近3天和前4天的数据对比
    const recentData = await MaterialMetrics_1.default.aggregate([
        {
            $match: {
                date: { $gte: threeDaysAgo, $lte: today },
                spend: { $gt: 0 }
            }
        },
        {
            $group: {
                _id: '$creativeId',
                recentSpend: { $sum: '$spend' },
                recentRevenue: { $sum: '$purchaseValue' },
                thumbnailUrl: { $first: '$thumbnailUrl' },
                materialType: { $first: '$materialType' },
            }
        },
        {
            $addFields: {
                recentRoas: { $cond: [{ $gt: ['$recentSpend', 0] }, { $divide: ['$recentRevenue', '$recentSpend'] }, 0] }
            }
        }
    ]);
    const olderData = await MaterialMetrics_1.default.aggregate([
        {
            $match: {
                date: { $gte: sevenDaysAgo, $lt: threeDaysAgo },
                spend: { $gt: 0 }
            }
        },
        {
            $group: {
                _id: '$creativeId',
                olderSpend: { $sum: '$spend' },
                olderRevenue: { $sum: '$purchaseValue' },
            }
        },
        {
            $addFields: {
                olderRoas: { $cond: [{ $gt: ['$olderSpend', 0] }, { $divide: ['$olderRevenue', '$olderSpend'] }, 0] }
            }
        }
    ]);
    // 创建 olderData 的 map
    const olderMap = new Map(olderData.map((d) => [d._id, d]));
    // 计算下滑的素材
    const declining = recentData
        .map((recent) => {
        const older = olderMap.get(recent._id);
        if (!older || older.olderRoas === 0)
            return null;
        const roasChange = ((recent.recentRoas - older.olderRoas) / older.olderRoas) * 100;
        if (roasChange < -declineThreshold && recent.recentSpend >= minSpend) {
            return {
                creativeId: recent._id,
                thumbnailUrl: recent.thumbnailUrl,
                materialType: recent.materialType,
                recentRoas: Math.round(recent.recentRoas * 100) / 100,
                olderRoas: Math.round(older.olderRoas * 100) / 100,
                roasChange: Math.round(roasChange * 10) / 10,
                recentSpend: Math.round(recent.recentSpend * 100) / 100,
                warning: `ROAS 下降 ${Math.abs(Math.round(roasChange))}%`,
                suggestion: recent.recentRoas < 0.5 ? '建议暂停' : '建议观察',
            };
        }
        return null;
    })
        .filter(Boolean)
        .sort((a, b) => a.roasChange - b.roasChange)
        .slice(0, limit);
    return {
        decliningMaterials: declining,
        threshold: {
            minSpend,
            declineThreshold: `${declineThreshold}%`,
            comparisonPeriod: '最近3天 vs 前4天',
        },
    };
};
exports.getDecliningMaterials = getDecliningMaterials;
exports.default = {
    aggregateMaterialMetrics: exports.aggregateMaterialMetrics,
    getMaterialRankings: exports.getMaterialRankings,
    getMaterialTrend: exports.getMaterialTrend,
    findDuplicateMaterials: exports.findDuplicateMaterials,
    getMaterialUsage: exports.getMaterialUsage,
    getRecommendedMaterials: exports.getRecommendedMaterials,
    getDecliningMaterials: exports.getDecliningMaterials,
};
