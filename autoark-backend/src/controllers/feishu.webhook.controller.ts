import { Request, Response } from 'express'
import logger from '../utils/logger'
import { AgentOperation, AgentConfig } from '../domain/agent/agent.model'
import { agentService } from '../domain/agent/agent.service'
import { feishuService } from '../services/feishu.service'

/**
 * 飞书 Webhook 回调控制层
 * 处理飞书消息卡片的交互点击
 */
export const handleFeishuInteraction = async (req: Request, res: Response) => {
  try {
    // 飞书的 URL 验证 (Challenge)
    if (req.body.type === 'url_verification') {
      return res.json({ challenge: req.body.challenge })
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
