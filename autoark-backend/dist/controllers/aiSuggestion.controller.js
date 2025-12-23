"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const aiSuggestion_service_1 = require("../services/aiSuggestion.service");
const logger_1 = __importDefault(require("../utils/logger"));
const auth_1 = require("../middlewares/auth");
const router = (0, express_1.Router)();
// 所有接口需要认证
router.use(auth_1.authenticate);
/**
 * GET /api/ai-suggestions
 * 获取 AI 建议列表
 */
router.get('/', async (req, res) => {
    try {
        const { status, limit, skip } = req.query;
        const result = await aiSuggestion_service_1.aiSuggestionService.getSuggestions({
            status: status,
            limit: limit ? parseInt(limit) : 50,
            skip: skip ? parseInt(skip) : 0,
        });
        res.json({ success: true, data: result });
    }
    catch (error) {
        logger_1.default.error('[AiSuggestion] Get suggestions failed:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * GET /api/ai-suggestions/pending
 * 获取待处理的建议
 */
router.get('/pending', async (req, res) => {
    try {
        const { priority, entityType, accountId, limit } = req.query;
        const suggestions = await aiSuggestion_service_1.aiSuggestionService.getPendingSuggestions({
            priority: priority,
            entityType: entityType,
            accountId: accountId,
            limit: limit ? parseInt(limit) : 50,
        });
        res.json({ success: true, data: suggestions });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * GET /api/ai-suggestions/stats
 * 获取统计信息
 */
router.get('/stats', async (req, res) => {
    try {
        const stats = await aiSuggestion_service_1.aiSuggestionService.getStats();
        res.json({ success: true, data: stats });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * POST /api/ai-suggestions/generate
 * 手动触发生成建议
 */
router.post('/generate', async (req, res) => {
    try {
        const suggestions = await aiSuggestion_service_1.aiSuggestionService.generateSuggestions();
        res.json({
            success: true,
            data: suggestions,
            message: `Generated ${suggestions.length} new suggestions`
        });
    }
    catch (error) {
        logger_1.default.error('[AiSuggestion] Generate failed:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * POST /api/ai-suggestions/:id/approve
 * 批准建议
 */
router.post('/:id/approve', async (req, res) => {
    try {
        const suggestion = await aiSuggestion_service_1.aiSuggestionService.approveSuggestion(req.params.id, req.user?.userId || 'unknown');
        if (!suggestion) {
            return res.status(404).json({ success: false, error: 'Suggestion not found' });
        }
        res.json({ success: true, data: suggestion });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * POST /api/ai-suggestions/:id/reject
 * 拒绝建议
 */
router.post('/:id/reject', async (req, res) => {
    try {
        const suggestion = await aiSuggestion_service_1.aiSuggestionService.rejectSuggestion(req.params.id, req.user?.userId || 'unknown');
        if (!suggestion) {
            return res.status(404).json({ success: false, error: 'Suggestion not found' });
        }
        res.json({ success: true, data: suggestion });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * POST /api/ai-suggestions/:id/execute
 * 执行单个建议
 */
router.post('/:id/execute', async (req, res) => {
    try {
        const suggestion = await aiSuggestion_service_1.aiSuggestionService.executeSuggestion(req.params.id, req.user?.userId || 'unknown');
        res.json({ success: true, data: suggestion });
    }
    catch (error) {
        logger_1.default.error('[AiSuggestion] Execute failed:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * POST /api/ai-suggestions/execute-batch
 * 批量执行建议
 */
router.post('/execute-batch', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, error: 'Please provide suggestion IDs' });
        }
        const result = await aiSuggestion_service_1.aiSuggestionService.executeBatch(ids, req.user?.userId || 'unknown');
        res.json({
            success: true,
            data: result,
            message: `Executed ${result.success} suggestions, ${result.failed} failed`
        });
    }
    catch (error) {
        logger_1.default.error('[AiSuggestion] Batch execute failed:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * POST /api/ai-suggestions/cleanup
 * 清理过期建议
 */
router.post('/cleanup', async (req, res) => {
    try {
        const count = await aiSuggestion_service_1.aiSuggestionService.cleanupExpired();
        res.json({ success: true, data: { cleaned: count } });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.default = router;
