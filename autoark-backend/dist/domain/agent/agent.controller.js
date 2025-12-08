"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const agent_service_1 = require("./agent.service");
const agent_model_1 = require("./agent.model");
const logger_1 = __importDefault(require("../../utils/logger"));
const router = (0, express_1.Router)();
// ==================== Agent 配置 CRUD ====================
// 获取所有 Agent
router.get('/agents', async (req, res) => {
    try {
        const agents = await agent_service_1.agentService.getAgents();
        res.json({ success: true, data: agents });
    }
    catch (error) {
        logger_1.default.error('[AgentController] Get agents failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// 获取单个 Agent
router.get('/agents/:id', async (req, res) => {
    try {
        const agent = await agent_service_1.agentService.getAgentById(req.params.id);
        if (!agent) {
            return res.status(404).json({ success: false, error: 'Agent not found' });
        }
        res.json({ success: true, data: agent });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// 创建 Agent
router.post('/agents', async (req, res) => {
    try {
        const agent = await agent_service_1.agentService.createAgent(req.body);
        res.status(201).json({ success: true, data: agent });
    }
    catch (error) {
        logger_1.default.error('[AgentController] Create agent failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// 更新 Agent
router.put('/agents/:id', async (req, res) => {
    try {
        const agent = await agent_service_1.agentService.updateAgent(req.params.id, req.body);
        res.json({ success: true, data: agent });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// 删除 Agent
router.delete('/agents/:id', async (req, res) => {
    try {
        await agent_service_1.agentService.deleteAgent(req.params.id);
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// 运行 Agent
router.post('/agents/:id/run', async (req, res) => {
    try {
        const result = await agent_service_1.agentService.runAgent(req.params.id);
        res.json({ success: true, data: result });
    }
    catch (error) {
        logger_1.default.error('[AgentController] Run agent failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== Agent 操作日志 ====================
// 获取待审批操作
router.get('/operations/pending', async (req, res) => {
    try {
        const operations = await agent_service_1.agentService.getPendingOperations();
        res.json({ success: true, data: operations });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// 获取操作历史
router.get('/operations', async (req, res) => {
    try {
        const { status, agentId, accountId, limit = 50 } = req.query;
        const query = {};
        if (status)
            query.status = status;
        if (agentId)
            query.agentId = agentId;
        if (accountId)
            query.accountId = accountId;
        const operations = await agent_model_1.AgentOperation.find(query)
            .sort({ createdAt: -1 })
            .limit(Number(limit));
        res.json({ success: true, data: operations });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// 审批操作
router.post('/operations/:id/approve', async (req, res) => {
    try {
        const result = await agent_service_1.agentService.approveOperation(req.params.id, 'user');
        res.json({ success: true, data: result });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// 拒绝操作
router.post('/operations/:id/reject', async (req, res) => {
    try {
        const result = await agent_service_1.agentService.rejectOperation(req.params.id, 'user', req.body.reason);
        res.json({ success: true, data: result });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== 每日报告 ====================
// 生成报告
router.post('/reports/generate', async (req, res) => {
    try {
        const { date, accountId } = req.body;
        const reportDate = date || new Date().toISOString().split('T')[0];
        const report = await agent_service_1.agentService.generateDailyReport(reportDate, accountId);
        res.json({ success: true, data: report });
    }
    catch (error) {
        logger_1.default.error('[AgentController] Generate report failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// 获取报告列表
router.get('/reports', async (req, res) => {
    try {
        const { startDate, endDate, accountId, limit = 30 } = req.query;
        const query = {};
        if (startDate && endDate) {
            query.date = { $gte: startDate, $lte: endDate };
        }
        else if (startDate) {
            query.date = { $gte: startDate };
        }
        else if (endDate) {
            query.date = { $lte: endDate };
        }
        if (accountId)
            query.accountId = accountId;
        const reports = await agent_model_1.DailyReport.find(query)
            .sort({ date: -1 })
            .limit(Number(limit));
        res.json({ success: true, data: reports });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// 获取单个报告
router.get('/reports/:id', async (req, res) => {
    try {
        const report = await agent_model_1.DailyReport.findById(req.params.id);
        if (!report) {
            return res.status(404).json({ success: false, error: 'Report not found' });
        }
        res.json({ success: true, data: report });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// 获取最新报告
router.get('/reports/latest', async (req, res) => {
    try {
        const { accountId } = req.query;
        const query = { status: 'ready' };
        if (accountId)
            query.accountId = accountId;
        const report = await agent_model_1.DailyReport.findOne(query).sort({ date: -1 });
        res.json({ success: true, data: report });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== AI 对话 ====================
// 发送消息
router.post('/chat', async (req, res) => {
    try {
        const { message, context } = req.body;
        if (!message) {
            return res.status(400).json({ success: false, error: 'Message is required' });
        }
        const response = await agent_service_1.agentService.chat('default-user', message, context);
        res.json({ success: true, data: { response } });
    }
    catch (error) {
        logger_1.default.error('[AgentController] Chat failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// 获取对话历史
router.get('/chat/history', async (req, res) => {
    try {
        const { limit = 10 } = req.query;
        const conversations = await agent_model_1.AiConversation.find({ userId: 'default-user' })
            .sort({ createdAt: -1 })
            .limit(Number(limit));
        res.json({ success: true, data: conversations });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// 清除对话
router.delete('/chat/clear', async (req, res) => {
    try {
        await agent_model_1.AiConversation.updateMany({ userId: 'default-user', status: 'active' }, { status: 'closed' });
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== 数据分析 ====================
// 获取账户健康度分析
router.get('/analysis/health', async (req, res) => {
    try {
        const { accountId } = req.query;
        // 获取最近 7 天数据
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        const query = {
            date: { $gte: startDate.toISOString().split('T')[0] },
            campaignId: { $exists: true, $ne: null },
        };
        if (accountId)
            query.accountId = accountId;
        const data = await require('../../models/MetricsDaily').default.aggregate([
            { $match: query },
            {
                $group: {
                    _id: '$date',
                    spend: { $sum: '$spendUsd' },
                    revenue: { $sum: { $ifNull: ['$purchase_value', 0] } },
                    impressions: { $sum: '$impressions' },
                    clicks: { $sum: '$clicks' },
                    conversions: { $sum: { $ifNull: ['$conversions', 0] } },
                }
            },
            { $sort: { _id: 1 } },
            {
                $addFields: {
                    roas: { $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$revenue', '$spend'] }, 0] },
                    ctr: { $cond: [{ $gt: ['$impressions', 0] }, { $divide: ['$clicks', '$impressions'] }, 0] },
                }
            }
        ]);
        // 计算健康度评分
        const totalSpend = data.reduce((sum, d) => sum + d.spend, 0);
        const totalRevenue = data.reduce((sum, d) => sum + d.revenue, 0);
        const avgRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
        let healthScore = 50; // 基础分
        if (avgRoas > 2)
            healthScore += 30;
        else if (avgRoas > 1.5)
            healthScore += 20;
        else if (avgRoas > 1)
            healthScore += 10;
        else if (avgRoas < 0.5)
            healthScore -= 20;
        // 趋势加分
        if (data.length >= 3) {
            const recent = data.slice(-3);
            const older = data.slice(0, -3);
            const recentRoas = recent.reduce((s, d) => s + d.roas, 0) / recent.length;
            const olderRoas = older.length > 0 ? older.reduce((s, d) => s + d.roas, 0) / older.length : recentRoas;
            if (recentRoas > olderRoas)
                healthScore += 10;
            else if (recentRoas < olderRoas * 0.8)
                healthScore -= 10;
        }
        healthScore = Math.max(0, Math.min(100, healthScore));
        res.json({
            success: true,
            data: {
                healthScore,
                trend: data,
                summary: {
                    totalSpend,
                    totalRevenue,
                    avgRoas,
                    days: data.length,
                },
                status: healthScore >= 70 ? 'healthy' : healthScore >= 40 ? 'attention' : 'critical',
            }
        });
    }
    catch (error) {
        logger_1.default.error('[AgentController] Health analysis failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// 获取 AI 分析建议
router.post('/analysis/suggest', async (req, res) => {
    try {
        const { accountId, campaignId, question } = req.body;
        const context = {};
        if (accountId)
            context.accountId = accountId;
        if (campaignId)
            context.campaignId = campaignId;
        const prompt = question || '请分析当前投放情况并给出优化建议';
        const response = await agent_service_1.agentService.chat('default-user', prompt, context);
        res.json({ success: true, data: { response } });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.default = router;
