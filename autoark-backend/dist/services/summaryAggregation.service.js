"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshDashboardSummary = refreshDashboardSummary;
exports.refreshAccountSummary = refreshAccountSummary;
exports.refreshCountrySummary = refreshCountrySummary;
exports.refreshCampaignSummary = refreshCampaignSummary;
exports.refreshMaterialSummary = refreshMaterialSummary;
exports.refreshAllSummaries = refreshAllSummaries;
exports.getSummaryStatus = getSummaryStatus;
const dayjs_1 = __importDefault(require("dayjs"));
const logger_1 = __importDefault(require("../utils/logger"));
const MetricsDaily_1 = __importDefault(require("../models/MetricsDaily"));
const Campaign_1 = __importDefault(require("../models/Campaign"));
const Ad_1 = __importDefault(require("../models/Ad"));
const Account_1 = __importDefault(require("../models/Account"));
const Summary_1 = require("../models/Summary");
// 国家代码到名称的映射
const COUNTRY_NAMES = {
    US: '美国', CN: '中国', JP: '日本', KR: '韩国', GB: '英国',
    DE: '德国', FR: '法国', IT: '意大利', ES: '西班牙', BR: '巴西',
    MX: '墨西哥', IN: '印度', ID: '印度尼西亚', TH: '泰国', VN: '越南',
    PH: '菲律宾', MY: '马来西亚', SG: '新加坡', AU: '澳大利亚', CA: '加拿大',
    RU: '俄罗斯', TR: '土耳其', SA: '沙特阿拉伯', AE: '阿联酋', EG: '埃及',
    ZA: '南非', NG: '尼日利亚', AR: '阿根廷', CL: '智利', CO: '哥伦比亚',
    PL: '波兰', NL: '荷兰', BE: '比利时', SE: '瑞典', NO: '挪威',
    DK: '丹麦', FI: '芬兰', AT: '奥地利', CH: '瑞士', PT: '葡萄牙',
    GR: '希腊', CZ: '捷克', RO: '罗马尼亚', HU: '匈牙利', IL: '以色列',
    TW: '台湾', HK: '香港', PK: '巴基斯坦', BD: '孟加拉国', NZ: '新西兰',
};
/**
 * 计算派生指标
 */
function calculateDerivedMetrics(data) {
    const { spend, revenue, impressions, clicks, installs } = data;
    return {
        roas: spend > 0 ? revenue / spend : 0,
        ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
        cpc: clicks > 0 ? spend / clicks : 0,
        cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
        cpi: installs > 0 ? spend / installs : 0,
    };
}
/**
 * 从 actions 数组提取指定类型的值
 */
function extractAction(actions, actionType) {
    if (!Array.isArray(actions))
        return 0;
    const action = actions.find((a) => a.action_type === actionType);
    return action ? parseFloat(action.value || '0') : 0;
}
/**
 * 从 action_values 数组提取购买价值
 */
