/**
 * 多 Bot 飞书服务 — 支持 5 个 Agent 各自用独立机器人身份发消息
 *
 * 交互模式：A1 发主消息，A2~A5 在主消息下跟帖回复
 */
import axios from 'axios'
import { log } from '../logger'
import { getAgentConfig } from '../../agent/agent-config.model'

export type BotRole = 'a1_fusion' | 'a2_decision' | 'a3_executor' | 'a4_governor' | 'a5_knowledge'

interface BotCredential {
  appId: string
  appSecret: string
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>()

async function getTenantToken(appId: string, appSecret: string): Promise<string> {
  const key = appId
  const cached = tokenCache.get(key)
  if (cached && Date.now() < cached.expiresAt) return cached.token

  const res = await axios.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: appId,
    app_secret: appSecret,
  })

  if (res.data.code === 0) {
    const token = res.data.tenant_access_token
    tokenCache.set(key, { token, expiresAt: Date.now() + (res.data.expire - 60) * 1000 })
    return token
  }
  throw new Error(`Feishu auth failed for ${appId}: ${res.data.msg}`)
}

export interface MultiBotConfig {
  enabled: boolean
  receiveId: string
  receiveIdType: string
  bots: Record<BotRole, BotCredential>
}

export async function loadMultiBotConfig(): Promise<MultiBotConfig | null> {
  const config = await getAgentConfig('feishu')
  if (!config?.feishu?.enabled) return null

  const feishu = config.feishu
  const bots: Record<string, BotCredential> = feishu.bots || {}

  const defaultBot: BotCredential = { appId: feishu.appId, appSecret: feishu.appSecret }

  return {
    enabled: true,
    receiveId: feishu.receiveId,
    receiveIdType: feishu.receiveIdType || 'chat_id',
    bots: {
      a1_fusion: bots.a1_fusion || defaultBot,
      a2_decision: bots.a2_decision || defaultBot,
      a3_executor: bots.a3_executor || defaultBot,
      a4_governor: bots.a4_governor || defaultBot,
      a5_knowledge: bots.a5_knowledge || defaultBot,
    },
  }
}

/**
 * 用指定 Agent Bot 发送一条主消息（卡片或文本）
 * 返回 message_id，后续 Agent 可用此 ID 跟帖回复
 */
export async function sendBotMessage(
  role: BotRole,
  config: MultiBotConfig,
  content: string | object,
  msgType: 'interactive' | 'text' = 'interactive',
): Promise<string | null> {
  const bot = config.bots[role]
  if (!bot) return null

  try {
    const token = await getTenantToken(bot.appId, bot.appSecret)
    const body: any = {
      receive_id: config.receiveId,
      msg_type: msgType,
      content: typeof content === 'string' ? content : JSON.stringify(content),
    }

    const res = await axios.post(
      `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${config.receiveIdType}`,
      body,
      { headers: { Authorization: `Bearer ${token}` } },
    )

    if (res.data.code === 0) {
      return res.data.data?.message_id || null
    }
    log.error(`[MultiBot:${role}] Send failed: ${res.data.msg}`)
    return null
  } catch (e: any) {
    log.error(`[MultiBot:${role}] Send error: ${e.response?.data?.msg || e.message}`)
    return null
  }
}

/**
 * 用指定 Agent Bot 回复一条消息（跟帖）
 */
export async function replyBotMessage(
  role: BotRole,
  config: MultiBotConfig,
  parentMessageId: string,
  content: string | object,
  msgType: 'interactive' | 'text' = 'interactive',
): Promise<string | null> {
  const bot = config.bots[role]
  if (!bot) return null

  try {
    const token = await getTenantToken(bot.appId, bot.appSecret)
    const body: any = {
      msg_type: msgType,
      content: typeof content === 'string' ? content : JSON.stringify(content),
    }

    const res = await axios.post(
      `https://open.feishu.cn/open-apis/im/v1/messages/${parentMessageId}/reply`,
      body,
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
    )

    if (res.data.code === 0) {
      return res.data.data?.message_id || null
    }
    log.error(`[MultiBot:${role}] Reply failed: ${res.data.msg}`)
    return null
  } catch (e: any) {
    log.error(`[MultiBot:${role}] Reply error: ${e.response?.data?.msg || e.message}`)
    return null
  }
}
