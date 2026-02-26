/**
 * Auto-Pilot — AI 接管优化师的独立快速循环
 *
 * 纯 Facebook API，不依赖 Metabase/TopTou，10 分钟一次。
 * 流程：拉数据 → Skill 决策 → 直接执行 → 飞书推送
 */
import axios from 'axios'
import dayjs from 'dayjs'
import { log } from '../platform/logger'
import { env } from '../config/env'
import { getAgentConfig } from './agent-config.model'
import { Skill, AgentSkillDoc, matchesCampaign, evaluateConditions, fillReasonTemplate } from './skill.model'
import { Action } from '../action/action.model'
import { createDecisionTrace, appendTraceStep } from './collab/types'
import { fuseRecords, buildUnifiedSnapshot, FBSourceRecord, MBSourceRecord } from './data-fusion'

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
export async function runAutoPilot(): Promise<{ actions: any[]; campaigns: number; snapshot?: any }> {
  const fbToken = process.env.FB_ACCESS_TOKEN
  if (!fbToken) return { actions: [], campaigns: 0 }

  // 从 A1 Skills 读取配置（可通过 @A1 在群里修改）
  const fusionSkills = await Skill.find({ agentId: 'a1_fusion', enabled: true }).lean() as any[]

  const optimizerSkill = fusionSkills.find(s => s.name === 'A1 优化师范围')
  const sourceSkill = fusionSkills.find(s => s.name === 'A1 数据源配置')
  const prioritySkill = fusionSkills.find(s => s.name === 'A1 字段优先级')
  const thresholdSkill = fusionSkills.find(s => s.name === 'A1 冲突与过滤阈值')

  const autoOptimizers: string[] = (optimizerSkill?.decision?.params?.optimizers || []).map((o: string) => o.toLowerCase())

  // 兜底：如果 A1 Skills 没配，读旧的 executor config
  if (autoOptimizers.length === 0) {
    const config = await getAgentConfig('executor')
    const fallback: string[] = (config?.executor?.scope?.optimizers || []).map((o: string) => o.toLowerCase())
    if (fallback.length > 0) {
      autoOptimizers.push(...fallback)
      log.info(`[AutoPilot] Using fallback optimizers from executor config: ${fallback.join(', ')}`)
    }
  }

  if (autoOptimizers.length === 0) return { actions: [], campaigns: 0 }

  const fbEnabled = sourceSkill?.decision?.params?.facebook_enabled !== false
  const mbEnabled = sourceSkill?.decision?.params?.metabase_enabled !== false
  const minSpend = thresholdSkill?.decision?.params?.min_spend_filter ?? 5

  log.info(`[AutoPilot] Starting cycle: optimizers=[${autoOptimizers.join(',')}] sources=[${fbEnabled ? 'FB' : ''}${mbEnabled ? '+MB' : ''}] minSpend=$${minSpend}`)

  // Step 1: 按 Skills 配置并行拉取数据源
  const [fbRaw, mbRawAll] = await Promise.all([
    fbEnabled ? fetchFBData(fbToken, autoOptimizers) : Promise.resolve([]),
    mbEnabled ? fetchMBData() : Promise.resolve([]),
  ])
  const mbRaw = mbRawAll.filter(m => {
    const opt = (m.optimizer || m.campaignName?.split('_')[0] || '').toLowerCase()
    return autoOptimizers.includes(opt)
  })

  if (fbRaw.length === 0 && mbRaw.length === 0) {
    log.info('[AutoPilot] No campaigns from any source')
    return { actions: [], campaigns: 0 }
  }

  // Step 2: 字段级融合
  const { fused, diagnostics } = fuseRecords(fbRaw, mbRaw)
  const snapshot = buildUnifiedSnapshot(fused, diagnostics, `ap-${dayjs().format('YYMMDDHHmm')}`)

  log.info(`[AutoPilot] Fused: ${fused.length} campaigns, ROAS覆盖 ${diagnostics.roasCoverage}%, 冲突 ${diagnostics.spendConflicts}花费/${diagnostics.roasConflicts}ROAS, 质量分 ${snapshot.qualityScore}`)

  // 转为旧格式供 skill 决策使用
  const campaigns: FBCampaignData[] = fused.map(f => ({
    campaignId: f.campaignId,
    campaignName: f.campaignName,
    accountId: f.accountId,
    accountName: '',
    status: f.status || 'ACTIVE',
    dailyBudget: f.dailyBudget || 0,
    spend: f.spend,
    impressions: f.impressions || 0,
    clicks: f.clicks || 0,
    conversions: f.installs,
    roas: f.roas,
    cpi: f.cpi,
    ctr: f.ctr || 0,
    optimizer: f.optimizer,
    pkgName: f.pkgName,
  }))

  // Step 2: Skill 决策
  const { verdicts, actions } = await makeSkillDecisions(campaigns)

  // Step 3: 直接执行 (Facebook API)
  for (const action of actions) {
    const v = verdicts.find(vv => vv.campaign.campaignId === action.campaignId)

    // 已暂停的 campaign 不重复执行暂停
    const campStatus = (v?.campaign as any)?.status || ''
    if (action.type === 'pause' && campStatus === 'PAUSED') {
      if (v) { v.execResult = 'skipped'; v.execError = '已是 PAUSED 状态，跳过' }
      log.info(`[AutoPilot] Skipped: ${action.campaignName} already PAUSED`)
      continue
    }

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
  await notifyAutoPilot(verdicts, campaigns.length, snapshot, {
    autoOptimizers,
    fbEnabled,
    mbEnabled,
    minSpend,
    spendPriority: prioritySkill?.decision?.params?.spend_priority || 'facebook',
    roasPriority: prioritySkill?.decision?.params?.roas_priority || 'metabase',
  }, fusionSkills)

  const executedCount = verdicts.filter(v => v.execResult === 'executed').length
  log.info(`[AutoPilot] Cycle complete: ${campaigns.length} campaigns, ${actions.length} actions, ${executedCount} executed`)
  return { actions: actions.filter((_, i) => verdicts.find(v => v.campaign.campaignId === actions[i]?.campaignId)?.execResult === 'executed'), campaigns: campaigns.length, snapshot }
}

// ==================== Metabase 数据拉取 ====================

async function fetchMBData(): Promise<MBSourceRecord[]> {
  try {
    const today = dayjs().format('YYYY-MM-DD')
    const { collectData } = await import('./monitor/data-collector')
    const raw = await collectData(today, today)
    return raw.map(r => ({
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      accountId: r.accountId,
      platform: r.platform,
      optimizer: r.optimizer,
      pkgName: r.pkgName,
      spend: r.spend,
      installs: r.installs,
      cpi: r.cpi,
      revenue: r.revenue,
      firstDayRoi: r.firstDayRoi,
      adjustedRoi: r.adjustedRoi,
      day3Roi: r.day3Roi,
      payRate: r.payRate,
      arpu: r.arpu,
      ctr: r.ctr,
    }))
  } catch (e: any) {
    log.warn(`[AutoPilot] Metabase fetch failed: ${e.message}`)
    return []
  }
}

// ==================== Facebook 数据拉取 ====================

async function fetchFBData(fbToken: string, optimizers: string[]): Promise<FBSourceRecord[]> {
  const accountsRes = await axios.get(`${FB_GRAPH}/me/adaccounts`, {
    params: { fields: 'id,account_id,name', limit: 200, access_token: fbToken },
    timeout: 15000,
  })

  const pendingCampaigns: Array<{ camp: any; acc: any; optimizer: string; pkgName: string }> = []

  for (const acc of accountsRes.data?.data || []) {
    try {
      const campRes = await axios.get(`${FB_GRAPH}/${acc.id}/campaigns`, {
        params: { fields: 'id,name,status,daily_budget,effective_status', filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED'] }]), limit: 500, access_token: fbToken },
        timeout: 15000,
      })
      for (const camp of campRes.data?.data || []) {
        const parts = camp.name.split('_')
        const optimizer = (parts[0] || '').toLowerCase()
        if (!optimizers.includes(optimizer)) continue
        pendingCampaigns.push({ camp, acc, optimizer, pkgName: parts.length >= 3 ? parts[2] : '' })
      }
    } catch { /* skip account */ }
  }

  // 并发拉 insights（5路并发，避免 FB rate limit）
  const CONCURRENCY = 5
  const result: FBSourceRecord[] = []

  for (let i = 0; i < pendingCampaigns.length; i += CONCURRENCY) {
    const batch = pendingCampaigns.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.allSettled(batch.map(async ({ camp, acc, optimizer, pkgName }) => {
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

            // 转化事件优先级：app_install > lead > omni_purchase
            const instAction = (ins.actions || []).find((a: any) =>
              a.action_type === 'app_install' || a.action_type === 'omni_app_install'
            )
            conversions = instAction ? Number(instAction.value || 0) : 0

            if (conversions === 0) {
              const leadAction = (ins.actions || []).find((a: any) => a.action_type === 'lead')
              if (leadAction) conversions = Number(leadAction.value || 0)
            }

            if (conversions === 0) {
              const purchaseAction = (ins.actions || []).find((a: any) => a.action_type === 'omni_purchase' || a.action_type === 'purchase')
              if (purchaseAction) conversions = Number(purchaseAction.value || 0)
            }

            const purchaseRoas = ins.purchase_roas?.find((a: any) => a.action_type === 'omni_purchase')
            if (purchaseRoas) roas = Number(purchaseRoas.value || 0)

            const purchaseValue = (ins.action_values || []).find((a: any) => a.action_type === 'omni_purchase')
            if (purchaseValue) {
              revenue = Number(purchaseValue.value || 0)
              if (roas === 0 && spend > 0) roas = revenue / spend
            }
        }
      } catch { /* new campaign, no insights yet */ }

      return {
        campaignId: camp.id,
        campaignName: camp.name,
        accountId: acc.account_id,
        status: camp.effective_status || camp.status,
        dailyBudget: Number(camp.daily_budget || 0) / 100,
        spend,
        impressions,
        clicks,
        conversions,
        roas,
        revenue,
        cpi: conversions > 0 ? spend / conversions : 0,
        ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
        optimizer,
        pkgName,
        platform: 'FB',
      } as FBSourceRecord
    }))

    for (const r of batchResults) {
      if (r.status === 'fulfilled') result.push(r.value)
    }
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

// ==================== A2 决策（硬护栏 + LLM 推理 + 护栏兜底）====================

async function makeSkillDecisions(campaigns: FBCampaignData[]): Promise<{ verdicts: CampaignVerdict[]; actions: any[] }> {
  // 加载硬护栏（rule 类型）和经验（experience 类型）
  const hardRules = await Skill.find({ agentId: 'a2_decision', skillType: 'rule', enabled: true }).sort({ order: 1 }).lean() as any[]
  const experiences = await Skill.find({ agentId: 'a2_decision', skillType: 'experience', enabled: true }).sort({ 'experience.confidence': -1 }).lean() as any[]

  // 兼容旧 skills
  const legacyScreener = await Skill.find({ agentId: 'screener', enabled: true }).sort({ order: 1 }).lean() as AgentSkillDoc[]
  const legacyDecision = await Skill.find({ agentId: 'decision', enabled: true }).sort({ order: 1 }).lean() as AgentSkillDoc[]

  const verdicts: CampaignVerdict[] = []
  const actions: any[] = []

  // Step 1: 硬护栏过滤（不经过 LLM，直接执行）
  const needsLLM: FBCampaignData[] = []

  for (const c of campaigns) {
    const verdict: CampaignVerdict = { campaign: c, screenVerdict: 'watch', screenSkill: '', screenReason: '' }

    // 冷启动保护（硬护栏）
    if (c.spend < 5) {
      verdict.screenVerdict = 'skip'
      verdict.screenSkill = '硬护栏-冷启动'
      verdict.screenReason = `花费 $${c.spend.toFixed(2)} < $5，数据不足`
      verdicts.push(verdict)
      continue
    }

    // 检查硬护栏规则
    let guardrailHit = false
    const data = { ...c, todaySpend: c.spend, adjustedRoi: c.roas, todayRoas: c.roas, installs: c.conversions }
    for (const rule of hardRules) {
      if (rule.screening?.conditions?.length && evaluateConditions(rule.screening.conditions, rule.screening.conditionLogic, data)) {
        verdict.screenVerdict = rule.screening.verdict || 'needs_decision'
        verdict.screenSkill = `硬护栏-${rule.name}`
        verdict.screenReason = fillReasonTemplate(rule.screening.reasonTemplate || rule.name, data)
        guardrailHit = true
        break
      }
    }

    // 兼容旧 screener 规则
    if (!guardrailHit) {
      for (const skill of legacyScreener) {
        if (!matchesCampaign(skill, c as any)) continue
        const sc = skill.screening
        if (!sc?.conditions?.length) continue
        if (evaluateConditions(sc.conditions, sc.conditionLogic, data)) {
          verdict.screenVerdict = sc.verdict
          verdict.screenSkill = skill.name
          verdict.screenReason = fillReasonTemplate(sc.reasonTemplate || skill.name, data)
          guardrailHit = true
          break
        }
      }
    }

    if (guardrailHit && verdict.screenVerdict === 'skip') {
      verdicts.push(verdict)
      continue
    }

    needsLLM.push(c)
    verdicts.push(verdict)
  }

  // Step 2: LLM 推理（用经验做 context，让 LLM 自己决策）
  if (needsLLM.length > 0 && env.LLM_API_KEY) {
    const experienceContext = experiences.map((e: any, i: number) => {
      const exp = e.experience || {}
      return `经验${i + 1} [置信${exp.confidence || 0.5}]: 场景: ${exp.scenario || ''} → 教训: ${exp.lesson || ''}`
    }).join('\n')

    // 只给 LLM 看 ACTIVE 且有花费的 campaign（已暂停的不需要决策）
    const activeCandidates = needsLLM.filter(c => {
      const status = (c as any).status || 'ACTIVE'
      return status === 'ACTIVE' && c.spend > 0
    })

    const campaignData = activeCandidates.map(c => ({
      id: c.campaignId,
      name: c.campaignName,
      status: (c as any).status || 'ACTIVE',
      spend: Number(c.spend.toFixed(2)),
      roas: Number(c.roas.toFixed(2)),
      installs: c.conversions,
      cpi: Number(c.cpi.toFixed(2)),
    }))

    const systemPrompt = `你是一个广告投放决策专家。分析 campaign 数据，只对需要操作的广告给出建议，其余默认观察。

## 历史经验
${experienceContext || '暂无历史经验，请根据数据独立判断。'}

## 硬约束
- 花费 > $50 且 ROAS < 0.2 → 必须暂停
- ROAS > 1.0 → 不允许暂停
- 花费 < $5 → 跳过不判断

## 操作类型
pause / increase_budget / decrease_budget

## 思考要求
1. 综合花费、ROAS、安装量、CPI 多维度判断
2. 不确定时不操作（默认观察）
3. 已暂停的广告不需要重复暂停

重要：只输出需要操作的 campaign，不需要操作的不要包含在 JSON 里。
输出严格 JSON（不要多余文字）:
{"decisions":[{"campaignId":"...","action":"pause","reason":"...","confidence":0.8}],"summary":"..."}`

    const userMessage = `当前时间: ${dayjs().format('YYYY-MM-DD HH:mm')}\n\n## 待分析 Campaign (${campaignData.length} 个)\n${JSON.stringify(campaignData, null, 2)}`

    try {
      const res = await axios.post(
        `${env.LLM_BASE_URL}/chat/completions`,
        {
          model: env.LLM_MODEL,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
          temperature: 0.2,
          max_tokens: 8192,
        },
        { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LLM_API_KEY}` }, timeout: 120000 },
      )

      const content = res.data.choices?.[0]?.message?.content || ''
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const llmResult = JSON.parse(jsonMatch[0])
        for (const d of llmResult.decisions || []) {
          if (!d.campaignId || d.action === 'watch') continue

          const c = activeCandidates.find(x => x.campaignId === d.campaignId)
          if (!c) continue

          // 护栏兜底：ROAS > 1 不允许暂停
          if (d.action === 'pause' && c.roas > 1.0) {
            log.info(`[A2] Guardrail blocked pause for ${c.campaignName}: ROAS ${c.roas} > 1.0`)
            continue
          }

          const verdict = verdicts.find(v => v.campaign.campaignId === d.campaignId)
          if (verdict) {
            verdict.screenVerdict = 'needs_decision'
            verdict.screenSkill = 'LLM推理'
            verdict.screenReason = d.reason
            verdict.action = { type: d.action, reason: d.reason, skillName: 'LLM推理' }
          }

          actions.push({
            type: d.action === 'increase_budget' ? 'adjust_budget' : d.action,
            campaignId: d.campaignId,
            campaignName: c.campaignName,
            accountId: c.accountId,
            reason: d.reason,
            skillName: 'LLM推理',
            spend: c.spend,
            roas: c.roas,
          })
        }
        log.info(`[A2] LLM decided: ${actions.length} actions from ${needsLLM.length} candidates`)
      }
    } catch (e: any) {
      log.warn(`[A2] LLM decision failed, falling back to legacy rules: ${e.message}`)

      // LLM 失败降级：用旧规则引擎
      for (const c of needsLLM) {
        const data = { ...c, todaySpend: c.spend, adjustedRoi: c.roas, todayRoas: c.roas, installs: c.conversions }
        for (const skill of legacyDecision) {
          if (!matchesCampaign(skill, c as any)) continue
          const d = skill.decision
          if (!d?.action) continue
          const condMatch = d.conditions?.length > 0 ? evaluateConditions(d.conditions, d.conditionLogic, data) : true
          if (!condMatch) continue

          const reason = fillReasonTemplate(d.reasonTemplate || skill.name, data)
          const verdict = verdicts.find(v => v.campaign.campaignId === c.campaignId)
          if (verdict) {
            verdict.screenVerdict = 'needs_decision'
            verdict.screenSkill = `降级-${skill.name}`
            verdict.screenReason = reason
            verdict.action = { type: d.action, reason, skillName: skill.name }
          }
          actions.push({
            type: d.action === 'increase_budget' ? 'adjust_budget' : d.action,
            campaignId: c.campaignId, campaignName: c.campaignName, accountId: c.accountId,
            reason, skillName: skill.name, spend: c.spend, roas: c.roas,
          })
          break
        }
      }
    }
  } else if (needsLLM.length > 0) {
    log.warn('[A2] No LLM_API_KEY, using legacy rules only')
    for (const c of needsLLM) {
      const data = { ...c, todaySpend: c.spend, adjustedRoi: c.roas, todayRoas: c.roas, installs: c.conversions }
      for (const skill of legacyDecision) {
        if (!matchesCampaign(skill, c as any)) continue
        const d = skill.decision
        if (!d?.action) continue
        const condMatch = d.conditions?.length > 0 ? evaluateConditions(d.conditions, d.conditionLogic, data) : true
        if (!condMatch) continue

        const reason = fillReasonTemplate(d.reasonTemplate || skill.name, data)
        const verdict = verdicts.find(v => v.campaign.campaignId === c.campaignId)
        if (verdict) {
          verdict.screenVerdict = 'needs_decision'
          verdict.screenSkill = skill.name
          verdict.screenReason = reason
          verdict.action = { type: d.action, reason, skillName: skill.name }
        }
        actions.push({
          type: d.action === 'increase_budget' ? 'adjust_budget' : d.action,
          campaignId: c.campaignId, campaignName: c.campaignName, accountId: c.accountId,
          reason, skillName: skill.name, spend: c.spend, roas: c.roas,
        })
        break
      }
    }
  }

  return { verdicts, actions }
}

// ==================== 飞书推送（5 Bot 独立发言 + 跟帖）====================

interface FusionConfig {
  autoOptimizers: string[]
  fbEnabled: boolean
  mbEnabled: boolean
  minSpend: number
  spendPriority: string
  roasPriority: string
}

async function notifyAutoPilot(verdicts: CampaignVerdict[], totalCampaigns: number, snapshot?: any, fusionCfg?: FusionConfig, fusionSkillsList?: any[]): Promise<void> {
  try {
    const { loadMultiBotConfig, sendBotMessage, replyBotMessage } = await import('../platform/feishu/multi-bot')
    const mbConfig = await loadMultiBotConfig()
    if (!mbConfig) return

    // 加载 skills 用于卡片展示
    const [screenerSkills, decisionSkills] = await Promise.all([
      Skill.find({ agentId: 'screener', enabled: true }).sort({ order: 1 }).lean() as Promise<AgentSkillDoc[]>,
      Skill.find({ agentId: 'decision', enabled: true }).sort({ order: 1 }).lean() as Promise<AgentSkillDoc[]>,
    ])

    const formatSkillsSummary = (skills: AgentSkillDoc[], type: 'screener' | 'decision') => {
      if (skills.length === 0) return '暂无启用的 Skills'
      return skills.map(s => {
        const stats = `命中${s.stats?.triggered || 0} 准确${s.stats?.accuracy || 0}%`
        if (type === 'screener' && s.screening?.conditions?.length) {
          const conds = s.screening.conditions.map(c => `${c.field}${c.operator}${c.value}`).join(' & ')
          return `• **${s.name}** [${stats}]\n  ${conds} → ${s.screening.verdict}`
        }
        if (type === 'decision' && s.decision?.action) {
          const conds = s.decision.conditions?.length
            ? s.decision.conditions.map(c => `${c.field}${c.operator}${c.value}`).join(' & ')
            : '标签触发'
          return `• **${s.name}** [${stats}]\n  ${conds} → ${s.decision.action}(${s.decision.auto ? '自动' : '审批'})`
        }
        return `• **${s.name}** [${stats}]`
      }).join('\n')
    }

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
    const diag = snapshot?.diagnostics
    const roasCov = diag?.roasCoverage ?? Math.round((roasArr.length / Math.max(totalCampaigns, 1)) * 100)
    const installCov = diag?.installCoverage ?? 0
    const spendConf = diag?.spendConflicts ?? 0
    const roasConf = diag?.roasConflicts ?? 0
    const qualityScore = snapshot?.qualityScore ?? 'N/A'
    const dataRiskLabel = snapshot?.dataRisk ? '⚠️ 高' : '✅ 低'
    const mergedCount = diag?.mergedCount ?? 0
    const fbOnly = diag?.fbOnlyCount ?? 0
    const mbOnly = diag?.mbOnlyCount ?? 0

    const topCampaigns = verdicts.slice(0, 8).map(v => {
      const c = v.campaign
      const fused = snapshot?.fusedCampaigns?.find((f: any) => f.campaignId === c.campaignId)
      const src = fused?.fusionSource === 'facebook_only' ? '[FB]' : fused?.fusionSource === 'metabase_only' ? '[MB]' : '[合并]'
      const conflictTag = fused?.conflicts?.length > 0 ? ` ⚠️${fused.conflicts.length}冲突` : ''
      return `${src} **${c.campaignName}**\n花费 $${c.spend.toFixed(2)} | ROAS ${c.roas.toFixed(2)} | 安装 ${c.conversions}${conflictTag}`
    }).join('\n---\n')

    const conflictDetails = snapshot?.conflictFlags?.length > 0
      ? snapshot.conflictFlags.join('\n')
      : '无显著跨源冲突'

    const a1Card = {
      config: { wide_screen_mode: true },
      header: { template: snapshot?.dataRisk ? 'red' : 'blue', title: { content: `[A1 数据融合] ${now} | ${totalCampaigns} campaign | 质量 ${qualityScore}`, tag: 'plain_text' } },
      elements: [
        { tag: 'div', fields: [
          { is_short: true, text: { content: `**Campaign**\n${totalCampaigns}`, tag: 'lark_md' } },
          { is_short: true, text: { content: `**总花费**\n$${totalSpend.toFixed(2)}`, tag: 'lark_md' } },
          { is_short: true, text: { content: `**ROAS覆盖**\n${roasCov}%`, tag: 'lark_md' } },
          { is_short: true, text: { content: `**数据风险**\n${dataRiskLabel}`, tag: 'lark_md' } },
        ]},
        { tag: 'hr' },
        { tag: 'div', text: { content: `**融合策略** (来自 A1 Skills，可 @A1 修改)\n• 优化师: ${fusionCfg?.autoOptimizers?.join(', ') || 'N/A'}\n• 数据源: ${fusionCfg?.fbEnabled ? 'FB(启用)' : 'FB(关闭)'} ${fusionCfg?.mbEnabled ? 'MB(启用)' : 'MB(关闭)'}\n• 花费优先: ${fusionCfg?.spendPriority || 'facebook'}\n• ROAS优先: ${fusionCfg?.roasPriority || 'metabase'}\n• 最低花费: $${fusionCfg?.minSpend ?? 5}`, tag: 'lark_md' } },
        { tag: 'div', text: { content: `**融合诊断**\n• 质量分: **${qualityScore}** | ROAS覆盖: ${roasCov}% | 安装覆盖: ${installCov}%\n• 来源: 双源合并 ${mergedCount} | 仅FB ${fbOnly} | 仅MB ${mbOnly}\n• 冲突: 花费偏差 ${spendConf} 条 | ROAS偏差 ${roasConf} 条\n• ${conflictDetails}`, tag: 'lark_md' } },
        { tag: 'hr' },
        { tag: 'collapsible_panel', expanded: false, header: { title: { tag: 'plain_text', content: `Campaign 融合快照 (Top ${Math.min(8, verdicts.length)})` } }, border: { color: 'blue' }, vertical_spacing: '8px',
          elements: [{ tag: 'div', text: { content: topCampaigns || '暂无数据', tag: 'lark_md' } }],
        },
        { tag: 'collapsible_panel', expanded: false,
          header: { title: { tag: 'plain_text', content: `A1 Skills 配置 (${fusionSkillsList.length} 条)` } },
          border: { color: 'blue' }, vertical_spacing: '4px',
          elements: fusionSkillsList.length > 0 ? fusionSkillsList.map((s: any) => ({
            tag: 'div' as const,
            text: {
              content: `• **${s.name}** [${s.enabled ? '启用' : '禁用'}]\n  ${s.description || ''}\n  参数: ${JSON.stringify(s.decision?.params || {}).substring(0, 120)}`,
              tag: 'lark_md' as const,
            },
          })) : [{ tag: 'div' as const, text: { content: '暂无 A1 Skills 配置', tag: 'lark_md' as const } }],
        },
        { tag: 'note', elements: [{ tag: 'plain_text', content: `TraceId: ${traceId} | SnapshotId: ${snapshot?.snapshotId || traceId} | @A1数据融合 可修改配置 | 数据已交付 → A2 决策分析` }] },
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
        { tag: 'collapsible_panel', expanded: false,
          header: { title: { tag: 'plain_text', content: `当前 Skills: 筛选 ${screenerSkills.length} + 决策 ${decisionSkills.length}` } },
          border: { color: 'orange' }, vertical_spacing: '4px',
          elements: [
            { tag: 'div', text: { content: `**筛选 Skills**:\n${formatSkillsSummary(screenerSkills, 'screener')}`, tag: 'lark_md' } },
            { tag: 'hr' },
            { tag: 'div', text: { content: `**决策 Skills**:\n${formatSkillsSummary(decisionSkills, 'decision')}`, tag: 'lark_md' } },
            { tag: 'note', elements: [{ tag: 'plain_text', content: `@A2决策分析 + 指令可修改 Skills` }] },
          ],
        },
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
        { tag: 'collapsible_panel', expanded: false,
          header: { title: { tag: 'plain_text', content: `Skills 总览 (${screenerSkills.length + decisionSkills.length} 条启用)` } },
          border: { color: 'purple' }, vertical_spacing: '4px',
          elements: [
            { tag: 'div', text: { content: `**筛选 Skills** (${screenerSkills.length}):\n${formatSkillsSummary(screenerSkills, 'screener')}`, tag: 'lark_md' } },
            { tag: 'hr' },
            { tag: 'div', text: { content: `**决策 Skills** (${decisionSkills.length}):\n${formatSkillsSummary(decisionSkills, 'decision')}`, tag: 'lark_md' } },
            { tag: 'note', elements: [{ tag: 'plain_text', content: `@任意Agent + 指令即可修改 Skills | 支持: 修改/启用/禁用/列出` }] },
          ],
        },
        { tag: 'note', elements: [{ tag: 'plain_text', content: `TraceId: ${traceId} | 闭环完成` }] },
      ],
    }
    await replyBotMessage('a5_knowledge', mbConfig, a1MessageId, a5Card)
    log.info(`[AutoPilot] A5 知识管理 replied, multi-bot cycle complete`)
  } catch (e: any) {
    log.warn(`[AutoPilot] Multi-bot notification failed: ${e.message}`)
  }
}
