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
const mongoose_1 = __importDefault(require("mongoose"));
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
 */
async function getCoreMetrics() {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    // 今日数据
    const todayData = await models_1.MetricsDaily.aggregate([
        { $match: { date: today } },
        {
            $group: {
                _id: null,
                spend: { $sum: '$spendUsd' },
                impressions: { $sum: '$impressions' },
                clicks: { $sum: '$clicks' },
                installs: { $sum: '$installs' },
                purchase_value: { $sum: '$purchase_value' },
            },
        },
    ]);
    // 昨日数据
    const yesterdayData = await models_1.MetricsDaily.aggregate([
        { $match: { date: yesterday } },
        {
            $group: {
                _id: null,
                spend: { $sum: '$spendUsd' },
                impressions: { $sum: '$impressions' },
                clicks: { $sum: '$clicks' },
                installs: { $sum: '$installs' },
                purchase_value: { $sum: '$purchase_value' },
            },
        },
    ]);
    // 7日数据
    const sevenDaysData = await models_1.MetricsDaily.aggregate([
        { $match: { date: { $gte: sevenDaysAgo, $lte: today } } },
        {
            $group: {
                _id: null,
                spend: { $sum: '$spendUsd' },
                impressions: { $sum: '$impressions' },
                clicks: { $sum: '$clicks' },
                installs: { $sum: '$installs' },
                purchase_value: { $sum: '$purchase_value' },
            },
        },
    ]);
    const todayMetrics = todayData[0] || { spend: 0, impressions: 0, clicks: 0, installs: 0, purchase_value: 0 };
    const yesterdayMetrics = yesterdayData[0] || { spend: 0, impressions: 0, clicks: 0, installs: 0, purchase_value: 0 };
    const sevenDaysMetrics = sevenDaysData[0] || { spend: 0, impressions: 0, clicks: 0, installs: 0, purchase_value: 0 };
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
        },
        sevenDays: {
            spend: sevenDaysMetrics.spend,
            impressions: sevenDaysMetrics.impressions,
            clicks: sevenDaysMetrics.clicks,
            installs: sevenDaysMetrics.installs,
            avgDailySpend: sevenDaysMetrics.spend / 7,
        },
    };
}
/**
 * 获取今日消耗趋势（按小时）- 由于数据是按天存储的，这里返回最近7天的趋势
 */
async function getTodaySpendTrend() {
    const today = new Date().toISOString().split('T')[0];
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const data = await models_1.MetricsDaily.aggregate([
        { $match: { date: { $gte: sevenDaysAgo, $lte: today } } },
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
 */
async function getCampaignSpendRanking(limit = 10) {
    const today = new Date().toISOString().split('T')[0];
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const data = await models_1.MetricsDaily.aggregate([
        { $match: { date: { $gte: sevenDaysAgo, $lte: today }, campaignId: { $exists: true, $ne: null } } },
        {
            $group: {
                _id: '$campaignId',
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
            $lookup: {
                from: 'campaigns',
                localField: '_id',
                foreignField: 'campaignId',
                as: 'campaign',
            },
        },
        {
            $project: {
                _id: 0,
                campaignId: '$_id',
                campaignName: { $arrayElemAt: ['$campaign.name', 0] },
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
/**
 * 获取分国家消耗排行
 */
async function getCountrySpendRanking(limit = 10) {
    const today = new Date().toISOString().split('T')[0];
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    // 注意：MetricsDaily 中没有 country 字段，需要从 Campaign 或其他地方获取
    // 这里先返回按 accountId 分组的数据，后续可以扩展
    const data = await models_1.MetricsDaily.aggregate([
        { $match: { date: { $gte: sevenDaysAgo, $lte: today } } },
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
            $lookup: {
                from: 'accounts',
                localField: '_id',
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
