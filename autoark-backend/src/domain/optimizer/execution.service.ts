import { OptimizationAction } from './policies/basePolicy'
import logger from '../../utils/logger'
import { facebookClient } from '../../integration/facebook/facebookClient'
import OptimizationState from '../../models/OptimizationState'
import Account from '../../models/Account'
import { normalizeForApi, normalizeForStorage } from '../../utils/accountId'
import { resolvePublishingCredential } from '../../services/metaBusinessCredential.service'

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
      const accessToken = await this.resolveAccessToken(accountId, token)
      
      switch (action.type) {
        case 'ADJUST_BUDGET':
          await this.adjustBudget(entityId, entityType, action.newBudget, accessToken)
          break
        case 'PAUSE_ENTITY':
          await this.updateStatus(entityId, entityType, 'PAUSED', accessToken)
          break
        case 'START_ENTITY':
          await this.updateStatus(entityId, entityType, 'ACTIVE', accessToken)
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
  private async resolveAccessToken(accountId: string, legacyToken?: string): Promise<string> {
    const normalizedAccountId = normalizeForStorage(accountId)
    const account: any = await Account.findOne({
      channel: 'facebook',
      accountId: { $in: Array.from(new Set([normalizedAccountId, normalizeForApi(accountId)])) },
    }).select('organizationId token').lean()

    const systemCredential = await resolvePublishingCredential({
      organizationId: account?.organizationId,
      adAccountIds: [normalizedAccountId],
    })
    const resolvedToken = systemCredential?.token || legacyToken || account?.token
    if (!resolvedToken) {
      throw new Error(`No Facebook authorization covers account ${normalizedAccountId}`)
    }
    return resolvedToken
  }

  private async adjustBudget(
    entityId: string,
    entityType: string,
    newBudget: number,
    accessToken: string,
  ) {
    if (entityType !== 'campaign' && entityType !== 'adset') {
      throw new Error(`Cannot set budget for ${entityType}`)
    }

    // 转换为分 (cents)
    const budgetInCents = Math.round(newBudget * 100)

    await facebookClient.post(`/${entityId}`, {
      daily_budget: budgetInCents,
      access_token: accessToken,
    })
  }

  /**
   * 更新状态
   */
  private async updateStatus(
    entityId: string,
    entityType: string,
    status: 'ACTIVE' | 'PAUSED',
    accessToken: string,
  ) {
    await facebookClient.post(`/${entityId}`, {
      status,
      access_token: accessToken,
    })
  }
}

export const executionService = new ExecutionService()