function extractPurchaseValue(actionValues) {
    if (!Array.isArray(actionValues))
        return 0;
    let total = 0;
    for (const av of actionValues) {
        if (av.action_type === 'purchase' || av.action_type === 'omni_purchase') {
            total += parseFloat(av.value || '0');
        }
    }
    return total;
}
// ==================== 仪表盘汇总 ====================
async function refreshDashboardSummary(date) {
    const startTime = Date.now();
    logger_1.default.info(`[SummaryAggregation] Refreshing dashboard summary for ${date}`);
    try {
        await Summary_1.SummaryMeta.updateOne({ summaryType: 'dashboard' }, { $set: { status: 'refreshing' } }, { upsert: true });
        // 聚合当天所有指标
        const result = await MetricsDaily_1.default.aggregate([
            { $match: { date } },
            {
                $group: {
                    _id: null,
                    totalSpend: { $sum: '$spendUsd' },
                    totalImpressions: { $sum: '$impressions' },
                    totalClicks: { $sum: '$clicks' },
                    totalInstalls: { $sum: '$conversions' },
                    uniqueAccounts: { $addToSet: '$accountId' },
                    uniqueCampaigns: { $addToSet: '$campaignId' },
                    uniqueCountries: { $addToSet: '$country' },
                    // 收集 raw 数据用于提取 purchase_value
                    rawDataList: { $push: '$raw' },
                }
            }
        ]);
        if (result.length === 0) {
            logger_1.default.info(`[SummaryAggregation] No data for dashboard on ${date}`);
            return;
        }
        const agg = result[0];
        // 计算 purchase_value（从 raw.action_values 提取）
        let totalRevenue = 0;
        let totalPurchases = 0;
        for (const raw of agg.rawDataList || []) {
            if (raw?.action_values) {
                totalRevenue += extractPurchaseValue(raw.action_values);
            }
            if (raw?.actions) {
                totalPurchases += extractAction(raw.actions, 'purchase') || extractAction(raw.actions, 'omni_purchase');
            }
        }
        const metrics = calculateDerivedMetrics({
            spend: agg.totalSpend || 0,
            revenue: totalRevenue,
            impressions: agg.totalImpressions || 0,
            clicks: agg.totalClicks || 0,
            installs: agg.totalInstalls || 0,
        });
        await Summary_1.DashboardSummary.updateOne({ date }, {
            $set: {
                totalSpend: agg.totalSpend || 0,
                totalRevenue,
                totalImpressions: agg.totalImpressions || 0,
                totalClicks: agg.totalClicks || 0,
                totalInstalls: agg.totalInstalls || 0,
                totalPurchases,
                ...metrics,
                activeAccounts: (agg.uniqueAccounts || []).filter(Boolean).length,
                activeCampaigns: (agg.uniqueCampaigns || []).filter(Boolean).length,
                activeCountries: (agg.uniqueCountries || []).filter(Boolean).length,
                lastUpdated: new Date(),
            }
        }, { upsert: true });
        const duration = Date.now() - startTime;
        await Summary_1.SummaryMeta.updateOne({ summaryType: 'dashboard' }, { $set: { status: 'idle', lastFullRefresh: new Date(), refreshDurationMs: duration } });
        logger_1.default.info(`[SummaryAggregation] Dashboard summary for ${date} refreshed in ${duration}ms`);
    }
    catch (error) {
        logger_1.default.error(`[SummaryAggregation] Dashboard summary refresh failed:`, error);
        await Summary_1.SummaryMeta.updateOne({ summaryType: 'dashboard' }, { $set: { status: 'error', lastError: error.message } });
        throw error;
    }
}
// ==================== 账户汇总 ====================
async function refreshAccountSummary(date) {
    const startTime = Date.now();
    logger_1.default.info(`[SummaryAggregation] Refreshing account summary for ${date}`);
    try {
        await Summary_1.SummaryMeta.updateOne({ summaryType: 'account' }, { $set: { status: 'refreshing' } }, { upsert: true });
        // 获取账户名称映射
        const accounts = await Account_1.default.find({}).lean();
        const accountNameMap = new Map();
        accounts.forEach((a) => {
            accountNameMap.set(a.accountId, a.name || a.accountId);
        });
        // 按账户聚合
        const result = await MetricsDaily_1.default.aggregate([
            { $match: { date, accountId: { $exists: true, $ne: null } } },
            {
                $group: {
                    _id: '$accountId',
                    spend: { $sum: '$spendUsd' },
                    impressions: { $sum: '$impressions' },
                    clicks: { $sum: '$clicks' },
                    installs: { $sum: '$conversions' },
                    campaignIds: { $addToSet: '$campaignId' },
                    rawDataList: { $push: '$raw' },
                }
            }
        ]);
        const bulkOps = result.map((agg) => {
            let revenue = 0;
            let purchases = 0;
            for (const raw of agg.rawDataList || []) {
                if (raw?.action_values) {
                    revenue += extractPurchaseValue(raw.action_values);
                }
                if (raw?.actions) {
                    purchases += extractAction(raw.actions, 'purchase') || extractAction(raw.actions, 'omni_purchase');
                }
            }
            const metrics = calculateDerivedMetrics({
                spend: agg.spend || 0,
                revenue,
                impressions: agg.impressions || 0,
                clicks: agg.clicks || 0,
                installs: agg.installs || 0,
            });
            return {
                updateOne: {
                    filter: { date, accountId: agg._id },
                    update: {
                        $set: {
                            accountName: accountNameMap.get(agg._id) || agg._id,
                            spend: agg.spend || 0,
                            revenue,
                            impressions: agg.impressions || 0,
                            clicks: agg.clicks || 0,
                            installs: agg.installs || 0,
                            purchases,
                            ...metrics,
                            campaignCount: (agg.campaignIds || []).filter(Boolean).length,
                            lastUpdated: new Date(),
                        }
                    },
                    upsert: true,
                }
            };
        });
        if (bulkOps.length > 0) {
            await Summary_1.AccountSummary.bulkWrite(bulkOps);
        }
        const duration = Date.now() - startTime;
        await Summary_1.SummaryMeta.updateOne({ summaryType: 'account' }, { $set: { status: 'idle', lastFullRefresh: new Date(), refreshDurationMs: duration, recordCount: bulkOps.length } });
        logger_1.default.info(`[SummaryAggregation] Account summary for ${date} refreshed: ${bulkOps.length} accounts in ${duration}ms`);
    }
    catch (error) {
        logger_1.default.error(`[SummaryAggregation] Account summary refresh failed:`, error);
        await Summary_1.SummaryMeta.updateOne({ summaryType: 'account' }, { $set: { status: 'error', lastError: error.message } });
        throw error;
    }
}
// ==================== 国家汇总 ====================
async function refreshCountrySummary(date) {
    const startTime = Date.now();
    logger_1.default.info(`[SummaryAggregation] Refreshing country summary for ${date}`);
    try {
        await Summary_1.SummaryMeta.updateOne({ summaryType: 'country' }, { $set: { status: 'refreshing' } }, { upsert: true });
        // 按国家聚合
        const result = await MetricsDaily_1.default.aggregate([
            { $match: { date, country: { $exists: true, $ne: null } } },
            {
                $group: {
                    _id: '$country',
                    spend: { $sum: '$spendUsd' },
                    impressions: { $sum: '$impressions' },
                    clicks: { $sum: '$clicks' },
                    installs: { $sum: '$conversions' },
                    campaignIds: { $addToSet: '$campaignId' },
                    accountIds: { $addToSet: '$accountId' },
                    rawDataList: { $push: '$raw' },
                }
            }
        ]);
        const bulkOps = result.map((agg) => {
            let revenue = 0;
            let purchases = 0;
            for (const raw of agg.rawDataList || []) {
                if (raw?.action_values) {
                    revenue += extractPurchaseValue(raw.action_values);
                }
                if (raw?.actions) {
                    purchases += extractAction(raw.actions, 'purchase') || extractAction(raw.actions, 'omni_purchase');
                }
            }
            const metrics = calculateDerivedMetrics({
                spend: agg.spend || 0,
                revenue,
                impressions: agg.impressions || 0,
                clicks: agg.clicks || 0,
                installs: agg.installs || 0,
            });
            return {
                updateOne: {
                    filter: { date, country: agg._id },
                    update: {
                        $set: {
                            countryName: COUNTRY_NAMES[agg._id] || agg._id,
                            spend: agg.spend || 0,
                            revenue,
                            impressions: agg.impressions || 0,
                            clicks: agg.clicks || 0,
                            installs: agg.installs || 0,
                            purchases,
                            ...metrics,
                            campaignCount: (agg.campaignIds || []).filter(Boolean).length,
                            accountCount: (agg.accountIds || []).filter(Boolean).length,
                            lastUpdated: new Date(),
                        }
                    },
                    upsert: true,
                }
            };
        });
        if (bulkOps.length > 0) {
            await Summary_1.CountrySummary.bulkWrite(bulkOps);
        }
        const duration = Date.now() - startTime;
        await Summary_1.SummaryMeta.updateOne({ summaryType: 'country' }, { $set: { status: 'idle', lastFullRefresh: new Date(), refreshDurationMs: duration, recordCount: bulkOps.length } });
        logger_1.default.info(`[SummaryAggregation] Country summary for ${date} refreshed: ${bulkOps.length} countries in ${duration}ms`);
    }
    catch (error) {
        logger_1.default.error(`[SummaryAggregation] Country summary refresh failed:`, error);
        await Summary_1.SummaryMeta.updateOne({ summaryType: 'country' }, { $set: { status: 'error', lastError: error.message } });
        throw error;
    }
}
// ==================== 广告系列汇总 ====================
async function refreshCampaignSummary(date) {
    const startTime = Date.now();
    logger_1.default.info(`[SummaryAggregation] Refreshing campaign summary for ${date}`);
    try {
        await Summary_1.SummaryMeta.updateOne({ summaryType: 'campaign' }, { $set: { status: 'refreshing' } }, { upsert: true });
        // 获取 campaign 基本信息
        const campaigns = await Campaign_1.default.find({}).lean();
        const campaignInfoMap = new Map();
        campaigns.forEach((c) => {
            campaignInfoMap.set(c.campaignId, {
                name: c.name,
                accountId: c.accountId,
                status: c.status,
                objective: c.objective,
            });
        });
        // 获取账户名称
        const accounts = await Account_1.default.find({}).lean();
        const accountNameMap = new Map();
        accounts.forEach((a) => {
            accountNameMap.set(a.accountId, a.name || a.accountId);
        });
        // 按广告系列聚合
        const result = await MetricsDaily_1.default.aggregate([
            { $match: { date, campaignId: { $exists: true, $ne: null } } },
            {
                $group: {
                    _id: '$campaignId',
                    accountId: { $first: '$accountId' },
                    spend: { $sum: '$spendUsd' },
                    impressions: { $sum: '$impressions' },
                    clicks: { $sum: '$clicks' },
                    installs: { $sum: '$conversions' },
                    rawDataList: { $push: '$raw' },
                }
            }
        ]);
        const bulkOps = result.map((agg) => {
            const info = campaignInfoMap.get(agg._id) || {};
            let revenue = 0;
            let purchases = 0;
            const allActions = {};
            const allActionValues = {};
            for (const raw of agg.rawDataList || []) {
                if (raw?.action_values) {
                    revenue += extractPurchaseValue(raw.action_values);
                    // 提取所有 action_values
                    for (const av of raw.action_values) {
                        const key = `${av.action_type}_value`;
                        allActionValues[key] = (allActionValues[key] || 0) + parseFloat(av.value || '0');
                    }
                }
                if (raw?.actions) {
                    purchases += extractAction(raw.actions, 'purchase') || extractAction(raw.actions, 'omni_purchase');
                    // 提取所有 actions
                    for (const a of raw.actions) {
                        allActions[a.action_type] = (allActions[a.action_type] || 0) + parseFloat(a.value || '0');
                    }
                }
            }
            const metrics = calculateDerivedMetrics({
                spend: agg.spend || 0,
                revenue,
                impressions: agg.impressions || 0,
                clicks: agg.clicks || 0,
                installs: agg.installs || 0,
            });
            return {
                updateOne: {
                    filter: { date, campaignId: agg._id },
                    update: {
                        $set: {
                            campaignName: info.name || agg._id,
                            accountId: agg.accountId || info.accountId,
                            accountName: accountNameMap.get(agg.accountId || info.accountId) || '',
                            status: info.status,
                            objective: info.objective,
                            spend: agg.spend || 0,
                            revenue,
                            impressions: agg.impressions || 0,
                            clicks: agg.clicks || 0,
                            installs: agg.installs || 0,
                            purchases,
                            ...metrics,
                            actions: allActions,
                            actionValues: allActionValues,
                            lastUpdated: new Date(),
                        }
                    },
                    upsert: true,
                }
            };
        });
        if (bulkOps.length > 0) {
            await Summary_1.CampaignSummary.bulkWrite(bulkOps);
        }
        const duration = Date.now() - startTime;
        await Summary_1.SummaryMeta.updateOne({ summaryType: 'campaign' }, { $set: { status: 'idle', lastFullRefresh: new Date(), refreshDurationMs: duration, recordCount: bulkOps.length } });
        logger_1.default.info(`[SummaryAggregation] Campaign summary for ${date} refreshed: ${bulkOps.length} campaigns in ${duration}ms`);
    }
    catch (error) {
        logger_1.default.error(`[SummaryAggregation] Campaign summary refresh failed:`, error);
        await Summary_1.SummaryMeta.updateOne({ summaryType: 'campaign' }, { $set: { status: 'error', lastError: error.message } });
        throw error;
    }
}
// ==================== 素材汇总 ====================
async function refreshMaterialSummary(date) {
    const startTime = Date.now();
    logger_1.default.info(`[SummaryAggregation] Refreshing material summary for ${date}`);
    try {
        await Summary_1.SummaryMeta.updateOne({ summaryType: 'material' }, { $set: { status: 'refreshing' } }, { upsert: true });
        // 获取 Ad -> Creative 映射
        const ads = await Ad_1.default.find({}).select('adId creativeId imageHash videoId thumbnailUrl').lean();
        const adCreativeMap = new Map();
        ads.forEach((ad) => {
            adCreativeMap.set(ad.adId, {
                creativeId: ad.creativeId,
                imageHash: ad.imageHash,
                videoId: ad.videoId,
                thumbnailUrl: ad.thumbnailUrl,
            });
        });
        // 按 Ad 聚合，然后按素材合并
        const adMetrics = await MetricsDaily_1.default.aggregate([
            { $match: { date, adId: { $exists: true, $ne: null }, spendUsd: { $gt: 0 } } },
            {
                $group: {
                    _id: '$adId',
                    campaignId: { $first: '$campaignId' },
                    spend: { $sum: '$spendUsd' },
                    impressions: { $sum: '$impressions' },
                    clicks: { $sum: '$clicks' },
                    installs: { $sum: '$conversions' },
                    rawDataList: { $push: '$raw' },
                }
            }
        ]);
        // 按素材 key 聚合
        const materialAgg = new Map();
        for (const adMetric of adMetrics) {
            const creativeInfo = adCreativeMap.get(adMetric._id);
            if (!creativeInfo)
                continue;
            // 确定素材 key（优先 creativeId，其次 imageHash/videoId）
            const materialKey = creativeInfo.creativeId || creativeInfo.imageHash || creativeInfo.videoId;
            if (!materialKey)
                continue;
            if (!materialAgg.has(materialKey)) {
                materialAgg.set(materialKey, {
                    materialType: creativeInfo.videoId ? 'video' : 'image',
                    thumbnailUrl: creativeInfo.thumbnailUrl,
                    spend: 0,
                    impressions: 0,
                    clicks: 0,
                    installs: 0,
                    revenue: 0,
                    purchases: 0,
                    adIds: new Set(),
                    campaignIds: new Set(),
                    rawDataList: [],
                });
            }
            const agg = materialAgg.get(materialKey);
            agg.spend += adMetric.spend || 0;
            agg.impressions += adMetric.impressions || 0;
            agg.clicks += adMetric.clicks || 0;
            agg.installs += adMetric.installs || 0;
            agg.adIds.add(adMetric._id);
            if (adMetric.campaignId)
                agg.campaignIds.add(adMetric.campaignId);
            agg.rawDataList.push(...(adMetric.rawDataList || []));
        }
        const bulkOps = [];
        for (const [materialKey, agg] of materialAgg) {
            // 提取 revenue
            for (const raw of agg.rawDataList || []) {
                if (raw?.action_values) {
                    agg.revenue += extractPurchaseValue(raw.action_values);
                }
                if (raw?.actions) {
                    agg.purchases += extractAction(raw.actions, 'purchase') || extractAction(raw.actions, 'omni_purchase');
                }
            }
            const metrics = calculateDerivedMetrics({
                spend: agg.spend,
                revenue: agg.revenue,
                impressions: agg.impressions,
                clicks: agg.clicks,
                installs: agg.installs,
            });
            // 计算质量分
            let qualityScore = 50;
            if (metrics.roas >= 3)
                qualityScore += 30;
            else if (metrics.roas >= 2)
                qualityScore += 25;
            else if (metrics.roas >= 1.5)
                qualityScore += 20;
            else if (metrics.roas >= 1)
                qualityScore += 10;
            else if (metrics.roas < 0.5)
                qualityScore -= 10;
            if (metrics.ctr >= 2)
                qualityScore += 10;
            else if (metrics.ctr >= 1)
                qualityScore += 5;
            else if (metrics.ctr < 0.5)
                qualityScore -= 5;
            qualityScore = Math.max(0, Math.min(100, qualityScore));
            bulkOps.push({
                updateOne: {
                    filter: { date, materialKey },
                    update: {
                        $set: {
                            materialType: agg.materialType,
                            thumbnailUrl: agg.thumbnailUrl,
                            spend: agg.spend,
                            revenue: agg.revenue,
                            impressions: agg.impressions,
                            clicks: agg.clicks,
                            installs: agg.installs,
                            purchases: agg.purchases,
                            ...metrics,
                            qualityScore,
                            adCount: agg.adIds.size,
                            campaignCount: agg.campaignIds.size,
                            lastUpdated: new Date(),
                        }
                    },
                    upsert: true,
                }
            });
        }
        if (bulkOps.length > 0) {
            await Summary_1.MaterialSummary.bulkWrite(bulkOps);
        }
        const duration = Date.now() - startTime;
        await Summary_1.SummaryMeta.updateOne({ summaryType: 'material' }, { $set: { status: 'idle', lastFullRefresh: new Date(), refreshDurationMs: duration, recordCount: bulkOps.length } });
        logger_1.default.info(`[SummaryAggregation] Material summary for ${date} refreshed: ${bulkOps.length} materials in ${duration}ms`);
    }
    catch (error) {
        logger_1.default.error(`[SummaryAggregation] Material summary refresh failed:`, error);
        await Summary_1.SummaryMeta.updateOne({ summaryType: 'material' }, { $set: { status: 'error', lastError: error.message } });
        throw error;
    }
}
// ==================== 刷新所有汇总 ====================
async function refreshAllSummaries(date) {
    const targetDate = date || (0, dayjs_1.default)().format('YYYY-MM-DD');
    const startTime = Date.now();
    logger_1.default.info(`[SummaryAggregation] Refreshing all summaries for ${targetDate}`);
    const results = {
        dashboard: false,
        account: false,
        country: false,
        campaign: false,
        material: false,
        duration: 0,
    };
    try {
        await refreshDashboardSummary(targetDate);
        results.dashboard = true;
    }
    catch (e) {
        logger_1.default.error('[SummaryAggregation] Dashboard refresh failed', e);
    }
    try {
        await refreshAccountSummary(targetDate);
        results.account = true;
    }
    catch (e) {
        logger_1.default.error('[SummaryAggregation] Account refresh failed', e);
    }
    try {
        await refreshCountrySummary(targetDate);
        results.country = true;
    }
    catch (e) {
        logger_1.default.error('[SummaryAggregation] Country refresh failed', e);
    }
    try {
        await refreshCampaignSummary(targetDate);
        results.campaign = true;
    }
    catch (e) {
        logger_1.default.error('[SummaryAggregation] Campaign refresh failed', e);
    }
    try {
        await refreshMaterialSummary(targetDate);
        results.material = true;
    }
    catch (e) {
        logger_1.default.error('[SummaryAggregation] Material refresh failed', e);
    }
    results.duration = Date.now() - startTime;
    logger_1.default.info(`[SummaryAggregation] All summaries refreshed in ${results.duration}ms`, results);
    return results;
}
// ==================== 获取汇总状态 ====================
async function getSummaryStatus() {
    const metas = await Summary_1.SummaryMeta.find({}).lean();
    return metas.reduce((acc, m) => {
        acc[m.summaryType] = {
            status: m.status,
            lastRefresh: m.lastFullRefresh,
            recordCount: m.recordCount,
            durationMs: m.refreshDurationMs,
            error: m.lastError,
        };
        return acc;
    }, {});
}
