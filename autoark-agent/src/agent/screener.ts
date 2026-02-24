/**
 * Agent 1: Screener — Skill 驱动的 Campaign 筛选引擎
 *
 * 职责：对每个 campaign 给出 verdict（needs_decision / watch / skip）。
 * 不做分类，不做决策。
 */
import { log } from '../platform/logger'
import { Skill, AgentSkillDoc, matchesCampaign, evaluateConditions, fillReasonTemplate } from './skill.model'
import { TimeSeries } from './monitor/timeseries.model'
import { Action } from '../action/action.model'
import { CampaignMetrics } from './analyzer'
import type { MarketBenchmark } from './brain'
import dayjs from 'dayjs'

// ==================== 类型 ====================

export interface ScreeningResult {
  campaignId: string
  campaignName: string
  verdict: 'needs_decision' | 'watch' | 'skip'
  matchedSkill: string
  reasons: string[]
  priority: 'critical' | 'high' | 'normal' | 'low'
}

export interface ScreeningSummary {
  total: number
  needsDecision: number
  watch: number
  skip: number
  results: ScreeningResult[]
  skillHits: Record<string, number>
}

// ==================== 核心 ====================

/**
 * 对全量 campaign 执行 Skill 驱动的筛选
 */
export async function screenCampaigns(
  campaigns: CampaignMetrics[],
  options: {
    benchmarks?: MarketBenchmark
    pendingActionIds?: Set<string>
  } = {},
): Promise<ScreeningSummary> {
  const skills = await Skill.find({ agentId: 'screener', enabled: true })
    .sort({ order: 1 })
    .lean() as AgentSkillDoc[]

  if (skills.length === 0) {
    log.warn('[Screener] No screener skills loaded, all campaigns will be watch')
  }

  const pendingIds = options.pendingActionIds || await loadPendingActionIds()

  const results: ScreeningResult[] = []
  const skillHits: Record<string, number> = {}
  const historyCheckCampaigns: Array<{ campaign: CampaignMetrics; skill: AgentSkillDoc }> = []

  for (const campaign of campaigns) {
    const data = buildCampaignData(campaign, options.benchmarks, pendingIds)
    let matched = false

    for (const skill of skills) {
      if (!matchesCampaign(skill, campaign)) continue

      const sc = skill.screening
      if (!sc?.conditions?.length) continue

      if (evaluateConditions(sc.conditions, sc.conditionLogic, data)) {
        const reason = fillReasonTemplate(sc.reasonTemplate || skill.name, data)

        if (sc.verdict === 'watch' && sc.historyCheck?.enabled) {
          historyCheckCampaigns.push({ campaign, skill })
          matched = true
          break
        }

        results.push({
          campaignId: campaign.campaignId,
          campaignName: campaign.campaignName,
          verdict: sc.verdict,
          matchedSkill: skill.name,
          reasons: [reason],
          priority: sc.priority || 'normal',
        })

        skillHits[skill.name] = (skillHits[skill.name] || 0) + 1
        await incrementSkillTrigger(skill._id)
        matched = true
        break
      }
    }

    if (!matched) {
      results.push({
        campaignId: campaign.campaignId,
        campaignName: campaign.campaignName,
        verdict: 'watch',
        matchedSkill: 'default',
        reasons: ['未匹配任何筛选规则'],
        priority: 'low',
      })
    }
  }

  // Layer 2: 对 historyCheck 的 campaign 执行历史比对
  if (historyCheckCampaigns.length > 0) {
    const historyResults = await runHistoryChecks(historyCheckCampaigns, options.benchmarks)
    results.push(...historyResults)
    for (const r of historyResults) {
      if (r.matchedSkill !== 'default') {
        skillHits[r.matchedSkill] = (skillHits[r.matchedSkill] || 0) + 1
      }
    }
  }

  const summary: ScreeningSummary = {
    total: campaigns.length,
    needsDecision: results.filter(r => r.verdict === 'needs_decision').length,
    watch: results.filter(r => r.verdict === 'watch').length,
    skip: results.filter(r => r.verdict === 'skip').length,
    results,
    skillHits,
  }

  log.info(`[Screener] ${summary.total} campaigns → ${summary.needsDecision} needs_decision, ${summary.watch} watch, ${summary.skip} skip`)
  if (Object.keys(skillHits).length > 0) {
    log.info(`[Screener] Skill hits: ${Object.entries(skillHits).map(([k, v]) => `${k}(${v})`).join(', ')}`)
  }

  return summary
}

// ==================== 内部工具 ====================

/**
 * 把 CampaignMetrics 转成平铺的 data map，方便条件评估
 */
