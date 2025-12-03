import { OptimizationAction } from './policies/basePolicy'
import logger from '../../utils/logger'
import { facebookClient } from '../../integration/facebook/facebookClient'
import OptimizationState from '../../models/OptimizationState'

/**
 * 执行服务
 * 负责实际调用 Facebook API 修改广告状态/预算
 */
class ExecutionService {
  /**
   * 执行优化动作
   */
  async execute(
    entityId: string,
    entityType: 'campaign' | 'adset' | 'ad',
    action: OptimizationAction,
    accountId: string,
    token?: string
  ): Promise<boolean> {
    if (action.type === 'NOOP') {
      return false
    }

    logger.info(`[ExecutionService] Executing ${action.type} for ${entityType} ${entityId}: ${action.reason}`)

    try {
      // 1. 获取 Token (如果未提供，尝试从 OptimizationState 或 TokenPool 获取)
      // 这里简化，假设上层已经处理好 Token，或者 facebookClient 会自动处理
      
      // 2. 执行 API 调用
      switch (action.type) {
        case 'ADJUST_BUDGET':
          await this.adjustBudget(entityId, entityType, action.newBudget)
          break
        case 'PAUSE_ENTITY':
          await this.updateStatus(entityId, entityType, 'PAUSED')
          break
        case 'START_ENTITY':
          await this.updateStatus(entityId, entityType, 'ACTIVE')
          break
      }

      // 3. 记录执行结果到 OptimizationState
      await OptimizationState.findOneAndUpdate(
        { entityType, entityId },
        {
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
        },
        { upsert: true }
      )

      return true
    } catch (error: any) {
      logger.error(`[ExecutionService] Failed to execute ${action.type} for ${entityId}:`, error)
      return false
    }
  }

  /**
   * 调整预算
   */
  private async adjustBudget(entityId: string, entityType: string, newBudget: number) {
    if (entityType !== 'campaign' && entityType !== 'adset') {
      throw new Error(`Cannot set budget for ${entityType}`)
    }

    // 转换为分 (cents)
    const budgetInCents = Math.round(newBudget * 100)

    await facebookClient.post(`/${entityId}`, {
      daily_budget: budgetInCents
    })
  }

  /**
   * 更新状态
   */
  private async updateStatus(entityId: string, entityType: string, status: 'ACTIVE' | 'PAUSED') {
    await facebookClient.post(`/${entityId}`, {
      status
    })
  }
}

export const executionService = new ExecutionService()

