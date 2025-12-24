"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleFeishuInteraction = void 0;
const logger_1 = __importDefault(require("../utils/logger"));
const agent_model_1 = require("../domain/agent/agent.model");
const agent_service_1 = require("../domain/agent/agent.service");
const feishu_service_1 = require("../services/feishu.service");
/**
 * 飞书 Webhook 回调控制层
 * 处理飞书消息卡片的交互点击
 */
const handleFeishuInteraction = async (req, res) => {
    try {
        // 飞书的 URL 验证 (Challenge)
        if (req.body.type === 'url_verification') {
            return res.json({ challenge: req.body.challenge });
        }
        const { action, user } = req.body;
        if (!action || !action.value) {
            return res.json({ success: true }); // 忽略不带 value 的点击
        }
        const { action: decision, operationId } = action.value;
        const approverName = user?.name || '飞书用户';
        logger_1.default.info(`[FeishuWebhook] Interaction received: ${decision} for op ${operationId} by ${approverName}`);
        // 1. 找到对应的操作
        const op = await agent_model_1.AgentOperation.findById(operationId);
        if (!op) {
            return res.json({ msg: '操作记录未找到' });
        }
        if (op.status !== 'pending') {
            return res.json({ msg: `该操作已处理 (当前状态: ${op.status})` });
        }
        // 2. 执行决策
        if (decision === 'approve') {
            await agent_service_1.agentService.approveOperation(operationId, `feishu:${user?.open_id || 'unknown'}`);
        }
        else {
            await agent_service_1.agentService.rejectOperation(operationId, `feishu:${user?.open_id || 'unknown'}`, 'Rejected via Feishu');
        }
        // 3. 异步更新飞书卡片状态
        const agent = await agent_model_1.AgentConfig.findById(op.agentId);
        if (agent && req.body.open_message_id) {
            await feishu_service_1.feishuService.updateApprovalCard(req.body.open_message_id, decision === 'approve' ? 'approved' : 'rejected', approverName, agent);
        }
        // 4. 返回响应 (飞书卡片点击后可以返回一个 Toast 提示)
        res.json({
            toast: {
                type: 'success',
                content: `已成功${decision === 'approve' ? '批准' : '拒绝'}该操作`
            }
        });
    }
    catch (error) {
        logger_1.default.error('[FeishuWebhook] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
};
exports.handleFeishuInteraction = handleFeishuInteraction;
