"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const rule_service_1 = require("../services/rule.service");
const logger_1 = __importDefault(require("../utils/logger"));
const auth_1 = require("../middlewares/auth");
const router = (0, express_1.Router)();
// 所有规则接口需要认证
router.use(auth_1.authenticate);
/**
 * GET /api/rules
 * 获取所有规则
 */
router.get('/', async (req, res) => {
    try {
        const { status } = req.query;
        const rules = await rule_service_1.ruleService.getRules({
            status: status,
            createdBy: req.user?.userId
        });
        res.json({ success: true, data: rules });
    }
    catch (error) {
        logger_1.default.error('[RuleController] Get rules failed:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * GET /api/rules/templates
 * 获取预设规则模板
 */
router.get('/templates', async (req, res) => {
    try {
        const templates = rule_service_1.ruleService.getTemplates();
        res.json({ success: true, data: templates });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * GET /api/rules/:id
 * 获取单个规则详情
 */
router.get('/:id', async (req, res) => {
    try {
        const rule = await rule_service_1.ruleService.getRuleById(req.params.id);
        if (!rule) {
            return res.status(404).json({ success: false, error: 'Rule not found' });
        }
        res.json({ success: true, data: rule });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * POST /api/rules
 * 创建新规则
 */
router.post('/', async (req, res) => {
    try {
        const data = {
            ...req.body,
            createdBy: req.user?.userId || 'unknown',
        };
        const rule = await rule_service_1.ruleService.createRule(data);
        res.status(201).json({ success: true, data: rule });
    }
    catch (error) {
        logger_1.default.error('[RuleController] Create rule failed:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * PUT /api/rules/:id
 * 更新规则
 */
router.put('/:id', async (req, res) => {
    try {
        const rule = await rule_service_1.ruleService.updateRule(req.params.id, req.body);
        if (!rule) {
            return res.status(404).json({ success: false, error: 'Rule not found' });
        }
        res.json({ success: true, data: rule });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * DELETE /api/rules/:id
 * 删除规则
 */
router.delete('/:id', async (req, res) => {
    try {
        const deleted = await rule_service_1.ruleService.deleteRule(req.params.id);
        if (!deleted) {
            return res.status(404).json({ success: false, error: 'Rule not found' });
        }
        res.json({ success: true, message: 'Rule deleted' });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * POST /api/rules/:id/execute
 * 手动执行规则
 */
router.post('/:id/execute', async (req, res) => {
    try {
        const execution = await rule_service_1.ruleService.executeRule(req.params.id);
        res.json({ success: true, data: execution });
    }
    catch (error) {
        logger_1.default.error('[RuleController] Execute rule failed:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * POST /api/rules/:id/toggle
 * 切换规则状态（激活/暂停）
 */
router.post('/:id/toggle', async (req, res) => {
    try {
        const rule = await rule_service_1.ruleService.getRuleById(req.params.id);
        if (!rule) {
            return res.status(404).json({ success: false, error: 'Rule not found' });
        }
        const newStatus = rule.status === 'active' ? 'paused' : 'active';
        const updated = await rule_service_1.ruleService.updateRule(req.params.id, { status: newStatus });
        res.json({ success: true, data: updated });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.default = router;
