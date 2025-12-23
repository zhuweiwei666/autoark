"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getByAdSet = exports.getByCountry = exports.getDaily = void 0;
exports.getSystemHealth = getSystemHealth;
exports.getFacebookOverview = getFacebookOverview;
exports.getCronLogs = getCronLogs;
exports.getOpsLogs = getOpsLogs;
exports.getCoreMetrics = getCoreMetrics;
exports.getTodaySpendTrend = getTodaySpendTrend;
exports.getCampaignSpendRanking = getCampaignSpendRanking;
exports.getCountrySpendRanking = getCountrySpendRanking;
const models_1 = require("../models");
const FbToken_1 = __importDefault(require("../models/FbToken"));
const mongoose_1 = __importDefault(require("mongoose"));
const facebook_api_1 = require("./facebook.api");
const accountId_1 = require("../utils/accountId");
const logger_1 = __importDefault(require("../utils/logger"));
const buildMatchStage = (filters) => {
    const match = {
        date: { $gte: filters.startDate, $lte: filters.endDate },
    };
    if (filters.channel) {
        match.channel = filters.channel;
    }
    if (filters.country) {
        match.country = filters.country;
    }
    return match;
};
const getDaily = async (filters) => {
    const match = buildMatchStage(filters);
    const pipeline = [
        { $match: match },
        {
            $group: {
                _id: '$date',
                spendUsd: { $sum: '$spendUsd' },
                installs: { $sum: '$installs' },
                revenueD0: { $sum: '$revenueD0' },
                impressions: { $sum: '$impressions' },
                clicks: { $sum: '$clicks' },
            },
        },
        { $sort: { _id: 1 } },
        {
            $project: {
                _id: 0,
                date: '$_id',
                spendUsd: 1,
                installs: 1,
                revenueD0: 1,
                cpiUsd: {
                    $cond: [
                        { $gt: ['$installs', 0] },
                        { $divide: ['$spendUsd', '$installs'] },
                        0,
                    ],
                },
                roiD0: {
                    $cond: [
                        { $gt: ['$spendUsd', 0] },
                        { $divide: ['$revenueD0', '$spendUsd'] },
                        0,
                    ],
                },
                ctr: {
                    $cond: [
                        { $gt: ['$impressions', 0] },
                        { $divide: ['$clicks', '$impressions'] },
                        0,
                    ],
                },
            },
        },
    ];
    return await models_1.MetricsDaily.aggregate(pipeline);
};
exports.getDaily = getDaily;
const getByCountry = async (filters) => {
    const match = buildMatchStage(filters);
    const pipeline = [
        { $match: match },
        {
            $group: {
                _id: '$country',
                spendUsd: { $sum: '$spendUsd' },
                installs: { $sum: '$installs' },
                revenueD0: { $sum: '$revenueD0' },
            },
        },
        { $sort: { spendUsd: -1 } },
        {
            $project: {
                _id: 0,
                country: '$_id',
                spendUsd: 1,
                installs: 1,
                revenueD0: 1,
                roiD0: {
                    $cond: [
                        { $gt: ['$spendUsd', 0] },
                        { $divide: ['$revenueD0', '$spendUsd'] },
                        0,
                    ],
                },
            },
        },
    ];
    return await models_1.MetricsDaily.aggregate(pipeline);
};
exports.getByCountry = getByCountry;
const getByAdSet = async (filters) => {
    const match = buildMatchStage(filters);
    const pipeline = [
        { $match: match },
        {
            $group: {
                _id: '$adsetId',
                spendUsd: { $sum: '$spendUsd' },
                installs: { $sum: '$installs' },
                revenueD0: { $sum: '$revenueD0' },
            },
        },
        { $sort: { spendUsd: -1 } },
        {
            $project: {
                _id: 0,
                adsetId: '$_id',
                spendUsd: 1,
                installs: 1,
                cpiUsd: {
                    $cond: [
                        { $gt: ['$installs', 0] },
                        { $divide: ['$spendUsd', '$installs'] },
                        0,
                    ],
                },
                roiD0: {
                    $cond: [
                        { $gt: ['$spendUsd', 0] },
                        { $divide: ['$revenueD0', '$spendUsd'] },
                        0,
                    ],
                },
            },
        },
    ];
    return await models_1.MetricsDaily.aggregate(pipeline);
};
exports.getByAdSet = getByAdSet;
// --- New Dashboard Service Methods for Read-Only Dashboard ---
async function getSystemHealth() {
    let mongoConnected = false;
    try {
        mongoConnected = mongoose_1.default.connection.readyState === 1;
    }
    catch (e) {
        mongoConnected = false;
    }
    const lastSync = await models_1.SyncLog.findOne().sort({ createdAt: -1 }).lean();
    return {
        serverTime: new Date(),
        uptimeSeconds: process.uptime(),
        mongoConnected,
        lastSyncAt: lastSync?.createdAt ?? null,
    };
}
async function getFacebookOverview() {
    const [accounts, campaigns, ads, lastSync] = await Promise.all([
        models_1.Account.countDocuments(),
        models_1.Campaign.countDocuments(),
        models_1.Ad.countDocuments(),
        models_1.SyncLog.findOne().sort({ createdAt: -1 }).lean(),
    ]);
    return {
        accounts,
        campaigns,
        ads,
        lastSyncAt: lastSync?.createdAt ?? null,
    };
}
async function getCronLogs(limit = 50) {
    const logs = await models_1.SyncLog.find().sort({ createdAt: -1 }).limit(limit).lean();
    return logs;
}
async function getOpsLogs(limit = 50) {
    const logs = await models_1.OpsLog.find().sort({ createdAt: -1 }).limit(limit).lean();
    return logs;
}
// ========== 数据看板 V1 API ==========
/**
 * 获取核心指标概览（今日消耗、昨日消耗、7日趋势等）
 * 直接从 Facebook Insights API 获取数据以确保准确性
 * 使用 campaign 级别数据确保与广告系列页面一致
 */
