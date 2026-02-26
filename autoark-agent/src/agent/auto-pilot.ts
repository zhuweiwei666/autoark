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
import { createDecisionTrace, appendTraceStep } from './collab/types'

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

  // Step 1.5: 从 Metabase 补充 ROAS 和 CPI（FB API 没有 revenue 时）
  await enrichWithMetabase(campaigns)

  // 按花费从高到低排序
  campaigns.sort((a, b) => b.spend - a.spend)

  const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0)
  const withRoas = campaigns.filter(c => c.roas > 0).length
  log.info(`[AutoPilot] Fetched ${campaigns.length} campaigns, spend $${totalSpend.toFixed(2)}, ${withRoas} with ROAS data`)

  // Step 2: Skill 决策
  const { verdicts, actions } = await makeSkillDecisions(campaigns)

  // Step 3: 直接执行 (Facebook API)
  for (const action of actions) {
    const v = verdicts.find(vv => vv.campaign.campaignId === action.campaignId)
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

      if (v) v.execResult = 'executed'
      log.info(`[AutoPilot] Executed: ${action.type} ${action.campaignName} (${action.reason})`)
    } catch (e: any) {
      const errMsg = e.response?.data?.error?.message || e.message
      if (v) { v.execResult = 'failed'; v.execError = errMsg }
      log.warn(`[AutoPilot] Failed: ${action.type} ${action.campaignName} - ${errMsg}`)
    }
  }

  // Step 4: 飞书推送（每次都推，展示全部 campaign 数据）
  await notifyAutoPilot(verdicts, campaigns.length)

  const executedCount = verdicts.filter(v => v.execResult === 'executed').length
  log.info(`[AutoPilot] Cycle complete: ${campaigns.length} campaigns, ${actions.length} actions, ${executedCount} executed`)
  return { actions: actions.filter((_, i) => verdicts.find(v => v.campaign.campaignId === actions[i]?.campaignId)?.execResult === 'executed'), campaigns: campaigns.length }
}

// ==================== Metabase 补充 ROAS/CPI ====================