function buildCampaignData(
  c: CampaignMetrics,
  benchmarks?: MarketBenchmark,
  pendingIds?: Set<string>,
): Record<string, any> {
  const yesterdayRoi = c.yesterdayRoas || 0
  const todayRoi = c.adjustedRoi || c.todayRoas || 0
  const roiDrop = yesterdayRoi > 0 ? Math.round((1 - todayRoi / yesterdayRoi) * 100) : 0

  return {
    ...c,
    adjustedRoi: c.adjustedRoi || c.firstDayRoi || c.todayRoas || 0,
    roiDropVsYesterday: roiDrop > 0 ? roiDrop : 0,
    roasTrend: c.roasTrend || 0,
    confidence: (c as any).confidence || 1,
    hasPendingAction: pendingIds?.has(c.campaignId) ? 1 : 0,
    belowBenchmarkP25: benchmarks && todayRoi < benchmarks.p25Roi && todayRoi > 0 ? 1 : 0,
  }
}

async function loadPendingActionIds(): Promise<Set<string>> {
  const pending = await Action.find({
    status: 'pending',
    createdAt: { $gte: dayjs().subtract(24, 'hour').toDate() },
  }).select('entityId').lean()
  return new Set(pending.map((a: any) => a.entityId).filter(Boolean))
}

async function incrementSkillTrigger(skillId: any): Promise<void> {
  try {
    await Skill.updateOne({ _id: skillId }, {
      $inc: { 'stats.triggered': 1 },
      $set: { 'stats.lastTriggeredAt': new Date() },
    })
  } catch { /* non-critical */ }
}

/**
 * Layer 2: 历史偏离检测
 * 从 TimeSeries 读取该 campaign 的历史数据，计算偏离度
 */
async function runHistoryChecks(
  items: Array<{ campaign: CampaignMetrics; skill: AgentSkillDoc }>,
  benchmarks?: MarketBenchmark,
): Promise<ScreeningResult[]> {
  const results: ScreeningResult[] = []

  const campaignIds = items.map(i => i.campaign.campaignId)
  const windowDays = items[0]?.skill.screening?.historyCheck?.windowDays || 7

  const historyData = await TimeSeries.find({
    campaignId: { $in: campaignIds },
    sampledAt: { $gte: dayjs().subtract(windowDays, 'day').toDate() },
  }).sort({ sampledAt: -1 }).lean()

  const historyMap = new Map<string, any[]>()
  for (const h of historyData as any[]) {
    const arr = historyMap.get(h.campaignId) || []
    arr.push(h)
    historyMap.set(h.campaignId, arr)
  }

  for (const { campaign, skill } of items) {
    const hc = skill.screening?.historyCheck
    if (!hc?.enabled) continue

    const history = historyMap.get(campaign.campaignId) || []
    if (history.length < 3) {
      results.push({
        campaignId: campaign.campaignId,
        campaignName: campaign.campaignName,
        verdict: 'watch',
        matchedSkill: skill.name,
        reasons: ['历史数据不足，继续观察'],
        priority: 'low',
      })
      continue
    }

    const field = hc.field || 'roi'
    const values = history.map((h: any) => h[field] || 0).filter((v: number) => v > 0)
    if (values.length < 3) {
      results.push({
        campaignId: campaign.campaignId,
        campaignName: campaign.campaignName,
        verdict: 'watch',
        matchedSkill: skill.name,
        reasons: ['有效历史数据不足'],
        priority: 'low',
      })
      continue
    }

    const mean = values.reduce((a: number, b: number) => a + b, 0) / values.length
    const stddev = Math.sqrt(values.reduce((s: number, v: number) => s + (v - mean) ** 2, 0) / values.length)
    const currentVal = (campaign as any)[field] || campaign.adjustedRoi || campaign.todayRoas || 0
    const deviation = stddev > 0 ? Math.abs(currentVal - mean) / stddev : 0

    if (deviation >= (hc.deviationStddev || 2)) {
      const direction = currentVal < mean ? '偏低' : '偏高'
      results.push({
        campaignId: campaign.campaignId,
        campaignName: campaign.campaignName,
        verdict: 'needs_decision',
        matchedSkill: skill.name,
        reasons: [`${field} 当前 ${currentVal.toFixed(2)} ${direction}于历史均值 ${mean.toFixed(2)}（偏离 ${deviation.toFixed(1)} 个标准差）`],
        priority: 'normal',
      })
      await incrementSkillTrigger(skill._id)
    } else {
      results.push({
        campaignId: campaign.campaignId,
        campaignName: campaign.campaignName,
        verdict: 'watch',
        matchedSkill: skill.name,
        reasons: [`${field} 在历史正常范围内`],
        priority: 'low',
      })
    }
  }

  return results
}
