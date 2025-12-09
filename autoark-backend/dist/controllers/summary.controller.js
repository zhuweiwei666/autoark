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
const express_1 = require("express");
const dayjs_1 = __importDefault(require("dayjs"));
const logger_1 = __importDefault(require("../utils/logger"));
const Summary_1 = require("../models/Summary");
const summaryAggregation_service_1 = require("../services/summaryAggregation.service");
const User_1 = require("../models/User");
const router = (0, express_1.Router)();
// ==================== 仪表盘汇总 ====================
/**
 * 获取仪表盘汇总数据（实时聚合，确保数据完整性）
 * GET /api/summary/dashboard
 * Query: date (可选，默认今天), startDate, endDate
 */
router.get('/dashboard', async (req, res) => {
    try {
        const date = req.query.date || (0, dayjs_1.default)().format('YYYY-MM-DD');
        const startDate = req.query.startDate || date;
        const endDate = req.query.endDate || date;
        // 使用 getCampaigns service 获取完整数据（有缓存）
        const { getCampaigns } = await Promise.resolve().then(() => __importStar(require('../services/facebook.campaigns.service')));
        const campaigns = await getCampaigns({ startDate, endDate }, { page: 1, limit: 10000, sortBy: 'spend', sortOrder: 'desc' });
        // 手动聚合数据
        let totalSpend = 0;
        let totalRevenue = 0;
        let totalImpressions = 0;
        let totalClicks = 0;
        let totalInstalls = 0;
        let totalPurchases = 0;
        for (const campaign of campaigns.data || []) {
            totalSpend += campaign.spend || 0;
            totalRevenue += campaign.purchase_value || 0;
            totalImpressions += campaign.impressions || 0;
            totalClicks += campaign.clicks || 0;
            totalInstalls += campaign.mobile_app_install || 0;
            totalPurchases += campaign.purchase || campaign.omni_purchase || 0;
        }
        // 计算派生指标
        const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
        const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
        const cpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
        const cpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0;
        const cpi = totalInstalls > 0 ? totalSpend / totalInstalls : 0;
        res.json({
            success: true,
            data: {
                date,
                totalSpend,
                totalRevenue,
                totalImpressions,
                totalClicks,
                totalInstalls,
                totalPurchases,
                roas,
                ctr,
                cpc,
                cpm,
                cpi,
                activeCampaigns: campaigns.pagination.total,
            },
            cached: false,
            realtime: true,
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
 *
 * 策略：并行查询每一天的汇总
 */
router.get('/dashboard/trend', async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 7;
        const endDate = (0, dayjs_1.default)().format('YYYY-MM-DD');
        const startDate = (0, dayjs_1.default)().subtract(days - 1, 'day').format('YYYY-MM-DD');
        // 生成日期数组
        const dates = [];
        for (let i = 0; i < days; i++) {
            dates.push((0, dayjs_1.default)().subtract(days - 1 - i, 'day').format('YYYY-MM-DD'));
        }
        // 并行查询每一天的数据（直接调用内部函数避免 HTTP 请求）
        const { getCampaigns } = await Promise.resolve().then(() => __importStar(require('../services/facebook.campaigns.service')));
        const promises = dates.map(async (date) => {
            try {
                const campaigns = await getCampaigns({ startDate: date, endDate: date }, { page: 1, limit: 10000, sortBy: 'spend', sortOrder: 'desc' });
                let totalSpend = 0;
                let totalRevenue = 0;
                let totalImpressions = 0;
                let totalClicks = 0;
                for (const campaign of campaigns.data || []) {
                    totalSpend += campaign.spend || 0;
                    totalRevenue += campaign.purchase_value || 0;
                    totalImpressions += campaign.impressions || 0;
                    totalClicks += campaign.clicks || 0;
                }
                return {
                    date,
                    totalSpend,
                    totalRevenue,
                    totalImpressions,
                    totalClicks,
                    roas: totalSpend > 0 ? totalRevenue / totalSpend : 0,
                };
            }
            catch (error) {
                logger_1.default.error(`Failed to get dashboard data for ${date}:`, error);
                return {
                    date,
                    totalSpend: 0,
                    totalRevenue: 0,
                    totalImpressions: 0,
                    totalClicks: 0,
                    roas: 0,
                };
            }
        });
        const results = await Promise.all(promises);
        const trendData = results;
        res.json({
            success: true,
            data: trendData,
            cached: false,
            realtime: true,
        });
    }
    catch (error) {
        logger_1.default.error('[SummaryController] Get dashboard trend failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== 账户汇总 ====================
/**
 * 获取账户汇总数据（智能路由：直接使用完整数据服务）
 * GET /api/summary/accounts
 * Query: date, startDate, endDate, sortBy, order, limit, page
 *
 * 策略：直接调用 getAccounts service（有缓存+完整数据）
 */
router.get('/accounts', async (req, res) => {
    try {
        const today = (0, dayjs_1.default)().format('YYYY-MM-DD');
        const startDate = req.query.startDate || req.query.date || today;
        const endDate = req.query.endDate || req.query.date || today;
        const sortBy = req.query.sortBy || 'periodSpend';
        const sortOrder = req.query.order === 'asc' ? 'asc' : 'desc';
        const limit = parseInt(req.query.limit) || 100;
        const page = parseInt(req.query.page) || 1;
        // 组织隔离：超管可见全部，其他用户只能看本组织
        const organizationId = req.user?.role === User_1.UserRole.SUPER_ADMIN ? undefined : req.user?.organizationId;
        // 直接使用完整的 getAccounts service
        const { getAccounts } = await Promise.resolve().then(() => __importStar(require('../services/facebook.accounts.service')));
        const result = await getAccounts({ startDate, endDate }, { page, limit, sortBy, sortOrder }, organizationId);
        res.json({
            success: true,
            data: result.data || [],
            pagination: result.pagination,
        });
    }
    catch (error) {
        logger_1.default.error('[SummaryController] Get accounts failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== 国家汇总 ====================
/**
 * 获取国家汇总数据（智能路由：直接使用完整数据服务）
 * GET /api/summary/countries
 * Query: date, startDate, endDate, sortBy, order, limit, page
 *
 * 策略：直接调用 getCountries service（有缓存+完整数据）
 */
router.get('/countries', async (req, res) => {
    try {
        const today = (0, dayjs_1.default)().format('YYYY-MM-DD');
        const startDate = req.query.startDate || today;
        const endDate = req.query.endDate || today;
        const sortBy = req.query.sortBy || 'spend';
        const sortOrder = req.query.order === 'asc' ? 'asc' : 'desc';
        const limit = parseInt(req.query.limit) || 50;
        const page = parseInt(req.query.page) || 1;
        // 直接使用完整的 getCountries service
        const { getCountries } = await Promise.resolve().then(() => __importStar(require('../services/facebook.countries.service')));
        const result = await getCountries({ startDate, endDate }, { page, limit, sortBy, sortOrder });
        res.json({
            success: true,
            data: result.data || [],
            pagination: result.pagination,
        });
    }
    catch (error) {
        logger_1.default.error('[SummaryController] Get countries failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== 广告系列汇总 ====================
/**
 * 获取广告系列汇总数据（智能路由：直接使用完整数据服务）
 * GET /api/summary/campaigns
 * Query: date, startDate, endDate, accountId, status, sortBy, order, limit, page
 *
 * 策略：直接调用 getCampaigns service（有Redis缓存+完整数据）
 */
router.get('/campaigns', async (req, res) => {
    try {
        const today = (0, dayjs_1.default)().format('YYYY-MM-DD');
        const startDate = req.query.startDate || today;
        const endDate = req.query.endDate || today;
        const accountId = req.query.accountId;
        const status = req.query.status;
        const sortBy = req.query.sortBy || 'spend';
        const sortOrder = req.query.order === 'asc' ? 'asc' : 'desc';
        const limit = parseInt(req.query.limit) || 50;
        const page = parseInt(req.query.page) || 1;
        // 直接使用完整的 getCampaigns service（有缓存+实时数据）
        const { getCampaigns } = await Promise.resolve().then(() => __importStar(require('../services/facebook.campaigns.service')));
        const result = await getCampaigns({ startDate, endDate, accountId, status }, { page, limit, sortBy, sortOrder });
        res.json({
            success: true,
            data: result.data || [],
            pagination: result.pagination,
        });
    }
    catch (error) {
        logger_1.default.error('[SummaryController] Get campaigns failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== 素材汇总 ====================
/**
 * 获取素材汇总数据（极速）
 * GET /api/summary/materials
 * Query: startDate, endDate, type, sortBy, order, limit, page
 */
router.get('/materials', async (req, res) => {
    try {
        const today = (0, dayjs_1.default)().format('YYYY-MM-DD');
        const startDate = req.query.startDate || (0, dayjs_1.default)().subtract(6, 'day').format('YYYY-MM-DD');
        const endDate = req.query.endDate || today;
        const materialType = req.query.type;
        const sortBy = req.query.sortBy || 'spend';
        const order = req.query.order === 'asc' ? 1 : -1;
        const limit = parseInt(req.query.limit) || 50;
        const page = parseInt(req.query.page) || 1;
        const skip = (page - 1) * limit;
        const match = { date: { $gte: startDate, $lte: endDate } };
        if (materialType)
            match.materialType = materialType;
        // 多日聚合
        const aggregated = await Summary_1.MaterialSummary.aggregate([
            { $match: match },
            {
                $group: {
                    _id: '$materialKey',
                    materialKey: { $first: '$materialKey' },
                    materialType: { $first: '$materialType' },
                    materialName: { $first: '$materialName' },
                    thumbnailUrl: { $first: '$thumbnailUrl' },
                    localStorageUrl: { $first: '$localStorageUrl' },
                    spend: { $sum: '$spend' },
                    revenue: { $sum: '$revenue' },
                    impressions: { $sum: '$impressions' },
                    clicks: { $sum: '$clicks' },
                    installs: { $sum: '$installs' },
                    purchases: { $sum: '$purchases' },
                    adCount: { $max: '$adCount' },
                    campaignCount: { $max: '$campaignCount' },
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
        res.json({
            success: true,
            data,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
            cached: true,
        });
    }
    catch (error) {
        logger_1.default.error('[SummaryController] Get materials failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== 管理接口 ====================
/**
 * 获取汇总状态
 * GET /api/summary/status
 */
router.get('/status', async (req, res) => {
    try {
        const status = await (0, summaryAggregation_service_1.getSummaryStatus)();
        res.json({ success: true, data: status });
    }
    catch (error) {
        logger_1.default.error('[SummaryController] Get status failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * 手动触发刷新
 * POST /api/summary/refresh
 * Body: { date?: string, type?: 'all' | 'dashboard' | 'country' | 'campaign' | 'material' }
 */
router.post('/refresh', async (req, res) => {
    try {
        const { date, type = 'all' } = req.body;
        const targetDate = date || (0, dayjs_1.default)().format('YYYY-MM-DD');
        logger_1.default.info(`[SummaryController] Manual refresh triggered: ${type} for ${targetDate}`);
        if (type === 'all') {
            const result = await (0, summaryAggregation_service_1.refreshAllSummaries)(targetDate);
            return res.json({ success: true, data: result, message: `全部汇总已刷新 (${result.duration}ms)` });
        }
        switch (type) {
            case 'dashboard':
                await (0, summaryAggregation_service_1.refreshDashboardSummary)(targetDate);
                break;
            case 'country':
                await (0, summaryAggregation_service_1.refreshCountrySummary)(targetDate);
                break;
            case 'campaign':
                await (0, summaryAggregation_service_1.refreshCampaignSummary)(targetDate);
                break;
            case 'material':
                await (0, summaryAggregation_service_1.refreshMaterialSummary)(targetDate);
                break;
            default:
                return res.status(400).json({ success: false, error: 'Invalid type' });
        }
        res.json({ success: true, message: `${type} 汇总已刷新` });
    }
    catch (error) {
        logger_1.default.error('[SummaryController] Manual refresh failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.default = router;
