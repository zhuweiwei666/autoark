"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.executionService = void 0;
const logger_1 = __importDefault(require("../../utils/logger"));
const facebookClient_1 = require("../../integration/facebook/facebookClient");
const OptimizationState_1 = __importDefault(require("../../models/OptimizationState"));
/**
 * 执行服务
 * 负责实际调用 Facebook API 修改广告状态/预算
 */
class ExecutionService {
    /**
     * 执行优化动作
     */
    async execute(entityId, entityType, action, accountId, token) {
        if (action.type === 'NOOP') {
            return false;
        }
        logger_1.default.info(`[ExecutionService] Executing ${action.type} for ${entityType} ${entityId}: ${action.reason}`);
        try {
            // 1. 获取 Token (如果未提供，尝试从 OptimizationState 或 TokenPool 获取)
            // 这里简化，假设上层已经处理好 Token，或者 facebookClient 会自动处理
            // 2. 执行 API 调用
            switch (action.type) {
                case 'ADJUST_BUDGET':
                    await this.adjustBudget(entityId, entityType, action.newBudget);
                    break;
                case 'PAUSE_ENTITY':
                    await this.updateStatus(entityId, entityType, 'PAUSED');
                    break;
                case 'START_ENTITY':
                    await this.updateStatus(entityId, entityType, 'ACTIVE');
                    break;
            }
            // 3. 记录执行结果到 OptimizationState
            await OptimizationState_1.default.findOneAndUpdate({ entityType, entityId }, {
                accountId,
                lastAction: action.type,
                lastActionTime: new Date(),
                $push: {
                    history: {
                        action: action.type,
                        reason: action.reason,
                        timestamp: new Date(),
                        details: action
                    }
                }
            }, { upsert: true });
            return true;
        }
        catch (error) {
            logger_1.default.error(`[ExecutionService] Failed to execute ${action.type} for ${entityId}:`, error);
            return false;
        }
    }
    /**
     * 调整预算
     */
    async adjustBudget(entityId, entityType, newBudget) {
        if (entityType !== 'campaign' && entityType !== 'adset') {
            throw new Error(`Cannot set budget for ${entityType}`);
        }
        // 转换为分 (cents)
        const budgetInCents = Math.round(newBudget * 100);
        await facebookClient_1.facebookClient.post(`/${entityId}`, {
            daily_budget: budgetInCents
        });
    }
    /**
     * 更新状态
     */
    async updateStatus(entityId, entityType, status) {
        await facebookClient_1.facebookClient.post(`/${entityId}`, {
            status
        });
    }
}
exports.executionService = new ExecutionService();