async function getCoreMetrics(startDate, endDate) {
    const today = endDate || new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const sevenDaysAgo = startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    // 获取有效 token
    const tokenDoc = await FbToken_1.default.findOne({ status: 'active' });
    const token = tokenDoc?.token;
    let todayMetrics = { spend: 0, impressions: 0, clicks: 0, installs: 0, purchase_value: 0 };
    let yesterdayMetrics = { spend: 0, impressions: 0, clicks: 0, installs: 0, purchase_value: 0 };
    let sevenDaysMetrics = { spend: 0, impressions: 0, clicks: 0, installs: 0, purchase_value: 0 };
    if (token) {
        // 获取所有活跃账户
        const accounts = await models_1.Account.find({ status: 'active' }).lean();
        logger_1.default.info(`[Dashboard] Fetching campaign-level insights for ${accounts.length} accounts`);
        // 并发获取所有账户的 campaign 级别 insights（与广告系列页面一致）
        const fetchCampaignInsights = async (datePreset, timeRange) => {
            const promises = accounts.map(async (account) => {
                try {
                    const accountIdForApi = (0, accountId_1.normalizeForApi)(account.accountId);
                    const insights = await (0, facebook_api_1.fetchInsights)(accountIdForApi, 'campaign', // 使用 campaign 级别，与广告系列页面一致
                    datePreset || undefined, token, undefined, timeRange);
                    if (insights && Array.isArray(insights)) {
                        // 聚合该账户下所有 campaign 的数据
                        let totalSpend = 0;
                        let totalImpressions = 0;
                        let totalClicks = 0;
                        let totalPurchaseValue = 0;
                        insights.forEach((insight) => {
                            totalSpend += parseFloat(insight.spend || '0');
                            totalImpressions += parseInt(insight.impressions || '0', 10);
                            totalClicks += parseInt(insight.clicks || '0', 10);
                            if (insight.action_values && Array.isArray(insight.action_values)) {
                                const purchaseAction = insight.action_values.find((a) => a.action_type === 'purchase' || a.action_type === 'mobile_app_purchase' || a.action_type === 'omni_purchase');
                                if (purchaseAction) {
                                    totalPurchaseValue += parseFloat(purchaseAction.value) || 0;
                                }
                            }
                        });
                        return {
                            spend: totalSpend,
                            impressions: totalImpressions,
                            clicks: totalClicks,
                            installs: 0,
                            purchase_value: totalPurchaseValue
                        };
                    }
                    return { spend: 0, impressions: 0, clicks: 0, installs: 0, purchase_value: 0 };
                }
                catch (error) {
                    return { spend: 0, impressions: 0, clicks: 0, installs: 0, purchase_value: 0 };
                }
            });
            const results = await Promise.all(promises);
            return results.reduce((acc, curr) => ({
                spend: acc.spend + curr.spend,
                impressions: acc.impressions + curr.impressions,
                clicks: acc.clicks + curr.clicks,
                installs: acc.installs + curr.installs,
                purchase_value: acc.purchase_value + curr.purchase_value
            }), { spend: 0, impressions: 0, clicks: 0, installs: 0, purchase_value: 0 });
        };
        // 并发获取今日、昨日、7日数据
        const [todayData, yesterdayData, sevenDaysData] = await Promise.all([
            fetchCampaignInsights('today'),
            fetchCampaignInsights('yesterday'),
            fetchCampaignInsights(undefined, { since: sevenDaysAgo, until: today })
        ]);
        todayMetrics = todayData;
        yesterdayMetrics = yesterdayData;
        sevenDaysMetrics = sevenDaysData;
        logger_1.default.info(`[Dashboard] Today spend: $${todayMetrics.spend.toFixed(2)}, Yesterday: $${yesterdayMetrics.spend.toFixed(2)}, 7days: $${sevenDaysMetrics.spend.toFixed(2)}`);
    }
    // 计算指标
    const todayCtr = todayMetrics.impressions > 0 ? (todayMetrics.clicks / todayMetrics.impressions) * 100 : 0;
    const todayCpm = todayMetrics.impressions > 0 ? (todayMetrics.spend / todayMetrics.impressions) * 1000 : 0;
    const todayCpc = todayMetrics.clicks > 0 ? todayMetrics.spend / todayMetrics.clicks : 0;
    const todayCpi = todayMetrics.installs > 0 ? todayMetrics.spend / todayMetrics.installs : 0;
    const todayRoas = todayMetrics.spend > 0 && todayMetrics.purchase_value ? todayMetrics.purchase_value / todayMetrics.spend : 0;
    return {
        today: {
            spend: todayMetrics.spend,
            impressions: todayMetrics.impressions,
            clicks: todayMetrics.clicks,
            installs: todayMetrics.installs,
            purchase_value: todayMetrics.purchase_value,
            ctr: todayCtr,
            cpm: todayCpm,
            cpc: todayCpc,
            cpi: todayCpi,
            roas: todayRoas,
        },
        yesterday: {
            spend: yesterdayMetrics.spend,
            impressions: yesterdayMetrics.impressions,
            clicks: yesterdayMetrics.clicks,
            installs: yesterdayMetrics.installs,
            purchase_value: yesterdayMetrics.purchase_value,
            roas: yesterdayMetrics.spend > 0 ? yesterdayMetrics.purchase_value / yesterdayMetrics.spend : 0,
        },
        sevenDays: {
            spend: sevenDaysMetrics.spend,
            impressions: sevenDaysMetrics.impressions,
            clicks: sevenDaysMetrics.clicks,
            installs: sevenDaysMetrics.installs,
            purchase_value: sevenDaysMetrics.purchase_value,
            roas: sevenDaysMetrics.spend > 0 ? sevenDaysMetrics.purchase_value / sevenDaysMetrics.spend : 0,
            avgDailySpend: sevenDaysMetrics.spend / 7,
        },
    };
}
/**
 * 获取今日消耗趋势（按小时）- 由于数据是按天存储的，这里返回最近7天的趋势
 */
