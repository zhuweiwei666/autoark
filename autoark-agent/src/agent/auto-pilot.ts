/**
 * Auto-Pilot — AI 接管优化师的独立快速循环
 *
 * 纯 Facebook API，不依赖 Metabase/TopTou，10 分钟一次。
 * 流程：拉数据 → Skill 决策 → 直接执行 → 飞书推送
 */
import axios from 'axios'
import dayjs from 'dayjs'
import { log } from '../platform/logger'
import { getAgentConfig } from './agent-config.model'
import { Skill, AgentSkillDoc, matchesCampaign, evaluateConditions, fillReasonTemplate } from './skill.model'
import { Action } from '../action/action.model'

const FB_GRAPH = 'https://graph.facebook.com/v21.0'

interface FBCampaignData {
  campaignId: string
  campaignName: string
  accountId: string
  accountName: string
  status: string
  dailyBudget: number
  spend: number
  impressions: number
  clicks: number
  conversions: number
  roas: number
  cpi: number
  ctr: number
  optimizer: string
  pkgName: string
}

/**
 * Auto-Pilot 主循环
 */
export async function runAutoPilot(): Promise<{ actions: any[]; campaigns: number }> {
  const fbToken = process.env.FB_ACCESS_TOKEN
  if (!fbToken) return { actions: [], campaigns: 0 }

  const config = await getAgentConfig('executor')
  const autoOptimizers: string[] = (config?.executor?.scope?.optimizers || []).map((o: string) => o.toLowerCase())

  if (autoOptimizers.length === 0) return { actions: [], campaigns: 0 }

  log.info(`[AutoPilot] Starting cycle for optimizers: ${autoOptimizers.join(', ')}`)

  // Step 1: 拉取 Facebook API 数据
  const campaigns = await fetchFBData(fbToken, autoOptimizers)
  if (campaigns.length === 0) {
    log.info('[AutoPilot] No active campaigns for managed optimizers')
    return { actions: [], campaigns: 0 }
  }

  log.info(`[AutoPilot] Fetched ${campaigns.length} campaigns, total spend $${campaigns.reduce((s, c) => s + c.spend, 0).toFixed(2)}`)

  // Step 2: Skill 决策
  const actions = await makeSkillDecisions(campaigns)
  if (actions.length === 0) {
    log.info(`[AutoPilot] No actions needed for ${campaigns.length} campaigns`)
    return { actions: [], campaigns: campaigns.length }
  }

  // Step 3: 直接执行 (Facebook API)
  const executed: any[] = []
  for (const action of actions) {
    try {
      const fbParams: any = { access_token: fbToken }
      if (action.type === 'pause') fbParams.status = 'PAUSED'
      else if (action.type === 'resume') fbParams.status = 'ACTIVE'
      else if (action.type === 'adjust_budget' && action.newBudget) fbParams.daily_budget = action.newBudget

      await axios.post(`${FB_GRAPH}/${action.campaignId}`, null, { params: fbParams, timeout: 15000 })

      await Action.create({
        type: action.type,
        platform: 'facebook',
        accountId: action.accountId,
        entityId: action.campaignId,
        entityName: action.campaignName,
        params: {
          source: 'auto_pilot',
          roasAtDecision: action.roas,
          spendAtDecision: action.spend,
          skillName: action.skillName,
          autoManaged: true,
        },
        reason: `[AutoPilot] ${action.reason}`,
        status: 'executed',
        executedAt: new Date(),
      })

      executed.push(action)
      log.info(`[AutoPilot] Executed: ${action.type} ${action.campaignName} (${action.reason})`)
    } catch (e: any) {
      log.warn(`[AutoPilot] Failed: ${action.type} ${action.campaignName} - ${e.response?.data?.error?.message || e.message}`)
    }
  }

  // Step 4: 飞书推送
  if (executed.length > 0) {
    await notifyAutoPilot(executed, campaigns.length)
  }

  log.info(`[AutoPilot] Cycle complete: ${campaigns.length} campaigns, ${executed.length} actions executed`)
  return { actions: executed, campaigns: campaigns.length }
}

// ==================== Facebook 数据拉取 ====================

async function fetchFBData(fbToken: string, optimizers: string[]): Promise<FBCampaignData[]> {
  const accountsRes = await axios.get(`${FB_GRAPH}/me/adaccounts`, {
    params: { fields: 'id,account_id,name', limit: 200, access_token: fbToken },
    timeout: 15000,
  })

  const result: FBCampaignData[] = []

  for (const acc of accountsRes.data?.data || []) {
    try {
      const campRes = await axios.get(`${FB_GRAPH}/${acc.id}/campaigns`, {
        params: { fields: 'id,name,status,daily_budget', filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]), limit: 500, access_token: fbToken },
        timeout: 15000,
      })

      for (const camp of campRes.data?.data || []) {
        const parts = camp.name.split('_')
        const optimizer = (parts[0] || '').toLowerCase()
        if (!optimizers.includes(optimizer)) continue

        let spend = 0, impressions = 0, clicks = 0, conversions = 0
        try {
          const insRes = await axios.get(`${FB_GRAPH}/${camp.id}/insights`, {
            params: { fields: 'spend,impressions,clicks,actions', date_preset: 'today', access_token: fbToken },
            timeout: 10000,
          })
          const ins = insRes.data?.data?.[0]
          if (ins) {
            spend = Number(ins.spend || 0)
            impressions = Number(ins.impressions || 0)
            clicks = Number(ins.clicks || 0)
            const instAction = (ins.actions || []).find((a: any) => a.action_type === 'app_install' || a.action_type === 'omni_app_install')
            conversions = instAction ? Number(instAction.value || 0) : 0
          }
        } catch { /* new campaign, no insights yet */ }

        result.push({
          campaignId: camp.id,
          campaignName: camp.name,
          accountId: acc.account_id,
          accountName: acc.name,
          status: camp.status,
          dailyBudget: Number(camp.daily_budget || 0) / 100,
          spend,
          impressions,
          clicks,
          conversions,
          roas: 0,
          cpi: conversions > 0 ? spend / conversions : 0,
          ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
          optimizer,
          pkgName: parts.length >= 3 ? parts[2] : '',
        })
      }
    } catch { /* skip account */ }
  }

  return result
}