async function enrichWithMetabase(campaigns: FBCampaignData[]): Promise<void> {
  try {
    const today = dayjs().format('YYYY-MM-DD')
    const { collectData } = await import('./monitor/data-collector')
    const mbData = await collectData(today, today)

    const mbMap = new Map<string, any>()
    for (const m of mbData) {
      mbMap.set(m.campaignId, m)
    }

    let enriched = 0
    for (const c of campaigns) {
      const mb = mbMap.get(c.campaignId)
      if (!mb) continue

      // ROAS: FB API 优先（purchase_roas），没有时用 Metabase
      if (c.roas === 0) {
        if (mb.adjustedRoi > 0) c.roas = mb.adjustedRoi
        else if (mb.firstDayRoi > 0) c.roas = mb.firstDayRoi
      }

      // CPI: FB API 优先，没有时用 Metabase（首日UV 口径）
      if (c.cpi === 0 && mb.cpi > 0) c.cpi = mb.cpi

      // 安装量: FB API 优先，没有时用 Metabase 首日UV
      if (c.conversions === 0 && mb.installs > 0) c.conversions = mb.installs

      // 花费: 取较大值
      if (mb.spend > c.spend) c.spend = mb.spend

      enriched++
    }

    log.info(`[AutoPilot] Metabase enriched: ${enriched}/${campaigns.length} campaigns with ROAS/CPI`)
  } catch (e: any) {
    log.warn(`[AutoPilot] Metabase enrichment failed (using FB data only): ${e.message}`)
  }
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

        let spend = 0, impressions = 0, clicks = 0, conversions = 0, roas = 0, revenue = 0
        try {
          const insRes = await axios.get(`${FB_GRAPH}/${camp.id}/insights`, {
            params: { fields: 'spend,impressions,clicks,actions,action_values,purchase_roas', date_preset: 'today', access_token: fbToken },
            timeout: 10000,
          })
          const ins = insRes.data?.data?.[0]
          if (ins) {
            spend = Number(ins.spend || 0)
            impressions = Number(ins.impressions || 0)
            clicks = Number(ins.clicks || 0)

            const instAction = (ins.actions || []).find((a: any) => a.action_type === 'app_install' || a.action_type === 'omni_app_install')
            conversions = instAction ? Number(instAction.value || 0) : 0

            // ROAS: 优先用 purchase_roas，否则从 action_values 算
            const purchaseRoas = ins.purchase_roas?.find((a: any) => a.action_type === 'omni_purchase')
            if (purchaseRoas) {
              roas = Number(purchaseRoas.value || 0)
            }

            // Revenue: 从 action_values 的 omni_purchase 取
            const purchaseValue = (ins.action_values || []).find((a: any) => a.action_type === 'omni_purchase')
            if (purchaseValue) {
              revenue = Number(purchaseValue.value || 0)
              if (roas === 0 && spend > 0) roas = revenue / spend
            }

            // 购买次数作为转化（如果没有 install 数据）
            if (conversions === 0) {
              const purchaseAction = (ins.actions || []).find((a: any) => a.action_type === 'omni_purchase' || a.action_type === 'purchase')
              if (purchaseAction) conversions = Number(purchaseAction.value || 0)
            }
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
          roas,
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

// ==================== 推理记录 ====================

interface CampaignVerdict {
  campaign: FBCampaignData
  screenVerdict: 'needs_decision' | 'watch' | 'skip'
  screenSkill: string
  screenReason: string
  action?: { type: string; reason: string; skillName: string; newBudget?: number }
  execResult?: 'executed' | 'failed' | 'skipped'
  execError?: string
}

// ==================== Skill 决策 ====================

async function makeSkillDecisions(campaigns: FBCampaignData[]): Promise<{ verdicts: CampaignVerdict[]; actions: any[] }> {
  const screenerSkills = await Skill.find({ agentId: 'screener', enabled: true }).sort({ order: 1 }).lean() as AgentSkillDoc[]
  const decisionSkills = await Skill.find({ agentId: 'decision', enabled: true }).sort({ order: 1 }).lean() as AgentSkillDoc[]
  const verdicts: CampaignVerdict[] = []
  const actions: any[] = []

  for (const c of campaigns) {
    const verdict: CampaignVerdict = {
      campaign: c,
      screenVerdict: 'watch',
      screenSkill: '',
      screenReason: '',
    }

    if (c.spend < 5) {
      verdict.screenVerdict = 'skip'
      verdict.screenSkill = '冷启动保护'
      verdict.screenReason = `花费 $${c.spend.toFixed(2)} < $5，数据不足`
      verdicts.push(verdict)
      continue
    }

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

    // Screener
    for (const skill of screenerSkills) {
      if (!matchesCampaign(skill, c as any)) continue
      const sc = skill.screening
      if (!sc?.conditions?.length) continue
      if (evaluateConditions(sc.conditions, sc.conditionLogic, data)) {
        verdict.screenVerdict = sc.verdict
        verdict.screenSkill = skill.name
        verdict.screenReason = fillReasonTemplate(sc.reasonTemplate || skill.name, data)
        break
      }
    }

    if (verdict.screenVerdict !== 'needs_decision') {
      if (!verdict.screenSkill) {
        verdict.screenReason = '未匹配任何筛选规则，继续观察'
      }
      verdicts.push(verdict)
      continue
    }

    // Decision
    for (const skill of decisionSkills) {
      if (!matchesCampaign(skill, c as any)) continue
      const d = skill.decision
      if (!d?.action) continue
      const condMatch = d.conditions?.length > 0
        ? evaluateConditions(d.conditions, d.conditionLogic, data)
        : true
      if (!condMatch) continue

      const reason = fillReasonTemplate(d.reasonTemplate || skill.name, data)
      verdict.action = { type: d.action, reason, skillName: skill.name }

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
        verdict.action.newBudget = action.newBudget
      }
      actions.push(action)
      break
    }

    verdicts.push(verdict)
  }

  return { verdicts, actions }
}

// ==================== 飞书推送（5 Bot 独立发言 + 跟帖）====================

async function notifyAutoPilot(verdicts: CampaignVerdict[], totalCampaigns: number): Promise<void> {
  try {
    const { loadMultiBotConfig, sendBotMessage, replyBotMessage } = await import('../platform/feishu/multi-bot')
    const mbConfig = await loadMultiBotConfig()
    if (!mbConfig) return

    const totalSpend = verdicts.reduce((s, v) => s + v.campaign.spend, 0)
    const executedCount = verdicts.filter(v => v.execResult === 'executed').length
    const failedCount = verdicts.filter(v => v.execResult === 'failed').length
    const needsDecision = verdicts.filter(v => v.screenVerdict === 'needs_decision').length
    const watching = verdicts.filter(v => v.screenVerdict === 'watch').length
    const skipped = verdicts.filter(v => v.screenVerdict === 'skip').length
    const roasArr = verdicts.filter(v => v.campaign.roas > 0)
    const avgRoas = roasArr.length > 0 ? roasArr.reduce((s, v) => s + v.campaign.roas, 0) / roasArr.length : 0
    const traceId = `ap-${dayjs().format('YYMMDDHHmm')}`
    const now = dayjs().format('MM-DD HH:mm')

    // ── A1 数据融合：发主消息 ──
    const topCampaigns = verdicts.slice(0, 8).map(v => {
      const c = v.campaign
      return `${c.campaignName}: 花费 $${c.spend.toFixed(2)} | ROAS ${c.roas.toFixed(2)} | 安装 ${c.conversions}`
    }).join('\n')

    const a1Card = {
      config: { wide_screen_mode: true },
      header: { template: 'blue', title: { content: `[A1 数据融合] ${now} | ${totalCampaigns} campaign | $${totalSpend.toFixed(2)}`, tag: 'plain_text' } },
      elements: [
        { tag: 'div', fields: [
          { is_short: true, text: { content: `**Campaign**\n${totalCampaigns}`, tag: 'lark_md' } },
          { is_short: true, text: { content: `**总花费**\n$${totalSpend.toFixed(2)}`, tag: 'lark_md' } },
          { is_short: true, text: { content: `**均值ROAS**\n${avgRoas.toFixed(2)}`, tag: 'lark_md' } },
          { is_short: true, text: { content: `**有ROAS数据**\n${roasArr.length}/${totalCampaigns}`, tag: 'lark_md' } },
        ]},
        { tag: 'div', text: { content: `**数据源**: Facebook API（实时） + Metabase（后端补充）\n**融合策略**: Facebook 花费/状态优先，Metabase ROAS/CPI 补充\n**数据质量**: ${roasArr.length}/${totalCampaigns} 有 ROAS 数据`, tag: 'lark_md' } },
        { tag: 'hr' },
        { tag: 'collapsible_panel', expanded: false, header: { title: { tag: 'plain_text', content: `Campaign 快照 (Top ${Math.min(8, verdicts.length)})` } }, border: { color: 'blue' }, vertical_spacing: '8px',
          elements: [{ tag: 'div', text: { content: topCampaigns || '暂无数据', tag: 'lark_md' } }],
        },
        { tag: 'note', elements: [{ tag: 'plain_text', content: `TraceId: ${traceId} | 数据已交付 → A2 决策分析` }] },
      ],
    }
    const a1MessageId = await sendBotMessage('a1_fusion', mbConfig, a1Card)
    if (!a1MessageId) {
      log.warn('[AutoPilot] A1 message failed, aborting multi-bot flow')
      return
    }
    log.info(`[AutoPilot] A1 数据融合 sent: ${a1MessageId}`)

    // ── A2 决策分析：跟帖回复 ──
    const decisionLines = verdicts.filter(v => v.action).slice(0, 5).map(v => {
      const c = v.campaign
      return `**${c.campaignName}**\n筛选: ${v.screenSkill} → 决策: ${v.action!.type}\nROAS ${c.roas.toFixed(2)} | 花费 $${c.spend.toFixed(2)} | 原因: ${v.action!.reason}`
    }).join('\n---\n')

    const a2Card = {
      config: { wide_screen_mode: true },
      header: { template: 'orange', title: { content: `[A2 决策分析] ${needsDecision} 需决策 | ${executedCount + failedCount} 条动作`, tag: 'plain_text' } },
      elements: [
        { tag: 'div', text: { content: `**筛选结果**: 需决策 **${needsDecision}** | 观察 ${watching} | 跳过 ${skipped}`, tag: 'lark_md' } },
        ...(decisionLines ? [{ tag: 'hr' }, { tag: 'div', text: { content: decisionLines, tag: 'lark_md' } }] : [{ tag: 'div', text: { content: '本轮所有 campaign 在安全范围内，无需干预', tag: 'lark_md' } }]),
        { tag: 'note', elements: [{ tag: 'plain_text', content: `TraceId: ${traceId} | 决策已交付 → A3 执行路由` }] },
      ],
    }
    const a2MessageId = await replyBotMessage('a2_decision', mbConfig, a1MessageId, a2Card)
    log.info(`[AutoPilot] A2 决策分析 replied: ${a2MessageId}`)

    // ── A3 执行路由：跟帖回复 ──
    const execLines = verdicts.filter(v => v.execResult).slice(0, 5).map(v => {
      const c = v.campaign
      const icon = v.execResult === 'executed' ? '✅' : '❌'
      const label = v.action?.type === 'pause' ? '暂停' : v.action?.type === 'increase_budget' ? '加预算' : v.action?.type || '?'
      return `${icon} **${label}** ${c.campaignName}\n路由: facebook_api | 原因: ${v.action?.reason || '-'}${v.execError ? `\n错误: ${v.execError}` : ''}`
    }).join('\n---\n')

    const a3Card = {
      config: { wide_screen_mode: true },
      header: { template: executedCount > 0 ? 'green' : 'turquoise', title: { content: `[A3 执行路由] 成功 ${executedCount} | 失败 ${failedCount}`, tag: 'plain_text' } },
      elements: [
        { tag: 'div', text: { content: execLines || '本轮无执行动作，所有 campaign 维持当前状态', tag: 'lark_md' } },
        { tag: 'note', elements: [{ tag: 'plain_text', content: `TraceId: ${traceId} | 执行结果已交付 → A4 全局治理` }] },
      ],
    }
    const a3MessageId = await replyBotMessage('a3_executor', mbConfig, a1MessageId, a3Card)
    log.info(`[AutoPilot] A3 执行路由 replied: ${a3MessageId}`)

    // ── A4 全局治理：跟帖回复 ──
    let riskLevel: 'low' | 'medium' | 'high' = 'low'
    const overrides: string[] = []
    if (avgRoas < 0.8 && avgRoas > 0) {
      riskLevel = 'high'
      overrides.push('ROAS 低于硬阈值，暂停所有放量动作并优先止损')
      if (watching > needsDecision) overrides.push('从观察池提取低风险素材小流量验证')
    } else if (avgRoas < 1.0 && avgRoas > 0) {
      riskLevel = 'medium'
      overrides.push('ROAS 接近阈值，控制学习期广告占比')
    }
    const riskLabel = riskLevel === 'high' ? '🔴 高风险' : riskLevel === 'medium' ? '🟡 中风险' : '🟢 低风险'
    const goalLine = overrides.length > 0 ? `**纠偏指令**:\n${overrides.map(o => `• ${o}`).join('\n')}` : `ROAS ${avgRoas.toFixed(2)} 达标，本轮动作符合全局目标`

    const a4Card = {
      config: { wide_screen_mode: true },
      header: { template: riskLevel === 'high' ? 'red' : riskLevel === 'medium' ? 'orange' : 'green', title: { content: `[A4 全局治理] ${riskLabel} | ROAS ${avgRoas.toFixed(2)}`, tag: 'plain_text' } },
      elements: [
        { tag: 'div', text: { content: `**风险评估**: ${riskLabel}\n**均值 ROAS**: ${avgRoas.toFixed(2)}\n${goalLine}`, tag: 'lark_md' } },
        { tag: 'note', elements: [{ tag: 'plain_text', content: `TraceId: ${traceId} | 治理结论已交付 → A5 知识管理` }] },
      ],
    }
    const a4MessageId = await replyBotMessage('a4_governor', mbConfig, a1MessageId, a4Card)
    log.info(`[AutoPilot] A4 全局治理 replied: ${a4MessageId}`)

    // ── A5 知识管理：跟帖回复（总结）──
    const skillHits = new Map<string, number>()
    for (const v of verdicts) {
      if (v.screenSkill && v.screenSkill !== '冷启动保护') {
        skillHits.set(v.screenSkill, (skillHits.get(v.screenSkill) || 0) + 1)
      }
    }
    const skillSummary = skillHits.size > 0
      ? [...skillHits.entries()].map(([k, v]) => `${k}: 命中 ${v} 次`).join('\n')
      : '无 Skill 命中'

    const a5Card = {
      config: { wide_screen_mode: true },
      header: { template: 'purple', title: { content: `[A5 知识管理] 本轮总结`, tag: 'plain_text' } },
      elements: [
        { tag: 'div', text: { content: `**Skill 命中统计**:\n${skillSummary}`, tag: 'lark_md' } },
        { tag: 'div', text: { content: `**经验沉淀**: ${executedCount > 0 ? `${executedCount} 条执行结果已记录，供下轮复用` : '本轮无新增经验'}`, tag: 'lark_md' } },
        { tag: 'div', text: { content: `**闭环状态**: A1数据→A2决策→A3执行→A4治理→A5沉淀 ✓\n本轮协作完成`, tag: 'lark_md' } },
        { tag: 'note', elements: [{ tag: 'plain_text', content: `TraceId: ${traceId} | 闭环完成` }] },
      ],
    }
    await replyBotMessage('a5_knowledge', mbConfig, a1MessageId, a5Card)
    log.info(`[AutoPilot] A5 知识管理 replied, multi-bot cycle complete`)
  } catch (e: any) {
    log.warn(`[AutoPilot] Multi-bot notification failed: ${e.message}`)
  }
}
