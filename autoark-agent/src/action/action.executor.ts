/**
 * Action Executor - 审批通过后真正调 API 执行
 */
import { Action } from './action.model'
import { Token } from '../data/token.model'
import { AdAccount } from '../data/account.model'
import * as fbWrite from '../platform/facebook/write'
import * as ttWrite from '../platform/tiktok/write'
import { log } from '../platform/logger'

/**
 * 执行一条已审批的 Action
 */
export async function executeAction(actionId: string): Promise<{ success: boolean; error?: string }> {
  const action: any = await Action.findById(actionId)
  if (!action) return { success: false, error: 'Action not found' }
  if (action.status !== 'approved') return { success: false, error: `Action status is ${action.status}, not approved` }

  try {
    const token = await resolveToken(action.platform, action.accountId)
    if (!token) {
      await Action.updateOne({ _id: actionId }, { status: 'failed', result: { error: 'No token available' } })
      return { success: false, error: 'No token available' }
    }

    let result: any

    switch (action.type) {
      case 'create_campaign':
        result = await fbWrite.createCampaign({
          accountId: action.accountId, token,
          name: action.params.name,
          objective: action.params.objective,
          status: 'PAUSED', // 新创建的先暂停
          dailyBudget: action.params.dailyBudget,
          bidStrategy: action.params.bidStrategy,
        })
        break

      case 'adjust_budget':
        if (action.params.entityType === 'adset') {
          result = await fbWrite.updateAdSet(action.entityId, token, { dailyBudget: action.params.newBudget })
        } else {
          result = await fbWrite.updateCampaign(action.entityId, token, { dailyBudget: action.params.newBudget })
        }
        break

      case 'pause':
        if (action.params.entityType === 'adset') {
          result = await fbWrite.updateAdSet(action.entityId, token, { status: 'PAUSED' })
        } else if (action.params.entityType === 'ad') {
          result = await fbWrite.updateAd(action.entityId, token, { status: 'PAUSED' })
        } else {
          result = await fbWrite.updateCampaign(action.entityId, token, { status: 'PAUSED' })
        }
        break

      case 'resume':
        if (action.params.entityType === 'adset') {
          result = await fbWrite.updateAdSet(action.entityId, token, { status: 'ACTIVE' })
        } else if (action.params.entityType === 'ad') {
          result = await fbWrite.updateAd(action.entityId, token, { status: 'ACTIVE' })
        } else {
          result = await fbWrite.updateCampaign(action.entityId, token, { status: 'ACTIVE' })
        }
        break

      default:
        result = { success: false, error: `Unknown action type: ${action.type}` }
    }

    const status = result?.success !== false ? 'executed' : 'failed'
    await Action.updateOne({ _id: actionId }, { status, result, executedAt: new Date() })

    log.info(`[Executor] Action ${actionId} (${action.type}): ${status}`)
    return { success: status === 'executed' }
  } catch (err: any) {
    log.error(`[Executor] Action ${actionId} failed: ${err.message}`)
    await Action.updateOne({ _id: actionId }, { status: 'failed', result: { error: err.message } })
    return { success: false, error: err.message }
  }
}

async function resolveToken(platform: string, accountId: string): Promise<string | null> {
  const account: any = await AdAccount.findOne({ platform, accountId }).lean()
  if (account?.tokenId) {
    const t: any = await Token.findById(account.tokenId).lean()
    if (t?.accessToken) return t.accessToken
  }
  const t: any = await Token.findOne({ platform, status: 'active' }).lean()
  return t?.accessToken || null
}
