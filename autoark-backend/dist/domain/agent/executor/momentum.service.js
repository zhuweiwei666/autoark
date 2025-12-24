"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.momentumService = exports.MomentumService = void 0;
const agent_model_1 = require("../agent.model");
const dayjs_1 = __importDefault(require("dayjs"));
class MomentumService {
    /**
     * 检查操作动量护栏
     * 防止过度反馈、冷却不足或反向震荡
     */
    async checkMomentum(entityId, action, cooldownHours = 4, antiOscillationHours = 12) {
        // 查找该实体最近的一次成功执行记录
        const lastOp = await agent_model_1.AgentOperation.findOne({
            entityId,
            status: 'executed',
        }).sort({ executedAt: -1 }).lean();
        if (!lastOp) {
            return { ok: true };
        }
        const now = (0, dayjs_1.default)();
        const lastExecutedAt = (0, dayjs_1.default)(lastOp.executedAt);
        const hoursSinceLastOp = now.diff(lastExecutedAt, 'hour', true);
        // 1. 冷却期检查 (Cooldown)
        // 如果相同动作，必须间隔 cooldownHours
        if (lastOp.action === action && hoursSinceLastOp < cooldownHours) {
            return {
                ok: false,
                reason: `Momentum: Cooldown in progress. Last ${action} was ${hoursSinceLastOp.toFixed(1)}h ago (min ${cooldownHours}h).`,
            };
        }
        // 2. 反向抑制检查 (Anti-Oscillation)
        // 如果是反向动作 (如加价 vs 减价/暂停)，必须间隔 antiOscillationHours
        if (this.isReverseAction(lastOp.action, action) && hoursSinceLastOp < antiOscillationHours) {
            return {
                ok: false,
                reason: `Momentum: Anti-oscillation trigger. Last action was ${lastOp.action} ${hoursSinceLastOp.toFixed(1)}h ago. Need ${antiOscillationHours}h to stabilize.`,
            };
        }
        return { ok: true };
    }
    isReverseAction(lastAction, currentAction) {
        const pairs = [
            ['budget_increase', 'budget_decrease'],
            ['budget_increase', 'pause'],
            ['resume', 'pause'],
        ];
        for (const [a, b] of pairs) {
            if ((lastAction === a && currentAction === b) || (lastAction === b && currentAction === a)) {
                return true;
            }
        }
        return false;
    }
}
exports.MomentumService = MomentumService;
exports.momentumService = new MomentumService();
