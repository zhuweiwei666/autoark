/**
 * 飞书 Webhook 回调
 *
 * 两个端点：
 * POST /interaction — 卡片交互（审批/拒绝按钮）
 * POST /event       — 事件订阅（接收用户消息，驱动 Agent 对话）
 */
import axios from 'axios'
import { Router, Request, Response } from 'express'
import { log } from '../logger'
import { Action } from '../../action/action.model'
import { User } from '../../auth/user.model'
import { updateApprovalStatus, replyMessage, getBotId } from './feishu.service'
import { executeWithRetry } from '../../agent/brain'
import { chat } from '../../agent/agent'

const FB_GRAPH = 'https://graph.facebook.com/v21.0'

const router = Router()

const processedEvents = new Set<string>()

async function getOrCreateFeishuUser(openId: string): Promise<string> {
  const username = `feishu_${openId.slice(-8)}`
  let user = await User.findOne({ username })
  if (!user) {
    user = await User.create({ username, password: `feishu_${Date.now()}`, role: 'user' })
    log.info(`[FeishuEvent] Created user: ${username} (${user._id})`)
  }
  return user._id.toString()
}

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
        // 优先用 Facebook API 直接执行
        const fbToken = process.env.FB_ACCESS_TOKEN
        const actionType = (dbAction as any).type
        const entityId = (dbAction as any).entityId

        if (fbToken && entityId) {
          const fbParams: any = { access_token: fbToken }
          if (actionType === 'pause') fbParams.status = 'PAUSED'
          else if (actionType === 'resume') fbParams.status = 'ACTIVE'
          else if (actionType === 'adjust_budget' && (dbAction as any).params?.newBudget) {
            fbParams.daily_budget = (dbAction as any).params.newBudget
          }

          await axios.post(`${FB_GRAPH}/${entityId}`, null, { params: fbParams, timeout: 15000 })
          log.info(`[FeishuWebhook] Executed via Facebook API: ${actionType} ${entityId}`)
        } else {
          // 降级到 TopTou
          await executeWithRetry({
            type: actionType === 'adjust_budget' ? 'increase_budget' : actionType,
            campaignId: entityId,
            campaignName: (dbAction as any).entityName,
            accountId: (dbAction as any).accountId || '',
            reason: (dbAction as any).reason,
            auto: false,
            currentBudget: (dbAction as any).params?.currentBudget,
            newBudget: (dbAction as any).params?.newBudget,
          })
        }
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

// ==================== 事件订阅（接收消息）====================

router.post('/event', async (req: Request, res: Response) => {
  try {
    // 飞书 URL 验证（配置事件订阅时触发）
    if (req.body.type === 'url_verification') {
      return res.json({ challenge: req.body.challenge })
    }

    // 飞书 v2 事件格式
    const { header, event } = req.body
    if (!header || !event) {
      return res.json({ code: 0 })
    }

    // 立即响应飞书（避免 3 秒超时重发）
    res.json({ code: 0 })

    // 去重：飞书可能重发事件
    const eventId = header.event_id
    if (!eventId || processedEvents.has(eventId)) return
    processedEvents.add(eventId)
    setTimeout(() => processedEvents.delete(eventId), 300000)

    // 只处理文本消息
    if (header.event_type !== 'im.message.receive_v1') return
    const msgType = event.message?.message_type
    if (msgType !== 'text') {
      log.info(`[FeishuEvent] Ignoring non-text message: ${msgType}`)
      return
    }

    // 过滤机器人自己的消息
    const senderId = event.sender?.sender_id?.open_id
    const botId = await getBotId()
    if (botId && senderId === botId) return

    // 提取消息文本
    const messageId = event.message?.message_id
    let text = ''
    try {
      const content = JSON.parse(event.message?.content || '{}')
      text = (content.text || '').trim()
    } catch {
      return
    }

    // 去掉 @机器人 的提及标记
    text = text.replace(/@_user_\d+/g, '').trim()
    if (!text) return

    const senderName = event.sender?.sender_id?.open_id || 'feishu_user'
    log.info(`[FeishuEvent] Message from ${senderName}: ${text.substring(0, 100)}`)

    // 调用 Agent 对话
    try {
      const userId = await getOrCreateFeishuUser(senderId)
      const result = await chat(userId, '', text)
      const response = result.agentResponse || '处理完成，但没有生成回复。'

      await replyMessage(messageId, response)
      log.info(`[FeishuEvent] Replied (${result.durationMs}ms): ${response.substring(0, 80)}...`)
    } catch (agentErr: any) {
      log.error(`[FeishuEvent] Agent chat failed: ${agentErr.message}`)
      await replyMessage(messageId, `处理出错: ${agentErr.message}`)
    }
  } catch (e: any) {
    log.error(`[FeishuEvent] Error: ${e.message}`)
    if (!res.headersSent) res.json({ code: 0 })
  }
})

export default router
