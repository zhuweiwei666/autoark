/**
 * Step 4: LLM 决策引擎 - 结构化输入标记数据，结构化输出操作清单
 * 这是唯一调 LLM 的环节
 */
import axios from 'axios'
import { env } from '../config/env'
import { log } from '../platform/logger'
import { ClassifiedCampaign } from './classifier'
import { DECISION_PROMPT } from './standards'
import { Action } from '../action/action.model'
import dayjs from 'dayjs'
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
}

export interface DecisionResult {
  actions: DecisionAction[]
  summary: string
  alerts: string[]
}

/**
 * 调 LLM 生成决策
 */
export async function makeDecisions(
  campaigns: ClassifiedCampaign[],
): Promise<DecisionResult> {
  // 过滤掉最近 24h 操作过的 campaign（冷却期）
  const recentActions = await Action.find({
    status: { $in: ['executed', 'approved', 'pending'] },
    createdAt: { $gte: dayjs().subtract(24, 'hour').toDate() },
  }).lean()
  const recentCampaignIds = new Set(recentActions.map((a: any) => a.entityId).filter(Boolean))

  // 构建给 LLM 的输入数据（精简，避免 token 浪费）
  const inputData = campaigns
    .filter(c => c.label !== 'observing') // 观察期的不发给 LLM
    .map(c => ({
      campaignId: c.campaignId,
      campaignName: c.campaignName,
      accountId: c.accountId,
      label: c.label,
      labelName: c.labelName,
      todaySpend: c.todaySpend,
      todayRoas: c.todayRoas,
      yesterdayRoas: c.yesterdayRoas,
      avgRoas3d: c.avgRoas3d,
      totalSpend3d: c.totalSpend3d,
      roasTrend: `${c.roasTrend > 0 ? '+' : ''}${c.roasTrend}%`,
      estimatedDailySpend: c.estimatedDailySpend,
      todayConversions: c.todayConversions,
      // 转化指标（来自前端数据）
      installs: c.installs || 0,
      cpi: c.cpi || 0,
      firstDayRoi: c.firstDayRoi || 0,
      adjustedRoi: c.adjustedRoi || 0,
      day3Roi: c.day3Roi || 0,
      day7Roi: c.day7Roi || 0,
      payRate: c.payRate || 0,
      recentlyOperated: recentCampaignIds.has(c.campaignId),
    }))

  // 统计
  const stats = {
    total: campaigns.length,
    observing: campaigns.filter(c => c.label === 'observing').length,
    needsReview: inputData.length,
    recentlyOperated: inputData.filter(c => c.recentlyOperated).length,
  }

  // 构建动态上下文（经验 + 时间感知 + 用户偏好 + 数据质量）
  const dynamicContext = await buildDynamicContext()

  const userMessage = `${dynamicContext}

---

当前时间: ${dayjs().format('YYYY-MM-DD HH:mm')}

## 数据统计
- 总 campaign: ${stats.total}
- 观察期（跳过）: ${stats.observing}
- 需要审查: ${stats.needsReview}
- 24h内操作过（跳过）: ${stats.recentlyOperated}

## Campaign 数据（已标记）
${JSON.stringify(inputData.filter(c => !c.recentlyOperated), null, 2)}

请根据决策规则输出操作清单（JSON）。`

  if (!env.LLM_API_KEY) {
    log.warn('[Decision] No LLM_API_KEY, generating rule-based decisions')
    return generateRuleBasedDecisions(campaigns, recentCampaignIds)
  }

  try {
    const res = await axios.post(
      `${env.LLM_BASE_URL}/chat/completions`,
      {
        model: env.LLM_MODEL,
        messages: [
          { role: 'system', content: DECISION_PROMPT },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.1,
        max_tokens: 4096,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.LLM_API_KEY}`,
        },
        timeout: 120000,
      }
    )

    const content = res.data.choices?.[0]?.message?.content || ''
    
    // 提取 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      log.warn('[Decision] LLM did not return valid JSON, falling back to rules')
      return generateRuleBasedDecisions(campaigns, recentCampaignIds)
    }

    const decision = JSON.parse(jsonMatch[0]) as DecisionResult
    log.info(`[Decision] LLM generated ${decision.actions.length} actions`)
    return decision
  } catch (err: any) {
    log.error('[Decision] LLM call failed:', err.response?.data?.error?.message || err.message)
    // 降级：用纯规则生成决策
    return generateRuleBasedDecisions(campaigns, recentCampaignIds)
  }
}

/**
 * 降级方案：纯规则生成决策（不依赖 LLM）
 */
function generateRuleBasedDecisions(
  campaigns: ClassifiedCampaign[],
  recentIds: Set<string>,
): DecisionResult {
  const actions: DecisionAction[] = []

  for (const c of campaigns) {
    if (recentIds.has(c.campaignId)) continue // 冷却期
    if (c.label === 'observing') continue

    // 严重亏损 -> 自动关停
    if (c.label === 'loss_severe') {
      actions.push({
        type: 'pause', campaignId: c.campaignId, campaignName: c.campaignName,
        accountId: c.accountId, auto: true,
        reason: `亏损严重: ROAS ${c.avgRoas3d}, 花费 $${c.totalSpend3d}`,
      })
    }
    // 花费高零转化 -> 自动关停
    else if (c.totalSpend3d > 100 && c.todayConversions === 0 && c.dailyData.every(d => d.roas === 0)) {
      actions.push({
        type: 'pause', campaignId: c.campaignId, campaignName: c.campaignName,
        accountId: c.accountId, auto: true,
        reason: `花费 $${c.totalSpend3d} 零转化`,
      })
    }
    // 轻微亏损 -> 审批关停
    else if (c.label === 'loss_mild') {
      actions.push({
        type: 'pause', campaignId: c.campaignId, campaignName: c.campaignName,
        accountId: c.accountId, auto: false,
        reason: `轻微亏损: ROAS ${c.avgRoas3d}, 建议关停观察`,
      })
    }
    // 衰退中 -> 审批关停
    else if (c.label === 'declining') {
      actions.push({
        type: 'pause', campaignId: c.campaignId, campaignName: c.campaignName,
        accountId: c.accountId, auto: false,
        reason: `衰退中: ${c.labelReason}`,
      })
    }
    // 高潜力 -> 审批加预算
    else if (c.label === 'high_potential' && c.estimatedDailySpend < 200) {
      const increase = Math.round(c.estimatedDailySpend * 0.25)
      actions.push({
        type: 'increase_budget', campaignId: c.campaignId, campaignName: c.campaignName,
        accountId: c.accountId, auto: false,
        currentBudget: Math.round(c.estimatedDailySpend),
        newBudget: Math.round(c.estimatedDailySpend + increase),
        reason: `高潜力: ROAS ${c.avgRoas3d}, 建议加预算 25%`,
      })
    }
  }

  const summary = `规则引擎决策: ${actions.filter(a => a.auto).length} 个自动执行, ${actions.filter(a => !a.auto).length} 个待审批`
  return { actions, summary, alerts: [] }
}
