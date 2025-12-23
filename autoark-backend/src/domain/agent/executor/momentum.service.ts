import { AgentOperation } from '../agent.model'
import dayjs from 'dayjs'
import logger from '../../../utils/logger'

export interface MomentumCheckResult {
  ok: boolean
  reason?: string
}

export class MomentumService {
  /**
   * 检查操作动量护栏
   * 防止过度反馈、冷却不足或反向震荡
   */
  async checkMomentum(
    entityId: string,
    action: string,
    cooldownHours: number = 4,
    antiOscillationHours: number = 12
  ): Promise<MomentumCheckResult> {
    // 查找该实体最近的一次成功执行记录
    const lastOp: any = await AgentOperation.findOne({
      entityId,
      status: 'executed',
    }).sort({ executedAt: -1 }).lean()

    if (!lastOp) {
      return { ok: true }
    }

    const now = dayjs()
    const lastExecutedAt = dayjs(lastOp.executedAt)
    const hoursSinceLastOp = now.diff(lastExecutedAt, 'hour', true)

    // 1. 冷却期检查 (Cooldown)
    // 如果相同动作，必须间隔 cooldownHours
    if (lastOp.action === action && hoursSinceLastOp < cooldownHours) {
      return {
        ok: false,
        reason: `Momentum: Cooldown in progress. Last ${action} was ${hoursSinceLastOp.toFixed(1)}h ago (min ${cooldownHours}h).`,
      }
    }

    // 2. 反向抑制检查 (Anti-Oscillation)
    // 如果是反向动作 (如加价 vs 减价/暂停)，必须间隔 antiOscillationHours
    if (this.isReverseAction(lastOp.action, action) && hoursSinceLastOp < antiOscillationHours) {
      return {
        ok: false,
        reason: `Momentum: Anti-oscillation trigger. Last action was ${lastOp.action} ${hoursSinceLastOp.toFixed(1)}h ago. Need ${antiOscillationHours}h to stabilize.`,
      }
    }

    return { ok: true }
  }

  private isReverseAction(lastAction: string, currentAction: string): boolean {
    const pairs = [
      ['budget_increase', 'budget_decrease'],
      ['budget_increase', 'pause'],
      ['resume', 'pause'],
    ]

    for (const [a, b] of pairs) {
      if ((lastAction === a && currentAction === b) || (lastAction === b && currentAction === a)) {
        return true
      }
    }

    return false
  }
}

export const momentumService = new MomentumService()
