/**
 * 飞书 Webhook 回调 — 处理卡片交互（审批/拒绝）
 */
import { Router, Request, Response } from 'express'
import { log } from '../logger'
import { Action } from '../../action/action.model'
import { updateApprovalStatus } from './feishu.service'
import { executeWithRetry } from '../../agent/brain'

const router = Router()

router.post('/interaction', async (req: Request, res: Response) => {
  try {
    if (req.body.type === 'url_verification') {
      return res.json({ challenge: req.body.challenge })
    }

    const { action, user } = req.body
    if (!action?.value) {
      return res.json({ success: true })
    }

    const { action: decision, actionData } = action.value
    const approver = user?.name || 'feishu_user'
    const parsed = typeof actionData === 'string' ? JSON.parse(actionData) : actionData

    log.info(`[FeishuWebhook] ${decision} for campaign ${parsed?.campaignId} by ${approver}`)

    const dbAction = await Action.findOne({
      entityId: parsed?.campaignId,
      status: 'pending',
    }).sort({ createdAt: -1 })

    if (!dbAction) {
      return res.json({ toast: { type: 'warning', content: '未找到待处理的操作' } })
    }

    if (decision === 'approve') {
      await Action.updateOne({ _id: dbAction._id }, {
        $set: { status: 'approved', reviewedBy: `feishu:${user?.open_id || 'unknown'}`, reviewedAt: new Date() },
      })

      try {
        await executeWithRetry({
          type: (dbAction as any).type === 'adjust_budget' ? 'increase_budget' : (dbAction as any).type,
          campaignId: (dbAction as any).entityId,
          campaignName: (dbAction as any).entityName,
          accountId: (dbAction as any).accountId || '',
          reason: (dbAction as any).reason,
          auto: false,
          currentBudget: (dbAction as any).params?.currentBudget,
          newBudget: (dbAction as any).params?.newBudget,
        })
        await Action.updateOne({ _id: dbAction._id }, { $set: { status: 'executed', executedAt: new Date() } })
      } catch (e: any) {
        log.error(`[FeishuWebhook] Execute failed: ${e.message}`)
        await Action.updateOne({ _id: dbAction._id }, { $set: { status: 'failed', 'result.error': e.message } })
      }
    } else {
      await Action.updateOne({ _id: dbAction._id }, {
        $set: { status: 'rejected', reviewedBy: `feishu:${user?.open_id || 'unknown'}`, reviewedAt: new Date(), reviewNote: 'Rejected via Feishu' },
      })
    }

    if (req.body.open_message_id) {
      await updateApprovalStatus(
        req.body.open_message_id,
        decision === 'approve' ? 'approved' : 'rejected',
        approver,
      )
    }

    res.json({
      toast: { type: 'success', content: `已${decision === 'approve' ? '批准' : '拒绝'}该操作` },
    })
  } catch (e: any) {
    log.error(`[FeishuWebhook] Error: ${e.message}`)
    res.status(500).json({ error: e.message })
  }
})

export default router
