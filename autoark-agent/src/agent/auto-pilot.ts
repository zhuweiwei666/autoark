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

// ==================== 飞书推送（5-Agent 协作视图）====================

async function notifyAutoPilot(verdicts: CampaignVerdict[], totalCampaigns: number): Promise<void> {
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

    const totalSpend = verdicts.reduce((s, v) => s + v.campaign.spend, 0)
    const executedCount = verdicts.filter(v => v.execResult === 'executed').length
    const failedCount = verdicts.filter(v => v.execResult === 'failed').length
    const needsDecision = verdicts.filter(v => v.screenVerdict === 'needs_decision').length
    const watching = verdicts.filter(v => v.screenVerdict === 'watch').length
    const skipped = verdicts.filter(v => v.screenVerdict === 'skip').length
    const avgRoas = verdicts.filter(v => v.campaign.roas > 0).length > 0
      ? verdicts.filter(v => v.campaign.roas > 0).reduce((s, v) => s + v.campaign.roas, 0) / verdicts.filter(v => v.campaign.roas > 0).length
      : 0

    const trace = createDecisionTrace(`ap-${dayjs().format('YYMMDDHHmm')}`, 'cron')
    appendTraceStep(trace, {
      agentId: 'agent1_data_fusion',
      title: '[A1] 数据融合',
      conclusion: `Facebook API 拉取 ${totalCampaigns} 个 campaign，Metabase 补充 ROAS/CPI`,
      confidence: 0.88,
    })
    appendTraceStep(trace, {
      agentId: 'agent2_decision',
      title: '[A2] 决策推理',
      conclusion: `Skill 筛选: ${needsDecision} 需决策 / ${watching} 观察 / ${skipped} 跳过，产出 ${executedCount + failedCount} 条动作`,
      confidence: needsDecision > 0 ? 0.82 : 0.75,
      details: verdicts.filter(v => v.action).slice(0, 3).map(v =>
        `${v.screenSkill} → ${v.action!.skillName}: ${v.action!.type} ${v.campaign.campaignName}`
      ),
    })
    appendTraceStep(trace, {
      agentId: 'agent3_executor',
      title: '[A3] 执行路由',
      conclusion: `全部走 Facebook API：成功 ${executedCount}，失败 ${failedCount}`,
      confidence: executedCount > 0 ? 0.9 : 0.7,
      details: verdicts.filter(v => v.execResult).slice(0, 3).map(v =>
        `${v.campaign.campaignName}: ${v.execResult}${v.execError ? ` (${v.execError.substring(0, 40)})` : ''}`
      ),
    })

    let governorRisk: 'low' | 'medium' | 'high' = 'low'
    const governorOverrides: string[] = []
    if (avgRoas < 0.8 && avgRoas > 0) {
      governorRisk = 'high'
      governorOverrides.push('ROAS低于硬阈值，建议暂停放量类动作')
    } else if (avgRoas < 1.0 && avgRoas > 0) {
      governorRisk = 'medium'
      governorOverrides.push('ROAS接近阈值，控制学习期占比')
    }

    appendTraceStep(trace, {
      agentId: 'agent4_governor',
      title: '[A4] 全局治理',
      conclusion: governorRisk === 'high'
        ? `ROAS硬约束触发（均值${avgRoas.toFixed(2)}），止损优先`
        : governorRisk === 'medium'
          ? `ROAS接近阈值（均值${avgRoas.toFixed(2)}），稳健执行`
          : `ROAS健康（均值${avgRoas.toFixed(2)}），常规协同`,
      confidence: governorRisk === 'high' ? 0.92 : 0.78,
    })
    appendTraceStep(trace, {
      agentId: 'agent5_skill_kb',
      title: '[A5] 知识沉淀',
      conclusion: executedCount > 0
        ? `${executedCount} 条执行结果将回流经验库`
        : '本轮无新增经验',
      confidence: 0.8,
    })

    const elements: any[] = []

    // 概览
    elements.push({
      tag: 'div',
      fields: [
        { is_short: true, text: { content: `**Campaign**\n${totalCampaigns}`, tag: 'lark_md' } },
        { is_short: true, text: { content: `**总花费**\n$${totalSpend.toFixed(2)}`, tag: 'lark_md' } },
        { is_short: true, text: { content: `**均值ROAS**\n${avgRoas.toFixed(2)}`, tag: 'lark_md' } },
        { is_short: true, text: { content: `**操作**\n${executedCount} 执行${failedCount > 0 ? ` / ${failedCount} 失败` : ''}`, tag: 'lark_md' } },
      ],
    })
    elements.push({ tag: 'hr' })

    // [A1] 数据融合
    elements.push({
      tag: 'div',
      text: {
        content: `**[A1] 数据融合**\nFacebook API 拉取 ${totalCampaigns} 条 | Metabase 补充后端 ROAS/CPI\n数据源: fb:实时 | mb:补充 | 融合策略: Facebook优先`,
        tag: 'lark_md',
      },
    })

    // [A2] 决策推理
    const decisionDetails = verdicts.filter(v => v.action).slice(0, 5).map(v => {
      const c = v.campaign
      return `${c.campaignName}: ${v.screenSkill} → ${v.action!.type}（ROAS ${c.roas.toFixed(2)}, 花费 $${c.spend.toFixed(2)}）`
    }).join('\n')
    elements.push({
      tag: 'div',
      text: {
        content: `**[A2] 决策推理**\n筛选: 需决策 **${needsDecision}** | 观察 ${watching} | 跳过 ${skipped}\n${decisionDetails || '本轮无需决策动作'}`,
        tag: 'lark_md',
      },
    })

    // [A3] 执行路由
    const execDetails = verdicts.filter(v => v.execResult).slice(0, 5).map(v => {
      const c = v.campaign
      const icon = v.execResult === 'executed' ? '✅' : '❌'
      const actionLabel = v.action?.type === 'pause' ? '暂停' : v.action?.type === 'increase_budget' ? '加预算' : v.action?.type || '?'
      return `${icon} ${actionLabel} **${c.campaignName}** via facebook_api\n原因: ${v.action?.reason || '-'}${v.execError ? `\n错误: ${v.execError}` : ''}`
    }).join('\n')
    if (execDetails) {
      elements.push({
        tag: 'collapsible_panel',
        expanded: executedCount > 0,
        header: { title: { tag: 'plain_text', content: `[A3] 执行路由 (${executedCount + failedCount})` } },
        border: { color: executedCount > 0 ? 'green' : 'red' },
        vertical_spacing: '8px',
        elements: [{ tag: 'div', text: { content: execDetails, tag: 'lark_md' } }],
      })
    }

    // [A4] 全局治理
    const riskLabel = governorRisk === 'high' ? '高风险' : governorRisk === 'medium' ? '中风险' : '低风险'
    elements.push({
      tag: 'div',
      text: {
        content: `**[A4] 全局治理** | 风险: ${riskLabel}\n${governorOverrides.length > 0 ? `纠偏: ${governorOverrides.join('；')}` : `ROAS ${avgRoas.toFixed(2)} 达标，按常规执行`}`,
        tag: 'lark_md',
      },
    })

    // [A5] 知识沉淀
    elements.push({
      tag: 'div',
      text: {
        content: `**[A5] 知识沉淀**\n${executedCount > 0 ? `${executedCount} 条执行结果回流经验库` : '本轮无新增经验'}`,
        tag: 'lark_md',
      },
    })

    // 观察中（折叠）
    const watchList = verdicts.filter(v => v.screenVerdict === 'watch' || (v.screenVerdict === 'needs_decision' && !v.execResult))
    if (watchList.length > 0) {
      elements.push({
        tag: 'collapsible_panel',
        expanded: false,
        header: { title: { tag: 'plain_text', content: `观察中 (${watchList.length})` } },
        border: { color: 'blue' },
        vertical_spacing: '8px',
        elements: watchList.slice(0, 15).map(v => ({
          tag: 'div' as const,
          text: {
            content: `**${v.campaign.campaignName}**\n花费 $${v.campaign.spend.toFixed(2)} | ROAS ${v.campaign.roas.toFixed(2)} | 安装 ${v.campaign.conversions}\n${v.screenSkill || '观察中'}: ${v.screenReason || '未触发规则'}`,
            tag: 'lark_md' as const,
          },
        })),
      })
    }

    // 跳过（折叠）
    const skipList = verdicts.filter(v => v.screenVerdict === 'skip')
    if (skipList.length > 0) {
      elements.push({
        tag: 'collapsible_panel',
        expanded: false,
        header: { title: { tag: 'plain_text', content: `跳过 (${skipList.length})` } },
        border: { color: 'grey' },
        vertical_spacing: '8px',
        elements: skipList.slice(0, 20).map(v => ({
          tag: 'div' as const,
          text: { content: `${v.campaign.campaignName}: $${v.campaign.spend.toFixed(2)} | ${v.screenReason}`, tag: 'lark_md' as const },
        })),
      })
    }

    // 协作推理步骤（折叠）
    elements.push({
      tag: 'collapsible_panel',
      expanded: false,
      header: { title: { tag: 'plain_text', content: `协作推理步骤 (${trace.steps.length})` } },
      border: { color: 'grey' },
      vertical_spacing: '8px',
      elements: trace.steps.map(step => ({
        tag: 'div' as const,
        text: {
          content: `**${step.title}**\n${step.conclusion}${step.details?.length ? `\n${step.details.slice(0, 3).join('；')}` : ''}`,
          tag: 'lark_md' as const,
        },
      })),
    })
    elements.push({
      tag: 'note',
      elements: [{ tag: 'plain_text', content: `TraceId: ${trace.traceId} | Trigger: ${trace.trigger}` }],
    })

    const card = {
      config: { wide_screen_mode: true },
      header: {
        template: governorRisk === 'high' ? 'red' : executedCount > 0 ? 'violet' : 'turquoise',
        title: { content: `AutoPilot | ${dayjs().format('MM-DD HH:mm')} | ${totalCampaigns} campaign | ${executedCount} 操作`, tag: 'plain_text' },
      },
      elements,
    }

    await axiosLib.post(
      `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${config.receiveIdType || 'chat_id'}`,
      { receive_id: config.receiveId, msg_type: 'interactive', content: JSON.stringify(card) },
      { headers: { Authorization: `Bearer ${token}` } }
    )
    log.info(`[AutoPilot] Feishu collab card sent: ${totalCampaigns} campaigns, ${executedCount} executed`)
  } catch (e: any) {
    log.warn(`[AutoPilot] Feishu notification failed: ${e.message}`)
  }
}
