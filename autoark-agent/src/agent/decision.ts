/**
 * Agent 2: Decision — Skill 驱动的 LLM 决策引擎
 *
 * 规则引擎先生成基础决策，LLM 审查并补充。
 * LLM 失败时降级为纯规则引擎。
 * 所有输出经过 normalizeActions 统一后处理。
 */
import axios from 'axios'
import dayjs from 'dayjs'
import { env } from '../config/env'
import { log } from '../platform/logger'
import { ClassifiedCampaign } from './classifier'
import { Action } from '../action/action.model'
import { Skill, AgentSkillDoc, matchesCampaign, evaluateConditions, fillReasonTemplate } from './skill.model'
import { buildDynamicContext } from './context'

export interface DecisionAction {
  type: 'pause' | 'increase_budget' | 'decrease_budget' | 'resume'
  campaignId: string
  campaignName: string
  accountId: string
  reason: string
  auto: boolean
  currentBudget?: number
  newBudget?: number
  skillName?: string
}

export interface DecisionResult {
  actions: DecisionAction[]
  summary: string
  alerts: string[]
}

/**
 * Skill 驱动的决策（规则引擎 + LLM 双保险）
 */
export async function makeDecisions(
  campaigns: ClassifiedCampaign[],
  benchmarks?: any,
): Promise<DecisionResult> {
  const recentActions = await Action.find({
    status: { $in: ['executed', 'approved', 'pending'] },
    createdAt: { $gte: dayjs().subtract(24, 'hour').toDate() },
  }).lean()
  const recentCampaignIds = new Set(recentActions.map((a: any) => a.entityId).filter(Boolean))

  const decisionSkills = await Skill.find({ agentId: 'decision', enabled: true })
    .sort({ order: 1 })
    .lean() as AgentSkillDoc[]

  const ruleActions = generateSkillBasedDecisions(campaigns, decisionSkills, recentCampaignIds)
  log.info(`[Decision] Rule engine: ${ruleActions.length} actions`)

  const inputData = campaigns
    .filter(c => c.label !== 'observing')
    .filter(c => !recentCampaignIds.has(c.campaignId))
    .map(c => ({
      campaignId: c.campaignId,
      campaignName: c.campaignName,
      accountId: c.accountId,
      label: c.label,
      labelName: c.labelName,
      todaySpend: c.todaySpend,
      todayRoas: c.todayRoas,
      avgRoas3d: c.avgRoas3d,
      totalSpend3d: c.totalSpend3d,
      estimatedDailySpend: c.estimatedDailySpend,
      installs: c.installs || 0,
      cpi: c.cpi || 0,
      adjustedRoi: c.adjustedRoi || 0,
      day3Roi: c.day3Roi || 0,
      payRate: c.payRate || 0,
      trendSummary: c.trendSummary || '',
    }))

  if (inputData.length === 0) {
    return { actions: normalizeActions(ruleActions, campaigns), summary: '无需审查的 campaign', alerts: [] }
  }

  if (!env.LLM_API_KEY) {
    log.warn('[Decision] No LLM_API_KEY, using skill-based rules only')
    return { actions: normalizeActions(ruleActions, campaigns), summary: `规则引擎: ${ruleActions.length} 个操作`, alerts: [] }
  }

  const systemPrompt = buildSkillDrivenPrompt(decisionSkills, benchmarks)
  const dynamicContext = await buildDynamicContext()

  const benchmarkDesc = benchmarks ? `
## 大盘锚定值（全量 ${benchmarks.totalCampaigns} 个 campaign）
- 总花费: $${benchmarks.totalSpend} | 加权 ROAS: ${benchmarks.weightedRoas}
- ROI 分位: P25=${benchmarks.p25Roi} | P50=${benchmarks.medianRoi} | P75=${benchmarks.p75Roi}
- 平均 CPI: $${benchmarks.avgCpi} | 平均付费率: ${benchmarks.avgPayRate}
${Object.entries(benchmarks.byPlatform).map(([p, v]: [string, any]) => `- ${p}: ${v.count}个, 均ROI ${v.avgRoi}, 花费 $${v.totalSpend}`).join('\n')}` : ''

  const userMessage = `${dynamicContext}

---

当前时间: ${dayjs().format('YYYY-MM-DD HH:mm')}
${benchmarkDesc}

## 规则引擎预判（${ruleActions.length} 个操作）
${ruleActions.length > 0 ? JSON.stringify(ruleActions.map(a => ({ type: a.type, campaign: a.campaignName, reason: a.reason, auto: a.auto })), null, 2) : '无'}

## 待审查 Campaign（${inputData.length} 个）
${JSON.stringify(inputData, null, 2)}

请基于以上策略规则和数据，确认或调整规则引擎的预判，并补充遗漏的操作。输出 JSON。`

  try {
    const res = await axios.post(
      `${env.LLM_BASE_URL}/chat/completions`,
      {
        model: env.LLM_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.1,
        max_tokens: 4096,
      },
      {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.LLM_API_KEY}` },
        timeout: 60000,
      }
    )

    const content = res.data.choices?.[0]?.message?.content || ''
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      log.warn('[Decision] LLM did not return valid JSON, using rule-based decisions')
      return { actions: normalizeActions(ruleActions, campaigns), summary: 'LLM 无效输出，降级为规则引擎', alerts: [] }
    }

    const decision = JSON.parse(jsonMatch[0]) as DecisionResult
    decision.actions = normalizeActions(decision.actions || [], campaigns)
    log.info(`[Decision] LLM: ${decision.actions.length} actions (rules had ${ruleActions.length})`)
    return decision
  } catch (err: any) {
    log.error('[Decision] LLM call failed:', err.response?.data?.error?.message || err.message)
    return { actions: normalizeActions(ruleActions, campaigns), summary: `LLM 失败，降级规则引擎: ${ruleActions.length} 个操作`, alerts: [] }
  }
}

// ==================== 统一后处理 ====================

/**
 * 对规则引擎 or LLM 的输出统一校验、补全、去重
 */
function normalizeActions(
  actions: DecisionAction[],
  campaigns: ClassifiedCampaign[],
): DecisionAction[] {
  const campaignMap = new Map(campaigns.map(c => [c.campaignId, c]))
  const seen = new Set<string>()
  const result: DecisionAction[] = []

  for (const a of actions) {
    if (!a?.campaignId || !a?.type) continue

    const key = `${a.campaignId}:${a.type}`
    if (seen.has(key)) continue
    seen.add(key)

    const c = campaignMap.get(a.campaignId)
    result.push({
      type: a.type,
      campaignId: a.campaignId,
      campaignName: a.campaignName || c?.campaignName || '',
      accountId: a.accountId || c?.accountId || '',
      reason: a.reason || '',
      auto: a.auto ?? false,
      currentBudget: a.currentBudget,
      newBudget: a.newBudget,
      skillName: a.skillName,
    })
  }

  return result
}

// ==================== Skill 规则引擎 ====================

function generateSkillBasedDecisions(
  campaigns: ClassifiedCampaign[],
  skills: AgentSkillDoc[],
  recentIds: Set<string>,
): DecisionAction[] {
  const actions: DecisionAction[] = []

  for (const c of campaigns) {
    if (recentIds.has(c.campaignId)) continue
    if (c.label === 'observing') continue

    for (const skill of skills) {
      if (!matchesCampaign(skill, c)) continue
      const d = skill.decision
      if (!d?.action) continue

      const labelMatch = d.triggerLabels?.length > 0
        ? d.triggerLabels.includes(c.label)
        : true
      const condMatch = d.conditions?.length > 0
        ? evaluateConditions(d.conditions, d.conditionLogic, c as any)
        : true
      if (!labelMatch || !condMatch) continue

      const reason = fillReasonTemplate(d.reasonTemplate || skill.name, c as any)
      const action: DecisionAction = {
        type: d.action,
        campaignId: c.campaignId,
        campaignName: c.campaignName,
        accountId: c.accountId,
        reason,
        auto: d.auto,
        skillName: skill.name,
      }

      if (d.action === 'increase_budget' && d.params?.budgetChangePct) {
        action.currentBudget = Math.round(c.estimatedDailySpend)
        action.newBudget = Math.round(c.estimatedDailySpend * (1 + d.params.budgetChangePct / 100))
      }

      actions.push(action)
      break
    }
  }

  return actions
}

// ==================== LLM Prompt 构建 ====================

function buildSkillDrivenPrompt(skills: AgentSkillDoc[], benchmarks?: any): string {
  const parts: string[] = []

  parts.push(`你是一个广告投放决策引擎。你的输入是经过预处理的 campaign 数据和规则引擎的预判结果，你的输出是最终的结构化操作清单。

## 你的策略规则库（从 Skill 系统加载）
`)

  for (const skill of skills) {
    const d = skill.decision
    if (!d) continue
    parts.push(`### ${skill.name}`)
    if (skill.description) parts.push(skill.description)
    if (d.triggerLabels?.length) parts.push(`- 触发标签: ${d.triggerLabels.join(', ')}`)
    parts.push(`- 操作: ${d.action} (${d.auto ? '自动' : '需审批'})`)
    if (d.llmContext) parts.push(`- 背景: ${d.llmContext}`)
    if (d.llmRules?.length) for (const r of d.llmRules) parts.push(`- 规则: ${r}`)
    if (skill.learnedNotes?.length) {
      parts.push(`- 历史经验:`)
      for (const n of skill.learnedNotes.slice(-3)) parts.push(`  - ${n}`)
    }
    parts.push('')
  }

  parts.push(`## 输出格式（严格 JSON）
\`\`\`json
{
  "actions": [
    { "type": "pause|increase_budget|decrease_budget|resume", "campaignId": "...", "campaignName": "...", "accountId": "...", "reason": "具体原因", "auto": true/false, "currentBudget": 100, "newBudget": 130 }
  ],
  "summary": "简要总结",
  "alerts": ["异常告警"]
}
\`\`\`
只输出 JSON。reason 要具体，包含数值和趋势。每个 action 必须包含 accountId。`)

  return parts.join('\n')
}
