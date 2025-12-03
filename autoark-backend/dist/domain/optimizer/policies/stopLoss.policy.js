"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StopLossPolicy = void 0;
/**
 * 止损策略 (Stop Loss Policy)
 * 逻辑：
 * 1. 花费超过阈值 (如 2 * CPA 或固定金额) 且 0 转化 -> 关停
 * 2. ROAS 极低 (如 < 0.2) 且花费可观 -> 关停
 */
class StopLossPolicy {
    constructor() {
        this.name = 'stop-loss-policy';
    }
    apply(ctx) {
        const { summary, targetRoas = 1.0 } = ctx;
        const spend = summary.spend;
        const roas = summary.roas;
        const purchaseValue = summary.purchase_value;
        // 阈值配置 (可做成参数)
        const spendThreshold = 100; // $100 没转化就关
        const lowRoasThreshold = 0.2; // ROAS < 0.2
        // 1. 高花费零转化
        if (spend > spendThreshold && purchaseValue === 0) {
            return {
                type: 'PAUSE_ENTITY',
                reason: `Spend $${spend.toFixed(2)} > $${spendThreshold} with 0 return.`,
            };
        }
        // 2. 严重亏损
        if (spend > spendThreshold && roas < lowRoasThreshold) {
            return {
                type: 'PAUSE_ENTITY',
                reason: `Severe loss: ROAS ${roas.toFixed(2)} < ${lowRoasThreshold} with spend $${spend.toFixed(2)}.`,
            };
        }
        return { type: 'NOOP', reason: 'Pass stop loss check' };
    }
}
exports.StopLossPolicy = StopLossPolicy;
