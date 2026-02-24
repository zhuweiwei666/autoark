/**
 * 飞书服务 — Token 管理 + 消息推送 + Webhook
 */
import axios from 'axios'
import { log } from '../logger'
import { getAgentConfig } from '../../agent/agent-config.model'
import { buildSummaryCard, buildApprovalCard, buildAlertCard } from './cards'
import type { ScreeningSummary } from '../../agent/screener'
import type { MarketBenchmark } from '../../agent/brain'

// ==================== Token 管理 ====================

let tenantToken: string | null = null
let tokenExpiresAt = 0

async function getTenantAccessToken(appId: string, appSecret: string): Promise<string> {
  if (tenantToken && Date.now() < tokenExpiresAt) return tenantToken

  const res = await axios.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: appId,
    app_secret: appSecret,
  })

  if (res.data.code === 0) {
    tenantToken = res.data.tenant_access_token
    tokenExpiresAt = Date.now() + (res.data.expire - 60) * 1000
    return tenantToken!
  }
  throw new Error(`Feishu Auth Failed: ${res.data.msg}`)
}

// ==================== 配置加载 ====================

interface FeishuConfig {
  enabled: boolean
  appId: string
  appSecret: string
  receiveId: string
  receiveIdType: string
  notifications: {
    cycleSummary: boolean
    approvalCard: boolean
    urgentAlert: boolean
    onlyWhenActions: boolean
  }
}

async function loadFeishuConfig(): Promise<FeishuConfig | null> {
  const config = await getAgentConfig('feishu')
  if (!config?.feishu?.enabled) return null
  return config.feishu as FeishuConfig
}

// ==================== 发送消息 ====================

async function sendCard(card: any, config: FeishuConfig): Promise<string | null> {
  try {
    const token = await getTenantAccessToken(config.appId, config.appSecret)
    const res = await axios.post(
      `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${config.receiveIdType || 'chat_id'}`,
      {
        receive_id: config.receiveId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      },
      { headers: { Authorization: `Bearer ${token}` } }
    )

    if (res.data.code === 0) {
      return res.data.data?.message_id || null
    }
    log.error(`[Feishu] Send card failed: ${res.data.msg}`)
    return null
  } catch (e: any) {
    log.error(`[Feishu] Send card error: ${e.response?.data?.msg || e.message}`)
    return null
  }
}

async function updateCard(messageId: string, card: any, config: FeishuConfig): Promise<boolean> {
  try {
    const token = await getTenantAccessToken(config.appId, config.appSecret)
    const res = await axios.patch(
      `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}`,
      { content: JSON.stringify(card) },
      { headers: { Authorization: `Bearer ${token}` } }
    )
    return res.data.code === 0
  } catch (e: any) {
    log.error(`[Feishu] Update card error: ${e.message}`)
    return false
  }
}

// ==================== 对外接口 ====================

export interface NotifyFeishuParams {
  screening: ScreeningSummary
  actions: any[]
  events: any[]
  benchmarks: MarketBenchmark
  summary: string
  classSummary?: Record<string, number>
}

/**
 * Brain cycle 结束后调用：推送摘要 + 审批卡片
 */
export async function notifyFeishu(params: NotifyFeishuParams): Promise<void> {
  const config = await loadFeishuConfig()
  if (!config) return

  const { notifications } = config

  if (notifications.onlyWhenActions && params.actions.length === 0) {
    log.info('[Feishu] No actions, skipping notification (onlyWhenActions=true)')
    return
  }

  if (notifications.cycleSummary) {
    const card = buildSummaryCard(params)
    await sendCard(card, config)
    log.info('[Feishu] Summary card sent')
  }

  if (notifications.approvalCard) {
    for (const action of params.actions.filter((a: any) => !a.auto)) {
      const card = buildApprovalCard(action, params.benchmarks)
      await sendCard(card, config)
    }
    if (params.actions.filter((a: any) => !a.auto).length > 0) {
      log.info(`[Feishu] ${params.actions.filter((a: any) => !a.auto).length} approval cards sent`)
    }
  }

  if (notifications.urgentAlert) {
    const criticals = params.events.filter((e: any) => e.type === 'spend_spike' || e.type === 'roas_crash')
    for (const event of criticals) {
      const card = buildAlertCard(event)
      await sendCard(card, config)
    }
  }
}

/**
 * 审批通过/拒绝后更新飞书卡片
 */
export async function updateApprovalStatus(
  messageId: string,
  status: 'approved' | 'rejected',
  approver: string,
): Promise<void> {
  const config = await loadFeishuConfig()
  if (!config) return

  const color = status === 'approved' ? 'green' : 'grey'
  const text = status === 'approved' ? '已通过审批' : '已拒绝'

  const card = {
    config: { wide_screen_mode: true },
    header: { template: color, title: { content: `AutoArk 策略审批: ${text}`, tag: 'plain_text' } },
    elements: [
      { tag: 'div', text: { content: `审批人: **${approver}** | 状态: ${text}`, tag: 'lark_md' } },
    ],
  }

  await updateCard(messageId, card, config)
}