async function getTodaySpendTrend(startDate, endDate) {
    const today = endDate || new Date().toISOString().split('T')[0];
    const sevenDaysAgo = startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    // 只统计 campaign 级别的数据，确保与广告系列页面数据一致
    const data = await models_1.MetricsDaily.aggregate([
        {
            $match: {
                date: { $gte: sevenDaysAgo, $lte: today },
                campaignId: { $exists: true, $ne: null } // 只统计 campaign 级别的数据
            }
        },
        {
            $group: {
                _id: '$date',
                spend: { $sum: '$spendUsd' },
                impressions: { $sum: '$impressions' },
                clicks: { $sum: '$clicks' },
            },
        },
        { $sort: { _id: 1 } },
        {
            $project: {
                _id: 0,
                date: '$_id',
                spend: 1,
                impressions: 1,
                clicks: 1,
            },
        },
    ]);
    return data;
}
/**
 * 获取分 Campaign 消耗排行
 * 直接从 Facebook Insights API 获取数据以确保准确性
 */
async function getCampaignSpendRanking(limit = 10, startDate, endDate) {
    const today = endDate || new Date().toISOString().split('T')[0];
    const sevenDaysAgo = startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    // 获取有效 token
    const tokenDoc = await FbToken_1.default.findOne({ status: 'active' });
    const token = tokenDoc?.token;
    if (!token) {
        logger_1.default.warn('[Dashboard] No active token found for campaign ranking');
        return [];
    }
    // 获取所有活跃账户
    const accounts = await models_1.Account.find({ status: 'active' }).lean();
    // 构建日期参数
    const timeRange = { since: sevenDaysAgo, until: today };
    // 并发获取所有账户的 campaign 级别 insights
    const accountPromises = accounts.map(async (account) => {
        try {
            const accountIdForApi = (0, accountId_1.normalizeForApi)(account.accountId);
            const insights = await (0, facebook_api_1.fetchInsights)(accountIdForApi, 'campaign', undefined, token, undefined, timeRange);
            return insights || [];
        }
        catch (error) {
            return [];
        }
    });
    const allInsights = (await Promise.all(accountPromises)).flat();
    // 聚合并排序
    const campaignMap = new Map();
    allInsights.forEach((insight) => {
        const campaignId = insight.campaign_id;
        if (!campaignId)
            return;
        let purchase_value = 0;
        if (insight.action_values && Array.isArray(insight.action_values)) {
            const purchaseAction = insight.action_values.find((a) => a.action_type === 'purchase' || a.action_type === 'mobile_app_purchase' || a.action_type === 'omni_purchase');
            if (purchaseAction) {
                purchase_value = parseFloat(purchaseAction.value) || 0;
            }
        }
        if (campaignMap.has(campaignId)) {
            const existing = campaignMap.get(campaignId);
            existing.spend += parseFloat(insight.spend || '0');
            existing.impressions += parseInt(insight.impressions || '0', 10);
            existing.clicks += parseInt(insight.clicks || '0', 10);
            existing.purchase_value += purchase_value;
        }
        else {
            campaignMap.set(campaignId, {
                campaignId,
                spend: parseFloat(insight.spend || '0'),
                impressions: parseInt(insight.impressions || '0', 10),
                clicks: parseInt(insight.clicks || '0', 10),
                installs: 0,
                purchase_value
            });
        }
    });
    // 转换为数组并排序
    let data = Array.from(campaignMap.values())
        .sort((a, b) => b.spend - a.spend)
        .slice(0, limit);
    // 获取 campaign 名称
    const campaignIds = data.map(d => d.campaignId);
    const campaigns = await models_1.Campaign.find({ campaignId: { $in: campaignIds } }).lean();
    const campaignNameMap = new Map(campaigns.map((c) => [c.campaignId, c.name]));
    // 计算派生指标
    data = data.map(d => {
        const ctr = d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0;
        const cpm = d.impressions > 0 ? (d.spend / d.impressions) * 1000 : 0;
        const cpc = d.clicks > 0 ? d.spend / d.clicks : 0;
        const cpi = d.installs > 0 ? d.spend / d.installs : 0;
        const roas = d.spend > 0 && d.purchase_value > 0 ? d.purchase_value / d.spend : 0;
        return {
            ...d,
            campaignName: campaignNameMap.get(d.campaignId) || d.campaignId,
            ctr,
            cpm,
            cpc,
            cpi,
            roas
        };
    });
    logger_1.default.info(`[Dashboard] Campaign ranking: top spend is $${data[0]?.spend?.toFixed(2) || 0}`);
    return data;
}
/**
 * 获取分国家消耗排行
 */
