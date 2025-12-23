"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const dayjs_1 = __importDefault(require("dayjs"));
const logger_1 = __importDefault(require("../utils/logger"));
const auth_1 = require("../middlewares/auth");
const materialMetrics_service_1 = require("../services/materialMetrics.service");
const router = (0, express_1.Router)();
// 所有路由都需要认证
router.use(auth_1.authenticate);
// ==================== 素材排行榜 ====================
/**
 * 获取素材排行榜
 * GET /api/materials/rankings
 * Query: startDate, endDate, sortBy, limit, type, country
 */
router.get('/rankings', async (req, res) => {
    try {
        const { startDate = (0, dayjs_1.default)().subtract(7, 'day').format('YYYY-MM-DD'), endDate = (0, dayjs_1.default)().format('YYYY-MM-DD'), sortBy = 'roas', limit = '20', type, country, // 🌍 新增：国家筛选
         } = req.query;
        const rankings = await (0, materialMetrics_service_1.getMaterialRankings)({
            dateRange: { start: startDate, end: endDate },
            sortBy: sortBy,
            limit: parseInt(limit, 10),
            materialType: type,
            country: country, // 🌍 传递国家参数
        });
        res.json({
            success: true,
            data: rankings,
            query: { startDate, endDate, sortBy, limit, type, country },
        });
    }
    catch (error) {
        logger_1.default.error('[MaterialController] Get rankings failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== 素材趋势 ====================
/**
 * 获取单个素材的历史趋势
 * GET /api/materials/trend
 * Query: imageHash, videoId, days
 */
router.get('/trend', async (req, res) => {
    try {
        const { imageHash, videoId, days = '7' } = req.query;
        if (!imageHash && !videoId) {
            return res.status(400).json({
                success: false,
                error: 'Either imageHash or videoId is required',
            });
        }
        const trend = await (0, materialMetrics_service_1.getMaterialTrend)({ imageHash: imageHash, videoId: videoId }, parseInt(days, 10));
        res.json({ success: true, data: trend });
    }
    catch (error) {
        logger_1.default.error('[MaterialController] Get trend failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== 素材去重 ====================
/**
 * 查找重复素材
 * GET /api/materials/duplicates
 */
router.get('/duplicates', async (req, res) => {
    try {
        const duplicates = await (0, materialMetrics_service_1.findDuplicateMaterials)();
        res.json({
            success: true,
            data: duplicates,
            summary: {
                duplicateImages: duplicates.byImageHash.length,
                duplicateVideos: duplicates.byVideoId.length,
            },
        });
    }
    catch (error) {
        logger_1.default.error('[MaterialController] Find duplicates failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * 获取素材使用情况
 * GET /api/materials/usage
 * Query: imageHash, videoId, creativeId
 */
router.get('/usage', async (req, res) => {
    try {
        const { imageHash, videoId, creativeId } = req.query;
        if (!imageHash && !videoId && !creativeId) {
            return res.status(400).json({
                success: false,
                error: 'At least one of imageHash, videoId, or creativeId is required',
            });
        }
        const usage = await (0, materialMetrics_service_1.getMaterialUsage)({
            imageHash: imageHash,
            videoId: videoId,
            creativeId: creativeId,
        });
        res.json({ success: true, data: usage });
    }
    catch (error) {
        logger_1.default.error('[MaterialController] Get usage failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== 素材推荐 ====================
/**
 * 获取推荐素材
 * GET /api/materials/recommendations
 * Query: type, minSpend, minRoas, minDays, limit
 */
router.get('/recommendations', async (req, res) => {
    try {
        const { type, minSpend = '50', minRoas = '1.0', minDays = '3', limit = '20', } = req.query;
        const recommendations = await (0, materialMetrics_service_1.getRecommendedMaterials)({
            type: type,
            minSpend: parseFloat(minSpend),
            minRoas: parseFloat(minRoas),
            minDays: parseInt(minDays, 10),
            limit: parseInt(limit, 10),
        });
        res.json({ success: true, data: recommendations });
    }
    catch (error) {
        logger_1.default.error('[MaterialController] Get recommendations failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * 获取表现下滑的素材（预警）
 * GET /api/materials/declining
 * Query: minSpend, declineThreshold, limit
 */
router.get('/declining', async (req, res) => {
    try {
        const { minSpend = '30', declineThreshold = '30', limit = '20', } = req.query;
        const declining = await (0, materialMetrics_service_1.getDecliningMaterials)({
            minSpend: parseFloat(minSpend),
            declineThreshold: parseFloat(declineThreshold),
            limit: parseInt(limit, 10),
        });
        res.json({ success: true, data: declining });
    }
    catch (error) {
        logger_1.default.error('[MaterialController] Get declining failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== 手动聚合 ====================
/**
 * 手动触发素材指标聚合
 * POST /api/materials/aggregate
 * Body: { date?: string }
 */
router.post('/aggregate', async (req, res) => {
    try {
        const { date = (0, dayjs_1.default)().format('YYYY-MM-DD') } = req.body;
        logger_1.default.info(`[MaterialController] Manual aggregation triggered for ${date}`);
        const result = await (0, materialMetrics_service_1.aggregateMaterialMetrics)(date);
        res.json({
            success: true,
            data: result,
            message: `Aggregated material metrics for ${date}`,
        });
    }
    catch (error) {
        logger_1.default.error('[MaterialController] Aggregation failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * 批量补数据
 * POST /api/materials/backfill
 * Body: { startDate: string, endDate: string }
 */
router.post('/backfill', async (req, res) => {
    try {
        const { startDate, endDate } = req.body;
        if (!startDate || !endDate) {
            return res.status(400).json({
                success: false,
                error: 'startDate and endDate are required',
            });
        }
        logger_1.default.info(`[MaterialController] Backfill triggered for ${startDate} to ${endDate}`);
        const results = [];
        let currentDate = (0, dayjs_1.default)(startDate);
        const end = (0, dayjs_1.default)(endDate);
        while (currentDate.isBefore(end) || currentDate.isSame(end, 'day')) {
            const dateStr = currentDate.format('YYYY-MM-DD');
            try {
                const result = await (0, materialMetrics_service_1.aggregateMaterialMetrics)(dateStr);
                results.push({ date: dateStr, result });
            }
            catch (err) {
                results.push({ date: dateStr, result: { error: err.message } });
            }
            currentDate = currentDate.add(1, 'day');
        }
        res.json({
            success: true,
            data: results,
            summary: {
                daysProcessed: results.length,
                successCount: results.filter(r => !r.result.error).length,
                errorCount: results.filter(r => r.result.error).length,
            },
        });
    }
    catch (error) {
        logger_1.default.error('[MaterialController] Backfill failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== 素材下载功能已移除 ====================
// 所有素材从素材库上传，通过 Ad.materialId 精准归因
// 归因流程：素材库上传 → 创建广告(记录materialId) → 数据聚合(通过materialId精准归因)
exports.default = router;
