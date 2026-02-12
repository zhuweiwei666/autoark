/**
 * Action Executor - 审批通过后通过 TopTou API 执行操作
 *
 * 执行链路：
 * 策略 Agent 生成 Action(pending) → 用户审批(approved) → 本模块执行(executed/failed)
 */
import { Action } from './action.model'
import * as toptouApi from '../platform/toptou/api'
import { getTopTouToken } from '../platform/toptou/client'
import { log } from '../platform/logger'

/**
 * 执行一条已审批的 Action
 */
export async function executeAction(actionId: string): Promise<{ success: boolean; error?: string }> {
  const action: any = await Action.findById(actionId)
  if (!action) return { success: false, error: 'Action not found' }
  if (action.status !== 'approved') return { success: false, error: `Action status is ${action.status}, not approved` }

  if (!getTopTouToken()) {
    await Action.updateOne({ _id: actionId }, { status: 'failed', result: { error: 'TopTou token not set' } })
    return { success: false, error: 'TopTou token not set' }
  }

  try {
    let result: any

    switch (action.type) {
      case 'pause':
        result = await executePause(action)
        break

      case 'resume':
        result = await executeResume(action)
        break

      case 'adjust_budget':
        result = await executeAdjustBudget(action)
        break

      default:
        result = { success: false, error: `Unsupported action type: ${action.type}` }
    }

    const success = result?.code === 200 || result?.success === true
    const status = success ? 'executed' : 'failed'
    await Action.updateOne({ _id: actionId }, { status, result, executedAt: new Date() })

    log.info(`[Executor] Action ${actionId} (${action.type} ${action.entityName || action.entityId}): ${status}${!success ? ' - ' + (result?.msg || result?.error || '') : ''}`)
    return { success }
  } catch (err: any) {
    log.error(`[Executor] Action ${actionId} failed: ${err.message}`)
    await Action.updateOne({ _id: actionId }, { status: 'failed', result: { error: err.message } })
    return { success: false, error: err.message }
  }
}

/**
 * 暂停 campaign/adset/ad
 */
async function executePause(action: any) {
  const level = action.params?.level || 'campaign'
  const entityId = action.entityId
  const accountId = action.accountId || action.params?.accountId || ''

  return toptouApi.updateStatus({
    level,
    list: [{ id: entityId, accountId, status: 'PAUSED' }],
  })
}

/**
 * 恢复 campaign/adset/ad
 */
async function executeResume(action: any) {
  const level = action.params?.level || 'campaign'
  const entityId = action.entityId
  const accountId = action.accountId || action.params?.accountId || ''

  return toptouApi.updateStatus({
    level,
    list: [{ id: entityId, accountId, status: 'ACTIVE' }],
  })
}

/**
 * 调整预算
 */
async function executeAdjustBudget(action: any) {
  const level = action.params?.level || 'campaign'
  const entityId = action.entityId
  const accountId = action.accountId || action.params?.accountId || ''
  const newBudget = action.params?.newBudget

  if (!newBudget) {
    return { success: false, error: 'newBudget not specified' }
  }

  return toptouApi.updateNameOrBudget({
    level,
    id: entityId,
    accountId,
    daily_budget: newBudget,
  })
}