// ==================== Skill 决策 ====================

async function makeSkillDecisions(campaigns: FBCampaignData[]): Promise<any[]> {
  const screenerSkills = await Skill.find({ agentId: 'screener', enabled: true }).sort({ order: 1 }).lean() as AgentSkillDoc[]
  const decisionSkills = await Skill.find({ agentId: 'decision', enabled: true }).sort({ order: 1 }).lean() as AgentSkillDoc[]
  const actions: any[] = []

  for (const c of campaigns) {
    if (c.spend < 5) continue

    const data: Record<string, any> = {
      ...c,
      todaySpend: c.spend,
      adjustedRoi: c.roas,
      todayRoas: c.roas,
      installs: c.conversions,
      estimatedDailySpend: c.spend,
      hasPendingAction: 0,
      belowBenchmarkP25: 0,
      roiDropVsYesterday: 0,
      spendTrend: 0,
    }

    // Screener: 判断是否需要决策
    let needsDecision = false
    for (const skill of screenerSkills) {
      if (!matchesCampaign(skill, c as any)) continue
      const sc = skill.screening
      if (!sc?.conditions?.length) continue
      if (evaluateConditions(sc.conditions, sc.conditionLogic, data)) {
        if (sc.verdict === 'needs_decision') needsDecision = true
        break
      }
    }

    if (!needsDecision) continue

    // Decision: 匹配决策 Skill
    for (const skill of decisionSkills) {
      if (!matchesCampaign(skill, c as any)) continue
      const d = skill.decision
      if (!d?.action) continue

      const condMatch = d.conditions?.length > 0
        ? evaluateConditions(d.conditions, d.conditionLogic, data)
        : true
      if (!condMatch) continue

      const reason = fillReasonTemplate(d.reasonTemplate || skill.name, data)
      const action: any = {
        type: d.action === 'increase_budget' ? 'adjust_budget' : d.action,
        campaignId: c.campaignId,
        campaignName: c.campaignName,
        accountId: c.accountId,
        reason,
        skillName: skill.name,
        spend: c.spend,
        roas: c.roas,
      }

      if (d.action === 'increase_budget' && d.params?.budgetChangePct) {
        action.newBudget = Math.round(c.dailyBudget * 100 * (1 + d.params.budgetChangePct / 100))
      }

      actions.push(action)
      break
    }
  }

  return actions
}

// ==================== 飞书推送 ====================

async function notifyAutoPilot(actions: any[], totalCampaigns: number): Promise<void> {
  try {
    const { loadFeishuConfig } = await import('../platform/feishu/feishu.service')
    const config = await (loadFeishuConfig as any)()
    if (!config) return

    const { default: axiosLib } = await import('axios')
    const getTenantAccessToken = async (appId: string, appSecret: string) => {
      const res = await axiosLib.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', { app_id: appId, app_secret: appSecret })
      return res.data.tenant_access_token
    }

    const token = await getTenantAccessToken(config.appId, config.appSecret)

    const lines = actions.map((a: any) => {
      const label = a.type === 'pause' ? '⏸ 暂停' : a.type === 'adjust_budget' ? '💰 调预算' : a.type === 'resume' ? '▶ 恢复' : a.type
      return `${label} **${a.campaignName}**\n花费 $${a.spend?.toFixed(2) || '?'} | ${a.reason}`
    })

    const card = {
      config: { wide_screen_mode: true },
      header: {
        template: 'violet',
        title: { content: `AutoPilot | ${dayjs().format('MM-DD HH:mm')} | ${actions.length} 操作已执行`, tag: 'plain_text' },
      },
      elements: [
        { tag: 'div', text: { content: `监控 ${totalCampaigns} 个 AI 接管 campaign，自动执行 ${actions.length} 个操作：`, tag: 'lark_md' } },
        { tag: 'hr' },
        ...lines.map(l => ({ tag: 'div' as const, text: { content: l, tag: 'lark_md' as const } })),
      ],
    }

    await axiosLib.post(
      `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${config.receiveIdType || 'chat_id'}`,
      { receive_id: config.receiveId, msg_type: 'interactive', content: JSON.stringify(card) },
      { headers: { Authorization: `Bearer ${token}` } }
    )
    log.info(`[AutoPilot] Feishu notification sent: ${actions.length} actions`)
  } catch (e: any) {
    log.warn(`[AutoPilot] Feishu notification failed: ${e.message}`)
  }
}
