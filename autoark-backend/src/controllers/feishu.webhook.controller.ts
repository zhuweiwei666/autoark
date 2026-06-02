import { Request, Response } from 'express'
import crypto from 'crypto'
import logger from '../utils/logger'
import { AgentOperation, AgentConfig } from '../domain/agent/agent.model'
import { agentService } from '../domain/agent/agent.service'
import { feishuService } from '../services/feishu.service'

/**
 * 飞书 Webhook 回调控制层
 * 处理飞书消息卡片的交互点击
 */
const FEISHU_VERIFICATION_TOKEN =
  process.env.FEISHU_WEBHOOK_VERIFICATION_TOKEN ||
  process.env.FEISHU_VERIFICATION_TOKEN ||
  ''
const FEISHU_SIGNING_SECRET =
  process.env.FEISHU_WEBHOOK_SIGNING_SECRET ||
  process.env.FEISHU_BOT_SECRET ||
  ''

const timingSafeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

const verifyFeishuRequest = (req: Request): boolean => {
  if (FEISHU_VERIFICATION_TOKEN) {
    const bodyToken = req.body?.token || req.body?.header?.token
    if (typeof bodyToken === 'string' && timingSafeEqual(bodyToken, FEISHU_VERIFICATION_TOKEN)) {
      return true
    }
  }

  if (FEISHU_SIGNING_SECRET) {
    const timestamp = String(req.headers['x-lark-request-timestamp'] || req.headers['timestamp'] || '')
    const signature = String(req.headers['x-lark-signature'] || req.headers['sign'] || '')
    if (!timestamp || !signature) return false

    const customBotSign = crypto
      .createHmac('sha256', FEISHU_SIGNING_SECRET)
      .update(`${timestamp}\n${FEISHU_SIGNING_SECRET}`)
      .digest('base64')

    return timingSafeEqual(signature, customBotSign)
  }

  return process.env.NODE_ENV !== 'production'
}

export const handleFeishuInteraction = async (req: Request, res: Response) => {
  try {
    // 飞书的 URL 验证 (Challenge)
    if (req.body.type === 'url_verification') {
      if (FEISHU_VERIFICATION_TOKEN) {
        if (req.body.token !== FEISHU_VERIFICATION_TOKEN) {
          return res.status(403).json({ error: 'invalid verification token' })
        }
        return res.json({ challenge: req.body.challenge })
      }

      if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ error: 'invalid verification token' })
      }

      return res.json({ challenge: req.body.challenge })
    }

    if (!verifyFeishuRequest(req)) {
      logger.warn('[FeishuWebhook] Rejected unsigned/invalid interaction request')
      return res.status(403).json({ error: 'invalid feishu signature' })
    }

    const { action, user } = req.body
    if (!action || !action.value) {
      return res.json({ success: true }) // 忽略不带 value 的点击
    }

    const { action: decision, operationId } = action.value
    const approverName = user?.name || '飞书用户'

    logger.info(`[FeishuWebhook] Interaction received: ${decision} for op ${operationId} by ${approverName}`)

    // 1. 找到对应的操作
    const op: any = await AgentOperation.findById(operationId)
    if (!op) {
      return res.json({ msg: '操作记录未找到' })
    }

    if (op.status !== 'pending') {
      return res.json({ msg: `该操作已处理 (当前状态: ${op.status})` })
    }

    // 2. 执行决策
    if (decision === 'approve') {
      await agentService.approveOperation(operationId, `feishu:${user?.open_id || 'unknown'}`)
    } else {
      await agentService.rejectOperation(operationId, `feishu:${user?.open_id || 'unknown'}`, 'Rejected via Feishu')
    }

    // 3. 异步更新飞书卡片状态
    const agent = await AgentConfig.findById(op.agentId)
    if (agent && req.body.open_message_id) {
      await feishuService.updateApprovalCard(req.body.open_message_id, decision === 'approve' ? 'approved' : 'rejected', approverName, agent)
    }

    // 4. 返回响应 (飞书卡片点击后可以返回一个 Toast 提示)
    res.json({
      toast: {
        type: 'success',
        content: `已成功${decision === 'approve' ? '批准' : '拒绝'}该操作`
      }
    })
  } catch (error: any) {
    logger.error('[FeishuWebhook] Error:', error.message)
    res.status(500).json({ error: error.message })
  }
}
