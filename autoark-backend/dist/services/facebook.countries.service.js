"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCountries = void 0;
const Campaign_1 = __importDefault(require("../models/Campaign"));
const MetricsDaily_1 = __importDefault(require("../models/MetricsDaily"));
const dayjs_1 = __importDefault(require("dayjs"));
const db_1 = require("../config/db");
const mongoose_1 = __importDefault(require("mongoose"));
const getCountries = async (filters = {}, pagination) => {
    // 使用读连接进行查询（读写分离）
    const readConnection = (0, db_1.getReadConnection)();
    // 构建查询条件 - 直接从 MetricsDaily 中按 country 分组
    const metricsQuery = {
        campaignId: { $exists: true, $ne: null }, // 只统计 campaign 级别的数据
        country: { $exists: true, $ne: null } // 只统计有国家信息的数据
    };
    // 如果提供了账户筛选，需要先查找对应的 campaignIds
    if (filters.accountId) {
        let CampaignModel = Campaign_1.default;
        if (readConnection !== mongoose_1.default) {
            if (!readConnection.models.Campaign) {
                CampaignModel = readConnection.model('Campaign', Campaign_1.default.schema);
            }
            else {
                CampaignModel = readConnection.models.Campaign;
            }
        }
        const campaigns = await CampaignModel.find({ accountId: filters.accountId }).lean();
        const campaignIds = campaigns.map(c => c.campaignId);
        if (campaignIds.length === 0) {
            return {
                data: [],
                pagination: {
                    page: pagination.page,
                    limit: pagination.limit,
                    total: 0,
                    pages: 0,
                },
            };
        }
        metricsQuery.campaignId = { $in: campaignIds, $exists: true, $ne: null };
    }
    // 如果提供了广告系列名称筛选，需要先查找对应的 campaignIds
    if (filters.name) {
        let CampaignModel = Campaign_1.default;
        if (readConnection !== mongoose_1.default) {
            if (!readConnection.models.Campaign) {
                CampaignModel = readConnection.model('Campaign', Campaign_1.default.schema);
            }
            else {
                CampaignModel = readConnection.models.Campaign;
            }
        }
        const campaigns = await CampaignModel.find({ name: { $regex: filters.name, $options: 'i' } }).lean();
        const campaignIds = campaigns.map(c => c.campaignId);
        if (campaignIds.length === 0) {
            return {
                data: [],
                pagination: {
                    page: pagination.page,
                    limit: pagination.limit,
                    total: 0,
                    pages: 0,
                },
            };
        }
        if (metricsQuery.campaignId && metricsQuery.campaignId.$in) {
            // 取交集
            metricsQuery.campaignId.$in = metricsQuery.campaignId.$in.filter((id) => campaignIds.includes(id));
        }
        else {
            metricsQuery.campaignId = { $in: campaignIds, $exists: true, $ne: null };
        }
    }
    // 日期筛选
    const today = (0, dayjs_1.default)().format('YYYY-MM-DD');
    if (filters.startDate || filters.endDate) {
        metricsQuery.date = {};
        if (filters.startDate) {
            metricsQuery.date.$gte = filters.startDate;
        }
        if (filters.endDate) {
            metricsQuery.date.$lte = filters.endDate;
        }
    }
    else {
        metricsQuery.date = today;
    }
    // 获取所有国家的 metrics 数据 - 直接从 MetricsDaily 按 country 分组
    let MetricsDailyRead = MetricsDaily_1.default;
    if (readConnection !== mongoose_1.default) {
        if (!readConnection.models.MetricsDaily) {
            MetricsDailyRead = readConnection.model('MetricsDaily', MetricsDaily_1.default.schema);
        }
        else {
            MetricsDailyRead = readConnection.models.MetricsDaily;
        }
    }
    // 按国家聚合数据
    const allMetricsData = await MetricsDailyRead.aggregate([
        { $match: metricsQuery },
        {
            $group: {
                _id: '$country',
                spendUsd: { $sum: '$spendUsd' },
                impressions: { $sum: '$impressions' },
                clicks: { $sum: '$clicks' },
                purchase_value: { $sum: { $ifNull: ['$purchase_value', 0] } },
                mobile_app_install: { $sum: { $ifNull: ['$mobile_app_install_count', 0] } },
                // 计算加权平均值
                totalCpc: { $sum: { $multiply: [{ $ifNull: ['$cpc', 0] }, { $ifNull: ['$clicks', 0] }] } },
                totalCtr: { $sum: { $multiply: [{ $ifNull: ['$ctr', 0] }, { $ifNull: ['$impressions', 0] }] } },
                totalCpm: { $sum: { $multiply: [{ $ifNull: ['$cpm', 0] }, { $ifNull: ['$impressions', 0] }] } },
                totalClicks: { $sum: '$clicks' },
                totalImpressions: { $sum: '$impressions' },
                // 统计该国家的广告系列数量
                campaignIds: { $addToSet: '$campaignId' }
            }
        },
        {
            $project: {
                _id: 0,
                country: '$_id',
                spend: '$spendUsd',
                impressions: 1,
                clicks: 1,
                purchase_value: 1,
                mobile_app_install: 1,
                campaignCount: { $size: '$campaignIds' },
                // 计算平均值
                cpc: {
                    $cond: [
                        { $gt: ['$totalClicks', 0] },
                        { $divide: ['$totalCpc', '$totalClicks'] },
                        0
                    ]
                },
                ctr: {
                    $cond: [
                        { $gt: ['$totalImpressions', 0] },
                        { $divide: ['$totalCtr', '$totalImpressions'] },
                        0
                    ]
                },
                cpm: {
                    $cond: [
                        { $gt: ['$totalImpressions', 0] },
                        { $divide: ['$totalCpm', '$totalImpressions'] },
                        0
                    ]
                },
                purchase_roas: {
                    $cond: [
                        { $and: [{ $gt: ['$spendUsd', 0] }, { $gt: ['$purchase_value', 0] }] },
                        { $divide: ['$purchase_value', '$spendUsd'] },
                        0
                    ]
                }
            }
        }
    ]).allowDiskUse(true);
    const total = allMetricsData.length;
    if (total === 0) {
        return {
            data: [],
            pagination: {
                page: pagination.page,
                limit: pagination.limit,
                total: 0,
                pages: 0,
            },
        };
    }
    // 转换为数组格式
    const countriesWithMetrics = allMetricsData.map((item) => ({
        country: item.country,
        campaignCount: item.campaignCount,
        spend: item.spend || 0,
        impressions: item.impressions || 0,
        clicks: item.clicks || 0,
        cpc: item.cpc || 0,
        ctr: item.ctr || 0,
        cpm: item.cpm || 0,
        purchase_roas: item.purchase_roas || 0,
        purchase_value: item.purchase_value || 0,
        mobile_app_install: item.mobile_app_install || 0,
    }));
    // 判断排序字段是否是 metrics 字段
    const metricsSortFields = ['spend', 'impressions', 'clicks', 'cpc', 'ctr', 'cpm', 'purchase_roas', 'purchase_value', 'mobile_app_install', 'campaignCount'];
    const isMetricsSort = metricsSortFields.includes(pagination.sortBy);
    // 排序
    if (isMetricsSort) {
        countriesWithMetrics.sort((a, b) => {
            const aValue = a[pagination.sortBy] || 0;
            const bValue = b[pagination.sortBy] || 0;
            if (pagination.sortOrder === 'desc') {
                return bValue - aValue;
            }
            else {
                return aValue - bValue;
            }
        });
    }
    else {
        // 按国家代码排序
        countriesWithMetrics.sort((a, b) => {
            const aValue = a.country || '';
            const bValue = b.country || '';
            if (pagination.sortOrder === 'desc') {
                return bValue.localeCompare(aValue);
            }
            else {
                return aValue.localeCompare(bValue);
            }
        });
    }
    // 分页
    const startIndex = (pagination.page - 1) * pagination.limit;
    const paginatedCountries = countriesWithMetrics.slice(startIndex, startIndex + pagination.limit);
    return {
        data: paginatedCountries.map(item => ({
            id: item.country,
            country: item.country,
            campaignCount: item.campaignCount,
            spend: item.spend,
            impressions: item.impressions,
            clicks: item.clicks,
            cpc: item.cpc,
            ctr: item.ctr,
            cpm: item.cpm,
            purchase_roas: item.purchase_roas,
            purchase_value: item.purchase_value,
            mobile_app_install: item.mobile_app_install,
        })),
        pagination: {
            total,
            page: pagination.page,
            limit: pagination.limit,
            pages: Math.ceil(total / pagination.limit)
        }
    };
};
exports.getCountries = getCountries;
