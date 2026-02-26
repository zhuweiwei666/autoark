/**
 * 飞书 Webhook 回调
 *
 * POST /interaction — 卡片交互（审批/拒绝 + Skill 确认/取消）
 * POST /event       — 事件订阅（@Agent 指令 + 普通对话）
 */
import axios from 'axios'
import { Router, Request, Response } from 'express'
import { log } from '../logger'
import { Action } from '../../action/action.model'
import { User } from '../../auth/user.model'
import { updateApprovalStatus, replyMessage, getBotId } from './feishu.service'
import { loadMultiBotConfig, sendBotMessage, replyBotMessage, BotRole } from './multi-bot'
import { executeWithRetry } from '../../agent/brain'
import { chat } from '../../agent/agent'
import { parseSkillIntent, listSkills, buildDiff, applySkillChange } from '../../agent/skill-editor'

const FB_GRAPH = 'https://graph.facebook.com/v21.0'

const router = Router()

const processedEvents = new Set<string>()

const pendingSkillEdits = new Map<string, {
  skillId: string
  changes: Record<string, any>
  agentRole: BotRole
  summary: string
  expiresAt: number
}>()

async function getOrCreateFeishuUser(openId: string): Promise<string> {
  const username = `feishu_${openId.slice(-8)}`
  let user = await User.findOne({ username })
  if (!user) {
    user = await User.create({ username, password: `feishu_${Date.now()}`, role: 'user' })
    log.info(`[FeishuEvent] Created user: ${username} (${user._id})`)
  }
  return user._id.toString()
}

// ==================== Bot open_id -> Agent Role 映射 ====================

let botIdToRole: Map<string, BotRole> | null = null

async function getBotRoleMap(): Promise<Map<string, BotRole>> {
  if (botIdToRole && botIdToRole.size > 0) return botIdToRole

  botIdToRole = new Map()
  const mbConfig = await loadMultiBotConfig()
  if (!mbConfig) return botIdToRole

  const roles: BotRole[] = ['a1_fusion', 'a2_decision', 'a3_executor', 'a4_governor', 'a5_knowledge']
  for (const role of roles) {
    const bot = mbConfig.bots[role]
    if (!bot?.appId) continue
    try {
      const tokenRes = await axios.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        app_id: bot.appId, app_secret: bot.appSecret,
      })
      if (tokenRes.data.code !== 0) continue
      const token = tokenRes.data.tenant_access_token

      const infoRes = await axios.get('https://open.feishu.cn/open-apis/bot/v3/info', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const openId = infoRes.data.bot?.open_id
      if (openId) {
        botIdToRole!.set(openId, role)
        log.info(`[BotMap] ${role} -> ${openId}`)
      }
    } catch (e: any) {
      log.warn(`[BotMap] Failed to get bot info for ${role}: ${e.message}`)
    }
  }

  return botIdToRole
}

