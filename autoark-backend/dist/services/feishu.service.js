"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.feishuService = exports.FeishuService = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../utils/logger"));
class FeishuService {
    constructor() {
        this.tenantAccessToken = null;
        this.tokenExpiresAt = 0;
    }
    /**
     * 获取飞书 Tenant Access Token
     */
    async getTenantAccessToken(appId, appSecret) {
        if (this.tenantAccessToken && Date.now() < this.tokenExpiresAt) {
            return this.tenantAccessToken;
        }
        try {
            const res = await axios_1.default.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
                app_id: appId,
                app_secret: appSecret,
            });
            if (res.data.code === 0) {
                this.tenantAccessToken = res.data.tenant_access_token;
                this.tokenExpiresAt = Date.now() + (res.data.expire - 60) * 1000;
                return this.tenantAccessToken;
            }
            else {
                throw new Error(`Feishu Auth Failed: ${res.data.msg}`);
            }
        }
        catch (error) {
            logger_1.default.error('[Feishu] Failed to get access token:', error.message);
            throw error;
        }
    }
    /**
     * 发送交互式审批卡片
     */
    async sendApprovalCard(operation, agent) {
        const { feishuConfig } = agent;
        if (!feishuConfig?.enabled || !feishuConfig.appId || !feishuConfig.appSecret) {
            return null;
        }
        try {
            const token = await this.getTenantAccessToken(feishuConfig.appId, feishuConfig.appSecret);
            const card = this.buildApprovalCard(operation, agent);
            const res = await axios_1.default.post(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${feishuConfig.receiveIdType || 'chat_id'}`, {
                receive_id: feishuConfig.receiveId,
                msg_type: 'interactive',
                content: JSON.stringify(card),
            }, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.data.code === 0) {
                return res.data.data.message_id;
            }
            else {
                logger_1.default.error('[Feishu] Failed to send card:', res.data.msg);
                return null;
            }
        }
        catch (error) {
            console.error('[Feishu] FULL ERROR:', error.response?.data || error);
            const errorData = error.response?.data || error.message || error;
            logger_1.default.error(`[Feishu] Send card error: ${JSON.stringify(errorData, null, 2)}`);
            return null;
        }
    }
    /**
     * 更新已有的卡片状态
     */
    async updateApprovalCard(messageId, status, approverName, agent) {
        const { feishuConfig } = agent;
        if (!feishuConfig?.appId || !feishuConfig.appSecret)
            return;
        try {
            const token = await this.getTenantAccessToken(feishuConfig.appId, feishuConfig.appSecret);
            // 构建更新后的卡片 (移除按钮，增加审批人信息)
            const res = await axios_1.default.patch(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}`, {
                content: JSON.stringify(this.buildFinishedCard(status, approverName))
            }, {
                headers: { Authorization: `Bearer ${token}` },
            });
            return res.data.code === 0;
        }
        catch (error) {
            logger_1.default.error('[Feishu] Update card error:', error.message);
            return false;
        }
    }
    buildApprovalCard(op, agent) {
        const score = op.scoreSnapshot?.finalScore?.toFixed(1) || 'N/A';
        const stage = op.scoreSnapshot?.stage || 'Unknown';
        const color = op.action === 'pause' ? 'red' : 'blue';
        return {
            config: { wide_screen_mode: true },
            header: {
                template: color,
                title: { content: `🤖 AutoArk 策略审批: ${op.action.toUpperCase()}`, tag: 'plain_text' }
            },
            elements: [
                {
                    tag: 'div',
                    fields: [
                        { is_short: true, text: { content: `**Agent:**\n${agent.name}`, tag: 'lark_md' } },
                        { is_short: true, text: { content: `**综合得分:**\n${score}`, tag: 'lark_md' } },
                        { is_short: true, text: { content: `**生命周期:**\n${stage}`, tag: 'lark_md' } },
                        { is_short: true, text: { content: `**操作对象:**\n${op.entityName || op.entityId}`, tag: 'lark_md' } }
                    ]
                },
                {
                    tag: 'div',
                    text: { content: `**决策依据:**\n${op.reason}`, tag: 'lark_md' }
                },
                {
                    tag: 'hr'
                },
                {
                    tag: 'action',
                    actions: [
                        {
                            tag: 'button',
                            text: { content: '通过审批', tag: 'plain_text' },
                            type: 'primary',
                            value: { action: 'approve', operationId: op._id.toString() }
                        },
                        {
                            tag: 'button',
                            text: { content: '拒绝', tag: 'plain_text' },
                            type: 'danger',
                            value: { action: 'reject', operationId: op._id.toString() }
                        }
                    ]
                }
            ]
        };
    }
    buildFinishedCard(status, approver) {
        const color = status === 'approved' ? 'green' : 'grey';
        const text = status === 'approved' ? '✅ 已通过审批' : '❌ 已拒绝';
        return {
            config: { wide_screen_mode: true },
            header: {
                template: color,
                title: { content: `🤖 AutoArk 策略审批: ${text}`, tag: 'plain_text' }
            },
            elements: [
                {
                    tag: 'div',
                    text: { content: `审批人: **${approver}**`, tag: 'lark_md' }
                },
                {
                    tag: 'div',
                    text: { content: `状态: ${text}`, tag: 'lark_md' }
                }
            ]
        };
    }
}
exports.FeishuService = FeishuService;
exports.feishuService = new FeishuService();
