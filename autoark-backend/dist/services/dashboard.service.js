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
