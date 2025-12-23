"use strict";
/**
 * 📊 Summary Controller - 使用预聚合表提供极速数据访问
 *
 * 架构设计：
 * - 前端请求 → 直接读取预聚合表（MongoDB）
 * - 定时任务（每10分钟）→ 从 Facebook API 刷新数据到预聚合表
 * - 前端请求不再触发 Facebook API 调用
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const dayjs_1 = __importDefault(require("dayjs"));
const logger_1 = __importDefault(require("../utils/logger"));
const Aggregation_1 = require("../models/Aggregation");
const MaterialMetrics_1 = __importDefault(require("../models/MaterialMetrics"));
const aggregation_service_1 = require("../services/aggregation.service");
const auth_1 = require("../middlewares/auth");
const router = (0, express_1.Router)();
// 所有路由需要认证
router.use(auth_1.authenticate);
// ==================== 仪表盘汇总 ====================
/**
 * 获取仪表盘汇总数据（从预聚合表读取）
 * GET /api/summary/dashboard
 * Query: date (可选，默认今天), startDate, endDate
 */
router.get('/dashboard', async (req, res) => {
    try {
        const startTime = Date.now();
        const date = req.query.date || (0, dayjs_1.default)().format('YYYY-MM-DD');
        const startDate = req.query.startDate || date;
        const endDate = req.query.endDate || date;
        // 从预聚合表读取
        const dailyData = await Aggregation_1.AggDaily.find({
            date: { $gte: startDate, $lte: endDate }
        }).lean();
        // 汇总多日数据
        let totalSpend = 0;
        let totalRevenue = 0;
        let totalImpressions = 0;
        let totalClicks = 0;
        let totalInstalls = 0;
        let activeCampaigns = 0;
        let activeAccounts = 0;
        for (const day of dailyData) {
            totalSpend += day.spend || 0;
            totalRevenue += day.revenue || 0;
            totalImpressions += day.impressions || 0;
            totalClicks += day.clicks || 0;
            totalInstalls += day.installs || 0;
            activeCampaigns = Math.max(activeCampaigns, day.activeCampaigns || 0);
            activeAccounts = Math.max(activeAccounts, day.activeAccounts || 0);
        }
        // 计算派生指标
        const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
        const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
        const cpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
        const cpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0;
        const cpi = totalInstalls > 0 ? totalSpend / totalInstalls : 0;
        const duration = Date.now() - startTime;
        logger_1.default.info(`[Summary] Dashboard query completed in ${duration}ms`);
        res.json({
            success: true,
            data: {
                date,
                totalSpend,
                totalRevenue,
                totalImpressions,
                totalClicks,
                totalInstalls,
                roas,
                ctr,
                cpc,
                cpm,
                cpi,
                activeCampaigns,
                activeAccounts,
            },
            cached: true,
            duration,
        });
    }
    catch (error) {
        logger_1.default.error('[SummaryController] Get dashboard failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * 获取仪表盘趋势数据（最近N天）
 * GET /api/summary/dashboard/trend
 * Query: days (默认7)
 */
router.get('/dashboard/trend', async (req, res) => {
    try {
        const startTime = Date.now();
        const days = parseInt(req.query.days) || 7;
        const endDate = (0, dayjs_1.default)().format('YYYY-MM-DD');
        const startDate = (0, dayjs_1.default)().subtract(days - 1, 'day').format('YYYY-MM-DD');
        // 从预聚合表读取
        const dailyData = await Aggregation_1.AggDaily.find({
            date: { $gte: startDate, $lte: endDate }
        }).sort({ date: 1 }).lean();
        // 生成完整日期数组（填充缺失日期）
        const dateMap = new Map();
        for (const day of dailyData) {
            dateMap.set(day.date, day);
        }
        const trendData = [];
        for (let i = 0; i < days; i++) {
            const date = (0, dayjs_1.default)().subtract(days - 1 - i, 'day').format('YYYY-MM-DD');
            const data = dateMap.get(date);
            trendData.push({
                date,
                totalSpend: data?.spend || 0,
                totalRevenue: data?.revenue || 0,
                totalImpressions: data?.impressions || 0,
                totalClicks: data?.clicks || 0,
                roas: data?.roas || 0,
            });
        }
        const duration = Date.now() - startTime;
        logger_1.default.info(`[Summary] Dashboard trend query completed in ${duration}ms`);
        res.json({
            success: true,
            data: trendData,
            cached: true,
            duration,
        });
    }
    catch (error) {
        logger_1.default.error('[SummaryController] Get dashboard trend failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== 账户汇总 ====================
/**
 * 获取账户汇总数据（从预聚合表读取）
 * GET /api/summary/accounts
 * Query: date, startDate, endDate, sortBy, order, limit, page
 */
router.get('/accounts', async (req, res) => {
    try {
        const startTime = Date.now();
        const today = (0, dayjs_1.default)().format('YYYY-MM-DD');
        const startDate = req.query.startDate || req.query.date || today;
        const endDate = req.query.endDate || req.query.date || today;
        const sortBy = req.query.sortBy || 'spend';
        const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
        const limit = parseInt(req.query.limit) || 100;
        const page = parseInt(req.query.page) || 1;
        const skip = (page - 1) * limit;
        // 提取筛选条件
        const optimizer = req.query.optimizer;
        const status = req.query.status;
        const accountId = req.query.accountId;
        const name = req.query.name;
        // 用户数据隔离
        const userAccountIds = await (0, auth_1.getUserAccountIds)(req);
        // 构建查询条件
        const match = { date: { $gte: startDate, $lte: endDate } };
        // 用户隔离：非超管只能看到自己关联的账户
        if (userAccountIds !== null) {
            if (userAccountIds.length === 0) {
                return res.json({
                    success: true,
                    data: [],
                    pagination: { page, limit, total: 0, pages: 0 },
                    cached: true,
                });
            }
            match.accountId = { $in: userAccountIds };
        }
        if (status)
            match.status = status;
        if (accountId)
            match.accountId = { $regex: accountId, $options: 'i' };
        if (name)
            match.accountName = { $regex: name, $options: 'i' };
        // 多日聚合
        const aggregated = await Aggregation_1.AggAccount.aggregate([
            { $match: match },
            {
                $group: {
                    _id: '$accountId',
                    accountId: { $first: '$accountId' },
                    accountName: { $first: '$accountName' },
                    status: { $first: '$status' },
                    spend: { $sum: '$spend' },
                    revenue: { $sum: '$revenue' },
                    impressions: { $sum: '$impressions' },
                    clicks: { $sum: '$clicks' },
                    installs: { $sum: '$installs' },
                    campaigns: { $max: '$campaigns' },
                }
            },
            {
                $addFields: {
                    roas: { $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$revenue', '$spend'] }, 0] },
                    // 返回小数形式（0.0237），前端 formatPercent 会乘以 100
                    ctr: { $cond: [{ $gt: ['$impressions', 0] }, { $divide: ['$clicks', '$impressions'] }, 0] },
                    periodSpend: '$spend', // 兼容前端字段名
                    name: '$accountName', // 兼容前端字段名
                    id: '$accountId', // 兼容前端字段名
                    purchase_value: '$revenue', // 兼容前端字段名
                }
            },
            { $sort: { [sortBy === 'periodSpend' ? 'spend' : sortBy]: sortOrder } },
            {
                $facet: {
                    data: [{ $skip: skip }, { $limit: limit }],
                    total: [{ $count: 'count' }],
                }
            }
        ]);
        const data = aggregated[0]?.data || [];
        const total = aggregated[0]?.total[0]?.count || 0;
        const duration = Date.now() - startTime;
        logger_1.default.info(`[Summary] Accounts query completed in ${duration}ms, found ${total} accounts`);
        res.json({
            success: true,
            data,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
            cached: true,
            duration,
        });
    }
    catch (error) {
        logger_1.default.error('[SummaryController] Get accounts failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== 国家汇总 ====================
/**
 * 获取国家汇总数据（从预聚合表读取）
 * GET /api/summary/countries
 * Query: date, startDate, endDate, sortBy, order, limit, page
 */
router.get('/countries', async (req, res) => {
    try {
        const startTime = Date.now();
        const today = (0, dayjs_1.default)().format('YYYY-MM-DD');
        const startDate = req.query.startDate || today;
        const endDate = req.query.endDate || today;
        const sortBy = req.query.sortBy || 'spend';
        const sortOrder = req.query.order === 'asc' ? 1 : -1;
        const limit = parseInt(req.query.limit) || 50;
        const page = parseInt(req.query.page) || 1;
        const skip = (page - 1) * limit;
        // 多日聚合
        const aggregated = await Aggregation_1.AggCountry.aggregate([
            { $match: { date: { $gte: startDate, $lte: endDate } } },
            {
                $group: {
                    _id: '$country',
                    country: { $first: '$country' },
                    countryName: { $first: '$countryName' },
                    spend: { $sum: '$spend' },
                    revenue: { $sum: '$revenue' },
                    impressions: { $sum: '$impressions' },
                    clicks: { $sum: '$clicks' },
                    installs: { $sum: '$installs' },
                    campaigns: { $max: '$campaigns' },
                }
            },
            {
                $addFields: {
                    roas: { $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$revenue', '$spend'] }, 0] },
                    // 返回小数形式（0.0237），前端 formatPercent 会乘以 100
                    ctr: { $cond: [{ $gt: ['$impressions', 0] }, { $divide: ['$clicks', '$impressions'] }, 0] },
                    // 兼容前端字段名
                    purchase_value: '$revenue',
                    purchase_roas: { $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$revenue', '$spend'] }, 0] },
                }
            },
            { $sort: { [sortBy]: sortOrder } },
            {
                $facet: {
                    data: [{ $skip: skip }, { $limit: limit }],
                    total: [{ $count: 'count' }],
                }
            }
        ]);
        const data = aggregated[0]?.data || [];
        const total = aggregated[0]?.total[0]?.count || 0;
        const duration = Date.now() - startTime;
        logger_1.default.info(`[Summary] Countries query completed in ${duration}ms, found ${total} countries`);
        res.json({
            success: true,
            data,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
            cached: true,
            duration,
        });
    }
    catch (error) {
        logger_1.default.error('[SummaryController] Get countries failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== 广告系列汇总 ====================
/**
 * 获取广告系列汇总数据（从预聚合表读取）
 * GET /api/summary/campaigns
 * Query: date, startDate, endDate, accountId, status, sortBy, order, limit, page
 */
router.get('/campaigns', async (req, res) => {
    try {
        const startTime = Date.now();
        const today = (0, dayjs_1.default)().format('YYYY-MM-DD');
        const startDate = req.query.startDate || today;
        const endDate = req.query.endDate || today;
        const accountId = req.query.accountId;
        const status = req.query.status;
        const name = req.query.name;
        const sortBy = req.query.sortBy || 'spend';
        const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
        const limit = parseInt(req.query.limit) || 50;
        const page = parseInt(req.query.page) || 1;
        const skip = (page - 1) * limit;
        // 用户数据隔离
        const userAccountIds = await (0, auth_1.getUserAccountIds)(req);
        // 构建查询条件
        const match = { date: { $gte: startDate, $lte: endDate } };
        // 用户隔离：非超管只能看到自己关联账户的广告系列
        if (userAccountIds !== null) {
            if (userAccountIds.length === 0) {
                return res.json({
                    success: true,
                    data: [],
                    pagination: { page, limit, total: 0, pages: 0 },
                    cached: true,
                });
            }
            match.accountId = { $in: userAccountIds };
        }
        if (accountId)
            match.accountId = accountId;
        if (status)
            match.status = status;
        if (name)
            match.campaignName = { $regex: name, $options: 'i' };
        // 多日聚合
        const aggregated = await Aggregation_1.AggCampaign.aggregate([
            { $match: match },
            {
                $group: {
                    _id: '$campaignId',
                    campaignId: { $first: '$campaignId' },
                    campaignName: { $first: '$campaignName' },
                    accountId: { $first: '$accountId' },
                    accountName: { $first: '$accountName' },
                    optimizer: { $first: '$optimizer' },
                    status: { $first: '$status' },
                    objective: { $first: '$objective' },
                    spend: { $sum: '$spend' },
                    revenue: { $sum: '$revenue' },
                    impressions: { $sum: '$impressions' },
                    clicks: { $sum: '$clicks' },
                    installs: { $sum: '$installs' },
                }
            },
            {
                $addFields: {
                    roas: { $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$revenue', '$spend'] }, 0] },
                    // 返回小数形式（0.0237），前端 formatPercent 会乘以 100
                    ctr: { $cond: [{ $gt: ['$impressions', 0] }, { $divide: ['$clicks', '$impressions'] }, 0] },
                    cpc: { $cond: [{ $gt: ['$clicks', 0] }, { $divide: ['$spend', '$clicks'] }, 0] },
                    cpm: { $cond: [{ $gt: ['$impressions', 0] }, { $multiply: [{ $divide: ['$spend', '$impressions'] }, 1000] }, 0] },
                    cpi: { $cond: [{ $gt: ['$installs', 0] }, { $divide: ['$spend', '$installs'] }, 0] },
                    // 兼容前端字段名
                    name: '$campaignName',
                    id: '$campaignId',
                    account_id: '$accountId',
                    purchase_value: '$revenue',
                    purchase_roas: { $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$revenue', '$spend'] }, 0] },
                    mobile_app_install: '$installs',
                }
            },
            { $sort: { [sortBy]: sortOrder } },
            {
                $facet: {
                    data: [{ $skip: skip }, { $limit: limit }],
                    total: [{ $count: 'count' }],
                }
            }
        ]);
        const data = aggregated[0]?.data || [];
        const total = aggregated[0]?.total[0]?.count || 0;
        const duration = Date.now() - startTime;
        logger_1.default.info(`[Summary] Campaigns query completed in ${duration}ms, found ${total} campaigns`);
        res.json({
            success: true,
            data,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
            cached: true,
            duration,
        });
    }
    catch (error) {
        logger_1.default.error('[SummaryController] Get campaigns failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== 素材汇总 ====================
/**
 * 获取素材汇总数据（从 MaterialMetrics 表读取）
 * GET /api/summary/materials
 * Query: startDate, endDate, type, sortBy, order, limit, page
 */
router.get('/materials', async (req, res) => {
    try {
        const startTime = Date.now();
        const today = (0, dayjs_1.default)().format('YYYY-MM-DD');
        const startDate = req.query.startDate || (0, dayjs_1.default)().subtract(6, 'day').format('YYYY-MM-DD');
        const endDate = req.query.endDate || today;
        const materialType = req.query.type;
        const sortBy = req.query.sortBy || 'spend';
        const order = req.query.order === 'asc' ? 1 : -1;
        const limit = parseInt(req.query.limit) || 50;
        const page = parseInt(req.query.page) || 1;
        const skip = (page - 1) * limit;
        const match = {
            date: { $gte: startDate, $lte: endDate },
            spend: { $gt: 0 } // 只返回有消耗的素材
        };
        if (materialType)
            match.materialType = materialType;
        // 多日聚合（使用 MaterialMetrics 表）
        const aggregated = await MaterialMetrics_1.default.aggregate([
            { $match: match },
            {
                $group: {
                    _id: { $ifNull: ['$materialId', { $ifNull: ['$imageHash', '$videoId'] }] },
                    materialId: { $first: '$materialId' },
                    materialName: { $first: '$materialName' },
                    materialType: { $first: '$materialType' },
                    thumbnailUrl: { $first: '$thumbnailUrl' },
                    localStorageUrl: { $first: '$localStorageUrl' },
                    spend: { $sum: '$spend' },
                    revenue: { $sum: '$purchaseValue' },
                    impressions: { $sum: '$impressions' },
                    clicks: { $sum: '$clicks' },
                    installs: { $sum: '$installs' },
                    purchases: { $sum: '$purchases' },
                    adIds: { $addToSet: '$adIds' },
                    campaignIds: { $addToSet: '$campaignIds' },
                    qualityScore: { $avg: '$qualityScore' },
                    daysActive: { $sum: 1 },
                }
            },
            {
                $addFields: {
                    roas: { $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$revenue', '$spend'] }, 0] },
                    ctr: { $cond: [{ $gt: ['$impressions', 0] }, { $multiply: [{ $divide: ['$clicks', '$impressions'] }, 100] }, 0] },
                    cpc: { $cond: [{ $gt: ['$clicks', 0] }, { $divide: ['$spend', '$clicks'] }, 0] },
                    cpm: { $cond: [{ $gt: ['$impressions', 0] }, { $multiply: [{ $divide: ['$spend', '$impressions'] }, 1000] }, 0] },
                    cpi: { $cond: [{ $gt: ['$installs', 0] }, { $divide: ['$spend', '$installs'] }, 0] },
                    adsCount: { $size: { $reduce: { input: '$adIds', initialValue: [], in: { $setUnion: ['$$value', '$$this'] } } } },
                    campaignsCount: { $size: { $reduce: { input: '$campaignIds', initialValue: [], in: { $setUnion: ['$$value', '$$this'] } } } },
                }
            },
            { $sort: { [sortBy]: order } },
            {
                $facet: {
                    data: [{ $skip: skip }, { $limit: limit }],
                    total: [{ $count: 'count' }],
                }
            }
        ]);
        const data = aggregated[0]?.data || [];
        const total = aggregated[0]?.total[0]?.count || 0;
        const duration = Date.now() - startTime;
        logger_1.default.info(`[Summary] Materials query completed in ${duration}ms, found ${total} materials`);
        res.json({
            success: true,
            data,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
            cached: true,
            duration,
        });
    }
    catch (error) {
        logger_1.default.error('[SummaryController] Get materials failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== 管理接口 ====================
/**
 * 获取聚合状态
 * GET /api/summary/status
 */
router.get('/status', async (req, res) => {
    try {
        const today = (0, dayjs_1.default)().format('YYYY-MM-DD');
        // 检查各表最新数据
        const [latestDaily, latestCampaign, latestAccount, latestCountry] = await Promise.all([
            Aggregation_1.AggDaily.findOne().sort({ updatedAt: -1 }).select('date updatedAt').lean(),
            Aggregation_1.AggCampaign.findOne().sort({ updatedAt: -1 }).select('date updatedAt').lean(),
            Aggregation_1.AggAccount.findOne().sort({ updatedAt: -1 }).select('date updatedAt').lean(),
            Aggregation_1.AggCountry.findOne().sort({ updatedAt: -1 }).select('date updatedAt').lean(),
        ]);
        res.json({
            success: true,
            data: {
                currentDate: today,
                tables: {
                    AggDaily: { latestDate: latestDaily?.date, updatedAt: latestDaily?.updatedAt },
                    AggCampaign: { latestDate: latestCampaign?.date, updatedAt: latestCampaign?.updatedAt },
                    AggAccount: { latestDate: latestAccount?.date, updatedAt: latestAccount?.updatedAt },
                    AggCountry: { latestDate: latestCountry?.date, updatedAt: latestCountry?.updatedAt },
                },
                refreshInterval: '10 minutes',
            }
        });
    }
    catch (error) {
        logger_1.default.error('[SummaryController] Get status failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * 手动触发刷新
 * POST /api/summary/refresh
 * Body: { days?: number }
 */
router.post('/refresh', async (req, res) => {
    try {
        const startTime = Date.now();
        logger_1.default.info('[SummaryController] Manual refresh triggered');
        await (0, aggregation_service_1.refreshRecentDays)();
        const duration = Date.now() - startTime;
        res.json({
            success: true,
            message: `聚合数据已刷新`,
            duration,
        });
    }
    catch (error) {
        logger_1.default.error('[SummaryController] Manual refresh failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.default = router;
