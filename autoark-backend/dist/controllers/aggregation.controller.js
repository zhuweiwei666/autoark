"use strict";
/**
 * 📊 预聚合数据 API
 *
 * 统一的数据接口，前端和 AI 都从这里获取数据
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const dayjs_1 = __importDefault(require("dayjs"));
const logger_1 = __importDefault(require("../utils/logger"));
const aggregation_service_1 = require("../services/aggregation.service");
const Aggregation_1 = require("../models/Aggregation");
const router = (0, express_1.Router)();
// ==================== Dashboard 汇总 ====================
/**
 * GET /api/agg/daily
 * 获取每日汇总数据
 */
router.get('/daily', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const end = endDate || (0, dayjs_1.default)().format('YYYY-MM-DD');
        const start = startDate || (0, dayjs_1.default)().subtract(7, 'day').format('YYYY-MM-DD');
        const data = await (0, aggregation_service_1.getDailySummary)(start, end);
        res.json({
            success: true,
            data,
            meta: { startDate: start, endDate: end, count: data.length },
        });
    }
    catch (error) {
        logger_1.default.error('[AggController] Get daily failed:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * GET /api/agg/today
 * 获取今日数据（直接从数据库读取，超快）
 */
router.get('/today', async (req, res) => {
    try {
        const today = (0, dayjs_1.default)().format('YYYY-MM-DD');
        // 🚀 直接读取，不刷新（刷新由后台定时任务完成）
        const data = await Aggregation_1.AggDaily.findOne({ date: today }).lean();
        res.json({
            success: true,
            data: data || { date: today, spend: 0, revenue: 0, roas: 0 },
        });
    }
    catch (error) {
        logger_1.default.error('[AggController] Get today failed:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== 国家数据 ====================
/**
 * GET /api/agg/countries
 * 获取分国家数据
 */
router.get('/countries', async (req, res) => {
    try {
        const date = req.query.date || (0, dayjs_1.default)().format('YYYY-MM-DD');
        const data = await (0, aggregation_service_1.getCountryData)(date);
        res.json({
            success: true,
            data,
            meta: { date, count: data.length },
        });
    }
    catch (error) {
        logger_1.default.error('[AggController] Get countries failed:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * GET /api/agg/countries/trend
 * 获取国家趋势（最近 7 天）
 */
router.get('/countries/trend', async (req, res) => {
    try {
        const { country } = req.query;
        const endDate = (0, dayjs_1.default)().format('YYYY-MM-DD');
        const startDate = (0, dayjs_1.default)().subtract(7, 'day').format('YYYY-MM-DD');
        const query = { date: { $gte: startDate, $lte: endDate } };
        if (country)
            query.country = country;
        const data = await Aggregation_1.AggCountry.find(query).sort({ date: 1 }).lean();
        res.json({
            success: true,
            data,
            meta: { startDate, endDate, count: data.length },
        });
    }
    catch (error) {
        logger_1.default.error('[AggController] Get country trend failed:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== 账户数据 ====================
/**
 * GET /api/agg/accounts
 * 获取分账户数据
 */
router.get('/accounts', async (req, res) => {
    try {
        const date = req.query.date || (0, dayjs_1.default)().format('YYYY-MM-DD');
        const data = await (0, aggregation_service_1.getAccountData)(date);
        res.json({
            success: true,
            data,
            meta: { date, count: data.length },
        });
    }
    catch (error) {
        logger_1.default.error('[AggController] Get accounts failed:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== 广告系列数据 ====================
/**
 * GET /api/agg/campaigns
 * 获取广告系列数据
 */
router.get('/campaigns', async (req, res) => {
    try {
        const date = req.query.date || (0, dayjs_1.default)().format('YYYY-MM-DD');
        const { optimizer, accountId } = req.query;
        const data = await (0, aggregation_service_1.getCampaignData)(date, {
            optimizer: optimizer,
            accountId: accountId,
        });
        res.json({
            success: true,
            data,
            meta: { date, count: data.length },
        });
    }
    catch (error) {
        logger_1.default.error('[AggController] Get campaigns failed:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * GET /api/agg/campaigns/trend
 * 获取广告系列趋势
 */
router.get('/campaigns/trend', async (req, res) => {
    try {
        const { campaignId } = req.query;
        const endDate = (0, dayjs_1.default)().format('YYYY-MM-DD');
        const startDate = (0, dayjs_1.default)().subtract(7, 'day').format('YYYY-MM-DD');
        const query = { date: { $gte: startDate, $lte: endDate } };
        if (campaignId)
            query.campaignId = campaignId;
        const data = await Aggregation_1.AggCampaign.find(query).sort({ date: 1 }).lean();
        res.json({
            success: true,
            data,
            meta: { startDate, endDate, count: data.length },
        });
    }
    catch (error) {
        logger_1.default.error('[AggController] Get campaign trend failed:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== 投手数据 ====================
/**
 * GET /api/agg/optimizers
 * 获取分投手数据
 */
router.get('/optimizers', async (req, res) => {
    try {
        const date = req.query.date || (0, dayjs_1.default)().format('YYYY-MM-DD');
        const data = await (0, aggregation_service_1.getOptimizerData)(date);
        res.json({
            success: true,
            data,
            meta: { date, count: data.length },
        });
    }
    catch (error) {
        logger_1.default.error('[AggController] Get optimizers failed:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * GET /api/agg/optimizers/trend
 * 获取投手趋势
 */
router.get('/optimizers/trend', async (req, res) => {
    try {
        const { optimizer } = req.query;
        const endDate = (0, dayjs_1.default)().format('YYYY-MM-DD');
        const startDate = (0, dayjs_1.default)().subtract(7, 'day').format('YYYY-MM-DD');
        const query = { date: { $gte: startDate, $lte: endDate } };
        if (optimizer)
            query.optimizer = optimizer;
        const data = await Aggregation_1.AggOptimizer.find(query).sort({ date: 1 }).lean();
        res.json({
            success: true,
            data,
            meta: { startDate, endDate, count: data.length },
        });
    }
    catch (error) {
        logger_1.default.error('[AggController] Get optimizer trend failed:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== 素材数据 ====================
/**
 * GET /api/agg/materials
 * 获取素材数据
 */
router.get('/materials', async (req, res) => {
    try {
        const date = req.query.date || (0, dayjs_1.default)().format('YYYY-MM-DD');
        const data = await (0, aggregation_service_1.getMaterialData)(date);
        res.json({
            success: true,
            data,
            meta: { date, count: data.length },
        });
    }
    catch (error) {
        logger_1.default.error('[AggController] Get materials failed:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== 手动刷新 ====================
/**
 * POST /api/agg/refresh
 * 手动刷新数据
 */
router.post('/refresh', async (req, res) => {
    try {
        const { date } = req.body;
        if (date) {
            await (0, aggregation_service_1.refreshAggregation)(date, true);
            res.json({ success: true, message: `Refreshed ${date}` });
        }
        else {
            await (0, aggregation_service_1.refreshRecentDays)();
            res.json({ success: true, message: 'Refreshed recent 3 days' });
        }
    }
    catch (error) {
        logger_1.default.error('[AggController] Refresh failed:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== AI 数据接口 ====================
/**
 * GET /api/agg/ai/snapshot
 * 获取 AI 使用的数据快照（所有维度）
 * 🚀 直接读取，不刷新
 */
router.get('/ai/snapshot', async (req, res) => {
    try {
        const today = (0, dayjs_1.default)().format('YYYY-MM-DD');
        const yesterday = (0, dayjs_1.default)().subtract(1, 'day').format('YYYY-MM-DD');
        const sevenDaysAgo = (0, dayjs_1.default)().subtract(7, 'day').format('YYYY-MM-DD');
        // 并行获取所有数据（直接从数据库读取）
        const [todaySummary, yesterdaySummary, weekTrend, countries, accounts, campaigns, optimizers,] = await Promise.all([
            Aggregation_1.AggDaily.findOne({ date: today }).lean(),
            Aggregation_1.AggDaily.findOne({ date: yesterday }).lean(),
            Aggregation_1.AggDaily.find({ date: { $gte: sevenDaysAgo } }).sort({ date: 1 }).lean(),
            Aggregation_1.AggCountry.find({ date: today }).sort({ spend: -1 }).limit(15).lean(),
            Aggregation_1.AggAccount.find({ date: today }).sort({ spend: -1 }).lean(),
            Aggregation_1.AggCampaign.find({ date: today, spend: { $gt: 1 } }).sort({ spend: -1 }).limit(50).lean(),
            Aggregation_1.AggOptimizer.find({ date: today }).sort({ spend: -1 }).lean(),
        ]);
        // 计算对比
        const todaySpend = todaySummary?.spend || 0;
        const yesterdaySpend = yesterdaySummary?.spend || 0;
        const spendChange = yesterdaySpend > 0 ? ((todaySpend - yesterdaySpend) / yesterdaySpend * 100).toFixed(1) + '%' : 'N/A';
        res.json({
            success: true,
            data: {
                dataTime: (0, dayjs_1.default)().format('YYYY-MM-DD HH:mm:ss'),
                today: todaySummary || { spend: 0, revenue: 0, roas: 0 },
                yesterday: yesterdaySummary || { spend: 0, revenue: 0, roas: 0 },
                comparison: { spendChange },
                weekTrend,
                countries,
                accounts,
                campaigns,
                optimizers,
            },
        });
    }
    catch (error) {
        logger_1.default.error('[AggController] Get AI snapshot failed:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.default = router;