async function getCountrySpendRanking(limit = 10, startDate, endDate) {
    const today = endDate || new Date().toISOString().split('T')[0];
    const sevenDaysAgo = startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    // 注意：MetricsDaily 中没有 country 字段，需要从 Campaign 或其他地方获取
    // 这里先返回按 accountId 分组的数据，后续可以扩展
    // 优化：先聚合和排序，再 lookup，减少 lookup 的数据量
    // 重要：只统计 campaign 级别的数据，确保与广告系列页面数据一致
    const data = await models_1.MetricsDaily.aggregate([
        {
            $match: {
                date: { $gte: sevenDaysAgo, $lte: today },
                campaignId: { $exists: true, $ne: null } // 只统计 campaign 级别的数据
            }
        },
        {
            $group: {
                _id: '$accountId',
                spend: { $sum: '$spendUsd' },
                impressions: { $sum: '$impressions' },
                clicks: { $sum: '$clicks' },
                installs: { $sum: '$installs' },
                purchase_value: { $sum: '$purchase_value' },
            },
        },
        { $sort: { spend: -1 } },
        { $limit: limit },
        {
            $addFields: {
                // 统一处理 accountId：去掉 act_ 前缀以便匹配 Account 表
                normalizedAccountId: {
                    $cond: {
                        if: { $eq: [{ $substr: ['$_id', 0, 4] }, 'act_'] },
                        then: { $substr: ['$_id', 4, -1] },
                        else: '$_id',
                    },
                },
            },
        },
        {
            $lookup: {
                from: 'accounts',
                localField: 'normalizedAccountId',
                foreignField: 'accountId',
                as: 'account',
            },
        },
        {
            $project: {
                _id: 0,
                accountId: '$_id',
                accountName: { $arrayElemAt: ['$account.name', 0] },
                spend: 1,
                impressions: 1,
                clicks: 1,
                installs: 1,
                purchase_value: 1,
                ctr: {
                    $cond: [
                        { $gt: ['$impressions', 0] },
                        { $multiply: [{ $divide: ['$clicks', '$impressions'] }, 100] },
                        0,
                    ],
                },
                cpm: {
                    $cond: [
                        { $gt: ['$impressions', 0] },
                        { $multiply: [{ $divide: ['$spend', '$impressions'] }, 1000] },
                        0,
                    ],
                },
                cpc: {
                    $cond: [{ $gt: ['$clicks', 0] }, { $divide: ['$spend', '$clicks'] }, 0],
                },
                cpi: {
                    $cond: [{ $gt: ['$installs', 0] }, { $divide: ['$spend', '$installs'] }, 0],
                },
                roas: {
                    $cond: [
                        { $and: [{ $gt: ['$spend', 0] }, { $gt: ['$purchase_value', 0] }] },
                        { $divide: ['$purchase_value', '$spend'] },
                        0,
                    ],
                },
            },
        },
    ]);
    return data;
}
