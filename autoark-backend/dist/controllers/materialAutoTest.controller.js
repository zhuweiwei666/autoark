"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const materialAutoTest_service_1 = require("../services/materialAutoTest.service");
const logger_1 = __importDefault(require("../utils/logger"));
const auth_1 = require("../middlewares/auth");
const router = (0, express_1.Router)();
// 所有接口需要认证
router.use(auth_1.authenticate);
/**
 * GET /api/material-auto-test/configs
 * 获取所有自动测试配置
 */
router.get('/configs', async (req, res) => {
    try {
        const configs = await materialAutoTest_service_1.materialAutoTestService.getConfigs();
        res.json({ success: true, data: configs });
    }
    catch (error) {
        logger_1.default.error('[MaterialAutoTest] Get configs failed:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * GET /api/material-auto-test/configs/:id
 * 获取单个配置
 */
router.get('/configs/:id', async (req, res) => {
    try {
        const config = await materialAutoTest_service_1.materialAutoTestService.getConfigById(req.params.id);
        if (!config) {
            return res.status(404).json({ success: false, error: 'Config not found' });
        }
        res.json({ success: true, data: config });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * POST /api/material-auto-test/configs
 * 创建配置
 */
router.post('/configs', async (req, res) => {
    try {
        const data = {
            ...req.body,
            createdBy: req.user?.userId || 'unknown',
        };
        const config = await materialAutoTest_service_1.materialAutoTestService.createConfig(data);
        res.status(201).json({ success: true, data: config });
    }
    catch (error) {
        logger_1.default.error('[MaterialAutoTest] Create config failed:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * PUT /api/material-auto-test/configs/:id
 * 更新配置
 */
router.put('/configs/:id', async (req, res) => {
    try {
        const config = await materialAutoTest_service_1.materialAutoTestService.updateConfig(req.params.id, req.body);
        if (!config) {
            return res.status(404).json({ success: false, error: 'Config not found' });
        }
        res.json({ success: true, data: config });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * DELETE /api/material-auto-test/configs/:id
 * 删除配置
 */
router.delete('/configs/:id', async (req, res) => {
    try {
        const deleted = await materialAutoTest_service_1.materialAutoTestService.deleteConfig(req.params.id);
        if (!deleted) {
            return res.status(404).json({ success: false, error: 'Config not found' });
        }
        res.json({ success: true, message: 'Config deleted' });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * POST /api/material-auto-test/configs/:id/toggle
 * 启用/禁用配置
 */
router.post('/configs/:id/toggle', async (req, res) => {
    try {
        const config = await materialAutoTest_service_1.materialAutoTestService.getConfigById(req.params.id);
        if (!config) {
            return res.status(404).json({ success: false, error: 'Config not found' });
        }
        const updated = await materialAutoTest_service_1.materialAutoTestService.updateConfig(req.params.id, {
            enabled: !config.enabled,
        });
        res.json({ success: true, data: updated });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * POST /api/material-auto-test/test/:materialId
 * 手动为素材创建测试广告
 */
router.post('/test/:materialId', async (req, res) => {
    try {
        const { configId } = req.body;
        const result = await materialAutoTest_service_1.materialAutoTestService.createTestAd(req.params.materialId, configId);
        res.json({ success: true, data: result });
    }
    catch (error) {
        logger_1.default.error('[MaterialAutoTest] Create test ad failed:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * POST /api/material-auto-test/check
 * 手动触发检查新素材
 */
router.post('/check', async (req, res) => {
    try {
        await materialAutoTest_service_1.materialAutoTestService.checkNewMaterials();
        res.json({ success: true, message: 'Check completed' });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.default = router;
