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

  // Step 2: 加载最近操作历史（冷却期 + LLM 上下文）
  const recentActions = await Action.find({
    status: { $in: ['executed', 'approved'] },
    executedAt: { $gte: dayjs().subtract(2, 'hour').toDate() },
    'params.source': 'auto_pilot',
  }).lean() as any[]

  const recentBycamp = new Map<string, { type: string; at: Date; count: number }>()
  for (const a of recentActions) {
    const key = a.entityId
    const existing = recentBycamp.get(key)
    if (!existing) {
      recentBycamp.set(key, { type: a.type, at: a.executedAt, count: 1 })
    } else {
      existing.count++
    }
  }

  const COOLDOWN_MINUTES = 30

  // Step 3: A2 决策推理
  const decisionResult = await makeSkillDecisions(campaigns, recentActions)
  const { verdicts, actions } = decisionResult

  // Step 4: A4 全局 ROAS 前置检查（在执行前拦截放量动作）
  let a4BlockScaling = false
  let a4BlockReason = ''
  try {
    const a4Goals = await Skill.find({ agentId: 'a4_governor', skillType: 'goal', enabled: true }).lean() as any[]
    if (a4Goals.length > 0) {
      const mbSess = await axios.post('https://meta.iohubonline.club/api/session', {
        username: process.env.METABASE_EMAIL, password: process.env.METABASE_PASSWORD,
      })
      const mbTok = mbSess.data.id
      const mbRes = await axios.post('https://meta.iohubonline.club/api/card/3822/query', {
        parameters: [
          { type: 'text', value: 'VfuSBdaO33sklvtr', target: ['variable', ['template-tag', 'access_code']] },
          { type: 'date/single', value: dayjs().format('YYYY-MM-DD'), target: ['variable', ['template-tag', 'start_day']] },
          { type: 'date/single', value: dayjs().format('YYYY-MM-DD'), target: ['variable', ['template-tag', 'end_day']] },
          { type: 'text', value: autoOptimizers.join(',') || 'wwz', target: ['variable', ['template-tag', 'user_name']] },
        ],
      }, { headers: { 'X-Metabase-Session': mbTok }, timeout: 30000 })

      const mbCols = (mbRes.data?.data?.cols || []).map((c: any) => c.name)
      const ci = (name: string) => mbCols.indexOf(name)
      let totalRevenue = 0
      for (const r of mbRes.data?.data?.rows || []) {
        if (r[ci('日期')] === '汇总' || r[ci('包名')] === 'ALL') continue
        totalRevenue += Number(r[ci('调整的首日收入')] || 0)
      }

      const totalSpendNow = fused.reduce((s, c) => s + c.spend, 0)
      const globalRoas = totalSpendNow > 0 ? totalRevenue / totalSpendNow : 0

      for (const g of a4Goals) {
        const roasFloor = g.goal?.roasFloor || 0
        const priority = g.goal?.priority || 'roas_first'
        if (roasFloor > 0 && globalRoas < roasFloor && globalRoas > 0 && priority === 'roas_first') {
          a4BlockScaling = true
          a4BlockReason = `全局ROAS ${globalRoas.toFixed(2)} < 底线${roasFloor}，${g.goal?.product || ''} 止损优先，阻断放量`
          log.info(`[A4 Pre-check] ${a4BlockReason}`)
          break
        }
      }
    }
  } catch (e: any) {
    log.warn(`[A4 Pre-check] Failed: ${e.message}, not blocking`)
  }

  // Step 5: 执行前过滤（A4阻断 + 冷却期 + 重复保护）
  const filteredActions: typeof actions = []
  for (const action of actions) {
    const v = verdicts.find(vv => vv.campaign.campaignId === action.campaignId)

    // A4 全局 ROAS 阻断：止损优先模式下禁止所有放量动作
    if (a4BlockScaling && (action.type === 'adjust_budget' || action.type === 'increase_budget' || action.type === 'resume')) {
      if (v) { v.execResult = 'skipped'; v.execError = `A4阻断: ${a4BlockReason}` }
      log.info(`[A4 Block] ${action.type} ${action.campaignName} blocked: ${a4BlockReason}`)
      continue
    }

    // 冷却期：最近 N 分钟内操作过的 campaign 跳过
    const recent = recentBycamp.get(action.campaignId)
    if (recent) {
      const minsSince = dayjs().diff(dayjs(recent.at), 'minute')
      if (minsSince < COOLDOWN_MINUTES) {
        if (v) { v.execResult = 'skipped'; v.execError = `冷却期: ${minsSince}分钟前已执行${recent.type}，需等${COOLDOWN_MINUTES}分钟` }
        log.info(`[AutoPilot] Cooldown: ${action.campaignName} was ${recent.type} ${minsSince}m ago, skip`)
        continue
      }
    }

    // 已暂停的 campaign 不重复执行暂停
    const campStatus = (v?.campaign as any)?.status || ''
    if (action.type === 'pause' && campStatus === 'PAUSED') {
      if (v) { v.execResult = 'skipped'; v.execError = '已是 PAUSED 状态，跳过' }
      log.info(`[AutoPilot] Skipped: ${action.campaignName} already PAUSED`)
      continue
    }

    filteredActions.push(action)
  }

  // Step 5: 执行
  for (const action of filteredActions) {
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

  // Step 6: A4 纠偏执行（补量 + 止损学习期）
  const a4Actions: string[] = []
  if (a4BlockScaling && a4BlockReason) {
    const spendTarget = (await Skill.findOne({ agentId: 'a4_governor', skillType: 'goal', enabled: true }).lean() as any)?.goal?.dailySpendTarget || 0
    const totalSpendNow2 = fused.reduce((s, c) => s + c.spend, 0)
    const spendPct = spendTarget > 0 ? totalSpendNow2 / spendTarget : 0

    // 补量：如果消耗进度 < 50% 且当前时间过了一半（UTC 6h = 北京 14h）
    if (spendPct < 0.5 && dayjs().hour() >= 6) {
      // 找表现最好的 campaign 复制
      const bestCampaign = fused
        .filter(f => f.roas > 1.0 && f.spend > 5 && f.installs > 2)
        .sort((a, b) => b.roas - a.roas)[0]

      if (bestCampaign) {
        try {
          const copyRes = await axios.post(`${FB_GRAPH}/${bestCampaign.campaignId}/copies`, null, {
            params: { access_token: fbToken, status_option: 'PAUSED' },
            timeout: 15000,
          })
          const newCampId = copyRes.data?.copied_campaign_id
          if (newCampId) {
            // 激活新复制的 campaign
            await axios.post(`${FB_GRAPH}/${newCampId}`, null, {
              params: { access_token: fbToken, status: 'ACTIVE' },
              timeout: 15000,
            })
            const msg = `补量: 复制 ${bestCampaign.campaignName}(ROAS ${bestCampaign.roas.toFixed(2)}) → 新campaign ${newCampId} 已激活`
            a4Actions.push(msg)
            log.info(`[A4 Execute] ${msg}`)

            await Action.create({
              type: 'copy_campaign',
              platform: 'facebook',
              accountId: bestCampaign.accountId,
              entityId: newCampId,
              entityName: `copy_of_${bestCampaign.campaignName}`,
              params: { source: 'a4_governor', sourceCampaignId: bestCampaign.campaignId, roas: bestCampaign.roas },
              reason: `[A4 补量] 消耗进度${(spendPct * 100).toFixed(0)}%偏低，复制最优campaign`,
              status: 'executed',
              executedAt: new Date(),
            })
          }
        } catch (e: any) {
          log.warn(`[A4 Execute] Campaign copy failed: ${e.response?.data?.error?.message || e.message}`)
          a4Actions.push(`补量失败: ${e.response?.data?.error?.message || e.message}`)
        }
      }
    }

    // 止损学习期：关停花费高但 ROAS=0 且 ACTIVE 的广告
    const learningRisk = fused
      .filter(f => f.status === 'ACTIVE' && f.spend > 10 && f.roas === 0 && f.installs <= 1)
      .sort((a, b) => b.spend - a.spend)

    const activeCount = fused.filter(f => f.status === 'ACTIVE').length
    const learningPct = activeCount > 0 ? learningRisk.length / activeCount : 0

    if (learningPct > 0.3 && learningRisk.length > 0) {
      const toPause = learningRisk.slice(0, 3)
      for (const c of toPause) {
        try {
          await axios.post(`${FB_GRAPH}/${c.campaignId}`, null, {
            params: { access_token: fbToken, status: 'PAUSED' },
            timeout: 15000,
          })
          const msg = `止损: 暂停学习期广告 ${c.campaignName}(花费$${c.spend.toFixed(2)}, ROAS=0)`
          a4Actions.push(msg)
          log.info(`[A4 Execute] ${msg}`)

          await Action.create({
            type: 'pause',
            platform: 'facebook',
            accountId: c.accountId,
            entityId: c.campaignId,
            entityName: c.campaignName,
            params: { source: 'a4_governor', learningPct: (learningPct * 100).toFixed(0) },
            reason: `[A4 止损] 学习期占比${(learningPct * 100).toFixed(0)}% > 30%，ROAS=0 花费$${c.spend.toFixed(2)}`,
            status: 'executed',
            executedAt: new Date(),
          })
        } catch (e: any) {
          log.warn(`[A4 Execute] Pause learning campaign failed: ${e.message}`)
        }
      }
    }
  }

  // Step 7: 飞书推送（每次都推，展示全部 campaign 数据）
  await notifyAutoPilot(verdicts, campaigns.length, snapshot, {
    autoOptimizers,
    fbEnabled,
    mbEnabled,
    minSpend,
    spendPriority: prioritySkill?.decision?.params?.spend_priority || 'facebook',
    roasPriority: prioritySkill?.decision?.params?.roas_priority || 'metabase',
  }, fusionSkills, decisionResult, a4Actions)

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

interface A2DecisionResult {
  verdicts: CampaignVerdict[]
  actions: any[]
  llmSummary: string
  llmReasoning: string[]
  decisionSource: 'llm' | 'legacy_fallback' | 'no_candidates'
}

async function makeSkillDecisions(campaigns: FBCampaignData[], recentActions: any[] = []): Promise<A2DecisionResult> {
  // 加载硬护栏（rule 类型）和经验（experience 类型）
  const hardRules = await Skill.find({ agentId: 'a2_decision', skillType: 'rule', enabled: true }).sort({ order: 1 }).lean() as any[]
  const experiences = await Skill.find({ agentId: 'a2_decision', skillType: 'experience', enabled: true }).sort({ 'experience.confidence': -1 }).lean() as any[]

  // 兼容旧 skills
  const legacyScreener = await Skill.find({ agentId: 'screener', enabled: true }).sort({ order: 1 }).lean() as AgentSkillDoc[]
  const legacyDecision = await Skill.find({ agentId: 'decision', enabled: true }).sort({ order: 1 }).lean() as AgentSkillDoc[]

  const verdicts: CampaignVerdict[] = []
  const actions: any[] = []
  let llmSummary = ''
  let llmReasoning: string[] = []
  let decisionSource: A2DecisionResult['decisionSource'] = 'no_candidates'

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

    // 给 LLM 看有花费的 campaign（含 PAUSED，评估是否应恢复或确认暂停正确）
    const activeCandidates = needsLLM.filter(c => c.spend > 0)

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
- pause: 暂停 ACTIVE 广告
- increase_budget: 对表现好的 ACTIVE 广告加预算
- decrease_budget: 对表现下滑的 ACTIVE 广告降预算
- resume: 恢复被误暂停的 PAUSED 广告（ROAS 不错但被停了）
- watch: 继续观察（默认，不用输出）

## 思考要求
1. 综合花费、ROAS、安装量、CPI 多维度判断
2. 不确定时选择观察（不输出该 campaign）
3. PAUSED 广告如果 ROAS > 1.0 且有安装，考虑建议 resume
4. ACTIVE 广告花费低且数据少时优先观察

重要：只输出需要操作的 campaign，不需要操作的不要包含在 JSON 里。
输出严格 JSON（不要多余文字）:
{"decisions":[{"campaignId":"...","action":"pause","reason":"...","confidence":0.8}],"summary":"..."}`

    // 注入最近操作历史，避免 LLM 重复决策
    const recentOpsText = recentActions.length > 0
      ? recentActions.slice(0, 10).map((a: any) => `${a.entityName?.substring(0, 40)}: ${a.type} @ ${dayjs(a.executedAt).format('HH:mm')}`).join('\n')
      : '无'

    const userMessage = `当前时间: ${dayjs().format('YYYY-MM-DD HH:mm')}

## 最近 2 小时操作记录（已执行，不要重复操作）
${recentOpsText}

## 重要：冷却期规则
- 最近 30 分钟内已操作过的 campaign 不要再操作
- 同一个 campaign 不要连续多轮加预算，防止预算失控

## 待分析 Campaign (${campaignData.length} 个)
${JSON.stringify(campaignData)}`

    log.info(`[A2] LLM input: ${activeCandidates.length} candidates (${activeCandidates.filter(c => (c as any).status === 'ACTIVE').length} ACTIVE, ${activeCandidates.filter(c => (c as any).status === 'PAUSED').length} PAUSED), userMsg ${userMessage.length} chars`)

    try {
      const content = await callLLMWithStream(systemPrompt, userMessage)
      log.info(`[A2] LLM raw response (${content.length} chars): ${content.substring(0, 200)}...`)
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
        llmSummary = llmResult.summary || ''
        llmReasoning = (llmResult.decisions || []).map((d: any) => `${d.campaignId?.substring(0, 12)}: ${d.action} - ${d.reason}`)
        decisionSource = 'llm'
        log.info(`[A2] LLM decided: ${actions.length} actions from ${activeCandidates.length} candidates. Summary: ${llmSummary}`)
      }
    } catch (e: any) {
      log.warn(`[A2] LLM decision failed, falling back to legacy rules: ${e.message}`)
      decisionSource = 'legacy_fallback'
      llmSummary = `LLM 调用失败 (${e.message.substring(0, 50)})，降级为旧规则引擎`

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
    decisionSource = 'legacy_fallback'
    llmSummary = '无 LLM API Key，使用旧规则引擎'
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

  if (needsLLM.length === 0) {
    llmSummary = '所有 campaign 花费过低或已被硬护栏过滤，无需 LLM 推理'
  }

  return { verdicts, actions, llmSummary, llmReasoning, decisionSource }
}

// ==================== A2 LLM Streaming + Retry ====================

async function callLLMWithStream(
  systemPrompt: string,
  userMessage: string,
  maxRetries = 3,
): Promise<string> {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${env.LLM_API_KEY}`,
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await axios.post(
        `${env.LLM_BASE_URL}/chat/completions`,
        {
          model: env.LLM_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.2,
          max_tokens: 4096,
          stream: true,
        },
        { headers, timeout: 180000, responseType: 'stream' },
      )

      return await new Promise<string>((resolve, reject) => {
        let content = ''
        let buffer = ''
        const stream = res.data

        stream.on('data', (chunk: Buffer) => {
          buffer += chunk.toString()
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || !trimmed.startsWith('data: ')) continue
            const payload = trimmed.slice(6)
            if (payload === '[DONE]') continue
            try {
              const parsed = JSON.parse(payload)
              const delta = parsed.choices?.[0]?.delta?.content
              if (delta) content += delta
            } catch { /* partial JSON chunk, skip */ }
          }
        })

        stream.on('end', () => {
          if (buffer.trim().startsWith('data: ')) {
            const payload = buffer.trim().slice(6)
            if (payload !== '[DONE]') {
              try {
                const parsed = JSON.parse(payload)
                const delta = parsed.choices?.[0]?.delta?.content
                if (delta) content += delta
              } catch { /* ignore */ }
            }
          }
          resolve(content)
        })

        stream.on('error', reject)
      })
    } catch (e: any) {
      const is504 = e.response?.status === 504 || e.message?.includes('504')
      const isTimeout = e.code === 'ECONNABORTED'

      if ((is504 || isTimeout) && attempt < maxRetries) {
        const waitSec = attempt * 3
        log.warn(`[A2] LLM attempt ${attempt}/${maxRetries} failed (${is504 ? '504 Gateway Timeout' : 'connection timeout'}), retrying in ${waitSec}s...`)
        await new Promise(r => setTimeout(r, waitSec * 1000))
        continue
      }
      throw e
    }
  }

  throw new Error('[A2] All LLM retries exhausted')
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