// ==================== /interaction — 卡片交互 ====================

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

    // ── Skill 确认/取消 ──
    if (decision === 'skill_confirm' || decision === 'skill_cancel') {
      const editId = typeof actionData === 'string' ? actionData : actionData?.editId
      const pending = pendingSkillEdits.get(editId)

      if (!pending || Date.now() > pending.expiresAt) {
        return res.json({ toast: { type: 'warning', content: '修改请求已过期，请重新发起' } })
      }

      if (decision === 'skill_confirm') {
        const ok = await applySkillChange(pending.skillId, pending.changes)
        pendingSkillEdits.delete(editId)

        const mbConfig = await loadMultiBotConfig()
        if (mbConfig) {
          await sendBotMessage(pending.agentRole, mbConfig,
            JSON.stringify({ text: `Skill 修改已生效: ${pending.summary}\n操作人: ${approver}` }),
            'text',
          )
        }

        return res.json({ toast: { type: 'success', content: ok ? 'Skill 已更新' : '更新失败' } })
      } else {
        pendingSkillEdits.delete(editId)
        return res.json({ toast: { type: 'info', content: '已取消修改' } })
      }
    }

    // ── 原有审批逻辑 ──
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
        const actionType = (dbAction as any).type
        const entityId = (dbAction as any).entityId
        let executed = false

        const fbToken = process.env.FB_ACCESS_TOKEN
        if (fbToken && entityId) {
          try {
            const fbParams: any = { access_token: fbToken }
            if (actionType === 'pause') fbParams.status = 'PAUSED'
            else if (actionType === 'resume') fbParams.status = 'ACTIVE'
            else if (actionType === 'adjust_budget' && (dbAction as any).params?.newBudget) {
              fbParams.daily_budget = (dbAction as any).params.newBudget
            }

            await axios.post(`${FB_GRAPH}/${entityId}`, null, { params: fbParams, timeout: 15000 })
            log.info(`[FeishuWebhook] Executed via Facebook API: ${actionType} ${entityId}`)
            executed = true
          } catch (fbErr: any) {
            log.warn(`[FeishuWebhook] Facebook API failed, falling back to TopTou: ${fbErr.response?.data?.error?.message || fbErr.message}`)
          }
        }

        if (!executed) {
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
          log.info(`[FeishuWebhook] Executed via TopTou fallback: ${actionType} ${entityId}`)
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

// ==================== /event — @Agent 指令 + 普通对话 ====================

router.post('/event', async (req: Request, res: Response) => {
  try {
    if (req.body.type === 'url_verification') {
      return res.json({ challenge: req.body.challenge })
    }

    const { header, event } = req.body
    if (!header || !event) {
      return res.json({ code: 0 })
    }

    res.json({ code: 0 })

    const eventId = header.event_id
    if (!eventId || processedEvents.has(eventId)) return
    processedEvents.add(eventId)
    setTimeout(() => processedEvents.delete(eventId), 300000)

    if (header.event_type !== 'im.message.receive_v1') return
    const msgType = event.message?.message_type
    if (msgType !== 'text') return

    const senderId = event.sender?.sender_id?.open_id
    const messageId = event.message?.message_id

    // 过滤所有 bot 自己的消息
    const roleMap = await getBotRoleMap()
    if (roleMap.has(senderId)) return

    const botId = await getBotId()
    if (botId && senderId === botId) return

    let text = ''
    try {
      const content = JSON.parse(event.message?.content || '{}')
      text = (content.text || '').trim()
    } catch { return }

    // 识别被 @的 bot
    const mentions: Array<{ id: { open_id: string }; key: string }> = event.message?.mentions || []
    let targetRole: BotRole | null = null
    for (const mention of mentions) {
      const role = roleMap.get(mention.id?.open_id)
      if (role) {
        targetRole = role
        break
      }
    }

    // 清理 @标记
    text = text.replace(/@_user_\d+/g, '').trim()
    if (!text) return

    log.info(`[FeishuEvent] From ${senderId}: "${text.substring(0, 80)}" target=${targetRole || 'none'}`)

    // ── 所有 @Agent 指令统一由 A5 处理 Skill 编辑 ──
    if (targetRole) {
      const replyAs: BotRole = 'a5_knowledge'
      try {
        const mbConfig = await loadMultiBotConfig()
        if (!mbConfig) return

        // A5 统一管理所有 Agent 的 Skill，从文本推断目标 Agent
        const intent = await parseSkillIntent(text, targetRole !== 'a5_knowledge' ? targetRole : undefined)

        if (intent.action === 'list') {
          const skillsText = await listSkills(intent.targetAgent || (targetRole !== 'a5_knowledge' ? targetRole : undefined))
          await replyBotMessage(replyAs, mbConfig, messageId, JSON.stringify({ text: skillsText }), 'text')
          return
        }

        if (intent.action === 'modify' || intent.action === 'toggle') {
          const diff = await buildDiff(intent)
          if (!diff) {
            await replyBotMessage(replyAs, mbConfig, messageId,
              JSON.stringify({ text: `未找到匹配的 Skill "${intent.skillName || ''}"，请检查名称。\n\n@A5知识管理 列出skills 查看所有 Skill` }),
              'text',
            )
            return
          }

          const editId = `se_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
          pendingSkillEdits.set(editId, {
            skillId: diff.skillId,
            changes: intent.changes!,
            agentRole: replyAs,
            summary: diff.summary,
            expiresAt: Date.now() + 5 * 60 * 1000,
          })

          const beforeLines = Object.entries(diff.before).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')
          const afterLines = Object.entries(diff.after).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')

          const diffCard = {
            config: { wide_screen_mode: true },
            header: {
              template: 'orange',
              title: { content: `[A5] Skill 修改预览 | ${diff.skillName}`, tag: 'plain_text' },
            },
            elements: [
              { tag: 'div', text: { content: `**Skill**: ${diff.skillName}\n**所属 Agent**: ${diff.agentId}\n**操作**: ${diff.summary}`, tag: 'lark_md' } },
              { tag: 'hr' },
              { tag: 'div', text: { content: `**修改前**:\n${beforeLines}`, tag: 'lark_md' } },
              { tag: 'div', text: { content: `**修改后**:\n${afterLines}`, tag: 'lark_md' } },
              { tag: 'hr' },
              {
                tag: 'action',
                actions: [
                  {
                    tag: 'button',
                    text: { content: '确认执行', tag: 'plain_text' },
                    type: 'primary',
                    value: { action: 'skill_confirm', actionData: editId },
                  },
                  {
                    tag: 'button',
                    text: { content: '取消', tag: 'plain_text' },
                    type: 'default',
                    value: { action: 'skill_cancel', actionData: editId },
                  },
                ],
              },
              { tag: 'note', elements: [{ tag: 'plain_text', content: `5分钟内有效 | EditId: ${editId}` }] },
            ],
          }

          await replyBotMessage(replyAs, mbConfig, messageId, diffCard)
          log.info(`[SkillEdit] Diff card sent for ${diff.skillName} (agent: ${diff.agentId}), editId=${editId}`)
          return
        }

        if (intent.action === 'create') {
          await replyBotMessage(replyAs, mbConfig, messageId,
            JSON.stringify({ text: `创建新 Skill 功能开发中。\n\n你的描述: ${intent.description || text}` }),
            'text',
          )
          return
        }

        if (intent.action === 'delete') {
          await replyBotMessage(replyAs, mbConfig, messageId,
            JSON.stringify({ text: `建议先禁用而非删除。\n发送: "@A5知识管理 禁用 ${intent.skillName}" 来禁用它。` }),
            'text',
          )
          return
        }
      } catch (skillErr: any) {
        log.error(`[SkillEdit] Error: ${skillErr.message}`)
        try {
          const mbConfig = await loadMultiBotConfig()
          if (mbConfig) {
            await replyBotMessage(replyAs, mbConfig, messageId,
              JSON.stringify({ text: `[A5] 处理指令出错: ${skillErr.message}` }),
              'text',
            )
          }
        } catch { /* last resort, ignore */ }
      }
      return
    }

    // ── 普通对话（未 @特定 Agent）──
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
