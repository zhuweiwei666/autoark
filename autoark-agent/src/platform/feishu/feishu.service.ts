/**
 * 飞书服务 — Token 管理 + 消息推送 + Webhook
 *
 * 推送策略：
 * 1. 摘要卡片：每轮推送，包含 needs_decision campaign 的明细（可展开）
 * 2. 紧急止损卡片：仅 critical + auto 的暂停操作独立推送（带审批按钮）
 * 3. 非紧急操作：合并在摘要卡片明细里，不单独推送
 */
import axios from 'axios'
import { log } from '../logger'
import { getAgentConfig } from '../../agent/agent-config.model'
import { buildSummaryCard, buildAutoExecutedCard, buildApprovalCard } from './cards'
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
  screenedCampaigns: any[]
}

/**
 * Brain cycle 结束后调用
 *
 * 推送策略：
 * 1. 摘要卡片 — 每轮一张，包含明细列表
 * 2. 已自动执行 — auto=true + executed 的操作，推"已执行"通知（不带按钮）
 * 3. 审批卡片 — auto=false 的操作，推审批卡片（带批准/拒绝按钮）
 */
export async function notifyFeishu(params: NotifyFeishuParams): Promise<void> {
  const config = await loadFeishuConfig()
  if (!config) return

  const { notifications } = config

  if (notifications.onlyWhenActions && params.actions.length === 0 && params.screening.needsDecision === 0) {
    log.info('[Feishu] No actions or decisions, skipping (onlyWhenActions=true)')
    return
  }

  // 1. 摘要卡片（含 needs_decision 明细）
  if (notifications.cycleSummary) {
    const card = buildSummaryCard(params)
    await sendCard(card, config)
    log.info('[Feishu] Summary card sent')
  }

  // 2. 已自动执行的操作 — 单独推送"已执行"通知
  if (notifications.urgentAlert) {
    const autoExecuted = params.actions.filter((a: any) => a.auto === true && a.executed === true)
    for (const action of autoExecuted) {
      const campaign = params.screenedCampaigns?.find((c: any) => c.campaignId === action.campaignId)
      const card = buildAutoExecutedCard(action, campaign, params.benchmarks)
      await sendCard(card, config)
    }
    if (autoExecuted.length > 0) {
      log.info(`[Feishu] ${autoExecuted.length} auto-executed notification cards sent`)
    }
  }

  // 3. 待审批操作 — 推送审批卡片
  if (notifications.approvalCard) {
    const pendingActions = params.actions.filter((a: any) => !a.auto && !a.executed)
    for (const action of pendingActions) {
      const campaign = params.screenedCampaigns?.find((c: any) => c.campaignId === action.campaignId)
      const card = buildApprovalCard(action, campaign, params.benchmarks)
      await sendCard(card, config)
    }
    if (pendingActions.length > 0) {
      log.info(`[Feishu] ${pendingActions.length} approval cards sent`)
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