async function notifyAutoPilot(verdicts: CampaignVerdict[], totalCampaigns: number, snapshot?: any, fusionCfg?: FusionConfig, fusionSkillsList?: any[], decisionResult?: A2DecisionResult, a4ExecutedActions?: string[]): Promise<void> {
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
    const { llmSummary: a2Summary, llmReasoning: a2Reasoning, decisionSource: a2Source } = decisionResult
    const sourceLabel = a2Source === 'llm' ? 'LLM 独立推理' : a2Source === 'legacy_fallback' ? '降级规则引擎' : '无候选'
    const actionCount = decisionResult.actions.length

    const decisionLines = verdicts.filter(v => v.action).slice(0, 5).map(v => {
      const c = v.campaign
      return `**${c.campaignName}**\n${v.screenSkill} → ${v.action!.type}\nROAS ${c.roas.toFixed(2)} | 花费 $${c.spend.toFixed(2)}\n推理: ${v.action!.reason}`
    }).join('\n---\n')

    // 加载 A2 经验 skills 用于展示
    const a2Experiences = await Skill.find({ agentId: 'a2_decision', skillType: 'experience', enabled: true }).lean() as any[]
    const a2ExperienceText = a2Experiences.map((e: any) => `• **${e.name}** [置信${e.experience?.confidence || 0.5}]\n  教训: ${e.experience?.lesson || '-'}`).join('\n')

    const a2Elements: any[] = [
      { tag: 'div', text: { content: `**决策来源**: ${sourceLabel}\n**LLM 判断摘要**: ${a2Summary || '(无摘要)'}`, tag: 'lark_md' } },
      { tag: 'hr' },
      { tag: 'div', text: { content: `**筛选结果**: 需决策 **${needsDecision}** | 观察 ${watching} | 跳过 ${skipped}\n**产出动作**: ${actionCount} 条`, tag: 'lark_md' } },
    ]

    if (decisionLines) {
      a2Elements.push({ tag: 'hr' })
      a2Elements.push({ tag: 'div', text: { content: decisionLines, tag: 'lark_md' } })
    } else {
      a2Elements.push({ tag: 'div', text: { content: '本轮 LLM 分析后认为所有 ACTIVE campaign 无需操作，继续观察', tag: 'lark_md' } })
    }

    // LLM 推理明细（折叠）
    if (a2Reasoning.length > 0) {
      a2Elements.push({
        tag: 'collapsible_panel', expanded: false,
        header: { title: { tag: 'plain_text', content: `LLM 推理明细 (${a2Reasoning.length})` } },
        border: { color: 'orange' }, vertical_spacing: '4px',
        elements: a2Reasoning.slice(0, 15).map(r => ({
          tag: 'div' as const,
          text: { content: r, tag: 'lark_md' as const },
        })),
      })
    }

    // A2 经验 Skills（折叠）
    if (a2Experiences.length > 0) {
      a2Elements.push({
        tag: 'collapsible_panel', expanded: false,
        header: { title: { tag: 'plain_text', content: `A2 经验库 (${a2Experiences.length} 条，供 LLM 参考)` } },
        border: { color: 'orange' }, vertical_spacing: '4px',
        elements: [{ tag: 'div', text: { content: a2ExperienceText, tag: 'lark_md' } }],
      })
    }

    a2Elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: `TraceId: ${traceId} | @A2决策分析 可修改经验 | 决策已交付 → A3 执行路由` }] })

    const a2Card = {
      config: { wide_screen_mode: true },
      header: { template: actionCount > 0 ? 'orange' : 'turquoise', title: { content: `[A2 决策分析] ${sourceLabel} | ${actionCount} 条动作`, tag: 'plain_text' } },
      elements: a2Elements,
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

    // ── A4 全局治理：从 Metabase 3822 拉产品维度收入，拼 A1 花费算全局 ROAS ──
    let globalRevenue = 0
    let globalRoas = 0
    let globalProducts: Array<{ product: string; revenue: number; spend: number; roas: number }> = []

    try {
      const mbSess = await axios.post('https://meta.iohubonline.club/api/session', {
        username: process.env.METABASE_EMAIL, password: process.env.METABASE_PASSWORD,
      })
      const mbTok = mbSess.data.id
      const mbRes = await axios.post('https://meta.iohubonline.club/api/card/3822/query', {
        parameters: [
          { type: 'text', value: 'VfuSBdaO33sklvtr', target: ['variable', ['template-tag', 'access_code']] },
          { type: 'date/single', value: dayjs().format('YYYY-MM-DD'), target: ['variable', ['template-tag', 'start_day']] },
          { type: 'date/single', value: dayjs().format('YYYY-MM-DD'), target: ['variable', ['template-tag', 'end_day']] },
          { type: 'text', value: fusionCfg?.autoOptimizers?.join(',') || 'wwz', target: ['variable', ['template-tag', 'user_name']] },
        ],
      }, { headers: { 'X-Metabase-Session': mbTok }, timeout: 30000 })

      const mbData = mbRes.data?.data
      const mbCols = (mbData?.cols || []).map((c: any) => c.name)
      const ci = (name: string) => mbCols.indexOf(name)

      for (const r of mbData?.rows || []) {
        const date = r[ci('日期')]
        const pkg = r[ci('包名')]
        if (!date || date === '汇总' || !pkg || pkg === 'ALL') continue

        const adjRevenue = Number(r[ci('调整的首日收入')] || 0)
        const channelRevenue = Number(r[ci('渠道收入')] || 0)
        const rev = adjRevenue > 0 ? adjRevenue : channelRevenue

        const productSpend = snapshot?.fusedCampaigns
          ?.filter((f: any) => (f.pkgName || '').toLowerCase().includes(pkg.toLowerCase().replace('ios-', '').replace('android-', '')))
          ?.reduce((s: number, f: any) => s + f.spend, 0) || 0

        globalRevenue += rev
        globalProducts.push({
          product: pkg,
          revenue: rev,
          spend: productSpend,
          roas: productSpend > 0 ? rev / productSpend : 0,
        })
      }
      globalRoas = totalSpend > 0 ? globalRevenue / totalSpend : 0
      log.info(`[A4] Global ROAS: revenue=$${globalRevenue.toFixed(2)} / spend=$${totalSpend.toFixed(2)} = ${globalRoas.toFixed(2)}`)
    } catch (e: any) {
      log.warn(`[A4] Failed to fetch product revenue: ${e.message}, using campaign avg ROAS`)
      globalRoas = avgRoas
    }

    // 加载 A4 目标 Skills
    const a4Goals = await Skill.find({ agentId: 'a4_governor', skillType: 'goal', enabled: true }).lean() as any[]
    const a4Experiences = await Skill.find({ agentId: 'a4_governor', skillType: 'experience', enabled: true }).lean() as any[]

    let riskLevel: 'low' | 'medium' | 'high' = 'low'
    const overrides: string[] = []
    const goalAnalysis: string[] = []

    for (const g of a4Goals) {
      const goal = g.goal || {}
      const prod = globalProducts.find(p => p.product.toLowerCase().includes((goal.product || '').toLowerCase()))
      const prodSpend = prod?.spend || totalSpend
      const prodRoas = prod?.roas || globalRoas
      const spendTarget = goal.dailySpendTarget || 0
      const roasFloor = goal.roasFloor || 0
      const spendPct = spendTarget > 0 ? Math.round((prodSpend / spendTarget) * 100) : 0

      goalAnalysis.push(`**${goal.product || g.name}**: 花费 $${prodSpend.toFixed(2)}/${spendTarget}目标(${spendPct}%) | ROAS ${prodRoas.toFixed(2)}/${roasFloor}底线`)

      if (roasFloor > 0 && prodRoas < roasFloor && prodRoas > 0) {
        if (goal.priority === 'roas_first') {
          riskLevel = 'high'
          overrides.push(`${goal.product} ROAS ${prodRoas.toFixed(2)} 低于底线 ${roasFloor}，止损优先`)
        } else {
          riskLevel = riskLevel === 'high' ? 'high' : 'medium'
          overrides.push(`${goal.product} ROAS 偏低但冲量优先，控制亏损幅度`)
        }
      }
      if (spendTarget > 0 && prodSpend < spendTarget * 0.5 && dayjs().hour() > 12) {
        overrides.push(`${goal.product} 消耗进度 ${spendPct}% 偏低，考虑补量`)
      }
    }

    if (a4Goals.length === 0) {
      if (globalRoas > 0 && globalRoas < 0.8) riskLevel = 'high'
      else if (globalRoas > 0 && globalRoas < 1.0) riskLevel = 'medium'
    }

    const riskLabel = riskLevel === 'high' ? '🔴 高风险' : riskLevel === 'medium' ? '🟡 中风险' : '🟢 低风险'

    const a4Elements: any[] = [
      { tag: 'div', fields: [
        { is_short: true, text: { content: `**全局花费**\n$${totalSpend.toFixed(2)}`, tag: 'lark_md' } },
        { is_short: true, text: { content: `**全局收入**\n$${globalRevenue.toFixed(2)}`, tag: 'lark_md' } },
        { is_short: true, text: { content: `**全局ROAS**\n${globalRoas.toFixed(2)}`, tag: 'lark_md' } },
        { is_short: true, text: { content: `**风险**\n${riskLabel}`, tag: 'lark_md' } },
      ]},
    ]

    if (goalAnalysis.length > 0) {
      a4Elements.push({ tag: 'hr' })
      a4Elements.push({ tag: 'div', text: { content: `**产品目标对比**:\n${goalAnalysis.join('\n')}`, tag: 'lark_md' } })
    }

    if (overrides.length > 0) {
      a4Elements.push({ tag: 'hr' })
      a4Elements.push({ tag: 'div', text: { content: `**纠偏指令**:\n${overrides.map(o => `• ${o}`).join('\n')}`, tag: 'lark_md' } })
    } else {
      a4Elements.push({ tag: 'div', text: { content: '本轮动作符合全局目标，无需纠偏', tag: 'lark_md' } })
    }

    if (a4ExecutedActions && a4ExecutedActions.length > 0) {
      a4Elements.push({ tag: 'hr' })
      a4Elements.push({ tag: 'div', text: { content: `**已执行纠偏**:\n${a4ExecutedActions.map(a => `✅ ${a}`).join('\n')}`, tag: 'lark_md' } })
    }

    if (a4Experiences.length > 0) {
      a4Elements.push({
        tag: 'collapsible_panel', expanded: false,
        header: { title: { tag: 'plain_text', content: `A4 策略经验 (${a4Experiences.length})` } },
        border: { color: 'red' }, vertical_spacing: '4px',
        elements: a4Experiences.map((e: any) => ({
          tag: 'div' as const,
          text: { content: `• **${e.name}**: ${e.experience?.lesson || '-'}`, tag: 'lark_md' as const },
        })),
      })
    }

    a4Elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: `TraceId: ${traceId} | 数据源: Metabase#3822(收入) + A1(花费) | @A4全局控制 可修改目标` }] })

    const a4Card = {
      config: { wide_screen_mode: true },
      header: { template: riskLevel === 'high' ? 'red' : riskLevel === 'medium' ? 'orange' : 'green', title: { content: `[A4 全局治理] ${riskLabel} | ROAS ${globalRoas.toFixed(2)} | $${totalSpend.toFixed(0)}/$${a4Goals[0]?.goal?.dailySpendTarget || '?'}`, tag: 'plain_text' } },
      elements: a4Elements,
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
