"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getByAdSet = exports.getByCountry = exports.getDaily = void 0;
const models_1 = require("../models");
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
                // Ideally we should join with AdSet collection to get the name,
                // but for now we assume we might group by ID.
                // If names are needed, a $lookup would be required or storing name in MetricsDaily.
                // Assuming we return ID for now.
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
