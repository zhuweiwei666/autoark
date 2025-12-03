"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimpleRoasPolicy = void 0;
/**
 * 简单 ROAS 策略
 * 逻辑：
 * 1. 花费过少 -> 不动
 * 2. ROAS >= 目标 * 1.2 -> 预算 +20%
 * 3. ROAS < 目标 * 0.7 -> 预算 -20%
 * 4. 默认 -> 不动
 */
class SimpleRoasPolicy {
    constructor() {
        this.name = 'simple-roas-policy';
    }
    apply(ctx) {
        const { summary, currentBudget, targetRoas = 1.0 } = ctx;
        // 优先看 7 天数据，如果不够看 3 天
        const roas = summary.roas; // summary 已经聚合了 window 内的数据
        const spend = summary.spend;
        // 1. 数据积累阶段
        if (spend < 50) {
            return { type: 'NOOP', reason: `Spend $${spend.toFixed(2)} < $50, accumulating data` };
        }
        // 2. 表现优异 -> 加预算
        if (roas >= targetRoas * 1.2) {
            const newBudget = Math.round(currentBudget * 1.2 * 100) / 100;
            return {
                type: 'ADJUST_BUDGET',
                newBudget,
                reason: `ROAS ${roas.toFixed(2)} >= target * 1.2 ($${targetRoas * 1.2}), increasing budget by 20%`,
            };
        }
        // 3. 表现不佳 -> 减预算
        if (roas < targetRoas * 0.7) {
            // 保护机制：预算不能太低
            const minBudget = 10;
            if (currentBudget <= minBudget) {
                return { type: 'NOOP', reason: `ROAS low but budget already at minimum ($${minBudget})` };
            }
            const newBudget = Math.max(minBudget, Math.round(currentBudget * 0.8 * 100) / 100);
            return {
                type: 'ADJUST_BUDGET',
                newBudget,
                reason: `ROAS ${roas.toFixed(2)} < target * 0.7 ($${targetRoas * 0.7}), decreasing budget by 20%`,
            };
        }
        return { type: 'NOOP', reason: `ROAS ${roas.toFixed(2)} within acceptable range` };
    }
}
exports.SimpleRoasPolicy = SimpleRoasPolicy;
