/**
 * Agent Brain - 动态规划中枢
 * 
 * 1. 感知环境（全量数据）→ 生成事件 + 大盘锚定值
 * 2. 查看记忆 → 有没有待办任务、待复盘决策
 * 3. 权责过滤 → 只把自己能操作的 campaign 送进决策
 * 4. 分类 + LLM 决策（带大盘锚定值做参照）
 * 5. 记录
 */
import dayjs from 'dayjs'
import { log } from '../platform/logger'
import { monitor } from './monitor'
import { classifyCampaigns, classifySummary } from './classifier'
import { makeDecisions, DecisionAction } from './decision'
import { reflectAll, getReflectionStats } from './reflection'
import { memory } from './memory.service'
import { AgentEvent, getEventPriority, describeEvent } from './events'
import { CampaignMetrics } from './analyzer'
import type { DecisionReadyData } from './monitor'
import { Snapshot } from '../data/snapshot.model'
import { Action } from '../action/action.model'
import * as toptouApi from '../platform/toptou/api'
import { getTopTouToken } from '../platform/toptou/client'
import { canOperate, describeScopeForPrompt } from './scope'

export interface MarketBenchmark {
  totalCampaigns: number
  totalSpend: number
  weightedRoas: number     // 花费加权 ROAS
  avgCpi: number
  avgAdjustedRoi: number
  medianRoi: number
  p25Roi: number           // ROI 25 分位（差的水平线）
  p75Roi: number           // ROI 75 分位（好的水平线）
  avgPayRate: number
  byPlatform: Record<string, { count: number; avgRoi: number; avgCpi: number; totalSpend: number }>
}

export interface BrainCycleResult {
  snapshotId: string
  phase: string
  events: AgentEvent[]
  reflections: any[]
  actions: any[]
  summary: string
  durationMs: number
}

/**
 * 从全量数据计算大盘锚定值
 */
function computeBenchmarks(campaigns: CampaignMetrics[]): MarketBenchmark {
  const withSpend = campaigns.filter(c => c.todaySpend > 10)
  const totalSpend = withSpend.reduce((s, c) => s + c.todaySpend, 0)

  // 花费加权 ROAS
  const weightedRoas = totalSpend > 0
    ? withSpend.reduce((s, c) => s + c.todayRoas * c.todaySpend, 0) / totalSpend
    : 0

  // ROI 分位数
  const rois = withSpend.map(c => c.todayRoas).filter(r => r > 0).sort((a, b) => a - b)
  const pct = (arr: number[], p: number) => arr.length > 0 ? arr[Math.floor(arr.length * p)] || 0 : 0

  // 按平台汇总
  const platMap = new Map<string, { count: number; roiSum: number; cpiSum: number; spend: number }>()
  for (const c of withSpend) {
    const p = c.platform || 'other'
    const cur = platMap.get(p) || { count: 0, roiSum: 0, cpiSum: 0, spend: 0 }
    cur.count++
    cur.roiSum += c.todayRoas
    cur.cpiSum += c.cpi
    cur.spend += c.todaySpend
    platMap.set(p, cur)
  }
  const byPlatform: Record<string, any> = {}
  for (const [p, v] of platMap) {
    byPlatform[p] = {
      count: v.count,
      avgRoi: v.count > 0 ? Number((v.roiSum / v.count).toFixed(2)) : 0,
      avgCpi: v.count > 0 ? Number((v.cpiSum / v.count).toFixed(2)) : 0,
      totalSpend: Math.round(v.spend),
    }
  }

  return {
    totalCampaigns: campaigns.length,
    totalSpend: Math.round(totalSpend),
    weightedRoas: Number(weightedRoas.toFixed(2)),
    avgCpi: withSpend.length > 0 ? Number((withSpend.reduce((s, c) => s + c.cpi, 0) / withSpend.length).toFixed(2)) : 0,
    avgAdjustedRoi: withSpend.length > 0 ? Number((withSpend.reduce((s, c) => s + c.todayRoas, 0) / withSpend.length).toFixed(2)) : 0,
    medianRoi: Number(pct(rois, 0.5).toFixed(2)),
    p25Roi: Number(pct(rois, 0.25).toFixed(2)),
    p75Roi: Number(pct(rois, 0.75).toFixed(2)),
    avgPayRate: withSpend.length > 0 ? Number((withSpend.reduce((s, c) => s + c.payRate, 0) / withSpend.length).toFixed(2)) : 0,
    byPlatform,
  }
}

/**
 * Agent 思考循环 - 每次被唤醒（cron 或事件）时运行
 */
export async function think(trigger: 'cron' | 'manual' | 'event' = 'cron'): Promise<BrainCycleResult> {
  const startTime = Date.now()
  const snapshot = await Snapshot.create({ runAt: new Date(), triggeredBy: trigger, status: 'running' })
  const result: BrainCycleResult = {
    snapshotId: snapshot._id.toString(),
    phase: '', events: [], reflections: [], actions: [], summary: '', durationMs: 0,
  }

  try {
    // ==================== Phase 1: 监控感知（全量） ====================
    result.phase = 'perception'
    log.info('[Brain] Phase 1: Monitor perceiving...')
    const monitorData = await monitor()
    
    // 提取异常事件
    const events: AgentEvent[] = []
    for (const c of monitorData.campaigns) {
      for (const a of c.anomalies) {
        if (a.type === 'spend_spike') events.push({ type: 'spend_spike', campaignId: c.id, campaignName: c.name, accountId: '', currentRate: c.estimatedDailySpend / 24, normalRate: 0, ratio: a.severity })
        if (a.type === 'roas_crash') events.push({ type: 'roas_crash', campaignId: c.id, campaignName: c.name, accountId: '', before: 0, after: c.roi, dropPct: a.severity * 20 })
        if (a.type === 'zero_conversion') events.push({ type: 'zero_conversion', campaignId: c.id, campaignName: c.name, accountId: '', spend: c.spend, hours: dayjs().hour() })
      }
    }
    result.events = events

    // 全量 campaign 映射
    const allCampaigns: CampaignMetrics[] = monitorData.campaigns.map(c => ({
      campaignId: c.id, campaignName: c.name, accountId: '', accountName: '',
      platform: c.platform, optimizer: c.optimizer, pkgName: c.pkgName,
      todaySpend: c.spend,
      todayRevenue: c.revenue > 0 ? c.revenue : c.spend * (c.adjustedRoi || c.firstDayRoi || c.roi || 0),
      todayRoas: c.adjustedRoi || c.firstDayRoi || c.roi || 0,
      todayImpressions: 0, todayClicks: 0, todayConversions: c.installs,
      yesterdaySpend: 0, yesterdayRoas: 0, dayBeforeSpend: 0, dayBeforeRoas: 0,
      spendTrend: c.trendSlope * 100, roasTrend: c.trendSlope * 100,
      totalSpend3d: c.spend,
      totalRevenue3d: c.revenue > 0 ? c.revenue : c.spend * (c.adjustedRoi || c.firstDayRoi || c.roi || 0),
      avgRoas3d: c.adjustedRoi || c.firstDayRoi || c.roi || 0,
      estimatedDailySpend: c.estimatedDailySpend, spendPerHour: c.estimatedDailySpend / 24,
      installs: c.installs, cpi: c.cpi, cpa: 0, firstDayRoi: c.firstDayRoi,
      adjustedRoi: c.adjustedRoi, day3Roi: c.day3Roi, day7Roi: 0, payRate: c.payRate, arpu: c.arpu,
      trendSummary: c.trendSummary || '',
      dailyData: [],
    }))

    // ==================== 大盘锚定值（全量计算） ====================
    const benchmarks = computeBenchmarks(allCampaigns)
    log.info(`[Brain] Benchmarks: ${benchmarks.totalCampaigns} campaigns, $${benchmarks.totalSpend} spend, weighted ROAS ${benchmarks.weightedRoas}, ROI P25/P50/P75: ${benchmarks.p25Roi}/${benchmarks.medianRoi}/${benchmarks.p75Roi}`)

    // ==================== 权责过滤：只把自己能操作的 campaign 送入决策 ====================
    const scopedCampaigns = allCampaigns.filter(c => canOperate({ pkgName: c.pkgName, optimizer: c.optimizer }))
    const campaignMap = new Map(allCampaigns.map(c => [c.campaignId, c]))
    log.info(`[Brain] Scope filter: ${allCampaigns.length} total → ${scopedCampaigns.length} in scope`)

    // ==================== Phase 2: 反思 ====================
    result.phase = 'reflection'
    log.info('[Brain] Phase 2: Reflecting on past decisions...')
    const reflections = await reflectAll(campaignMap)
    result.reflections = reflections

    if (reflections.length > 0) {
      const stats = await getReflectionStats(7)
      log.info(`[Brain] Reflection: ${reflections.length} decisions reviewed. 7d accuracy: ${stats.accuracy}%`)
      await memory.rememberShort('decision', `reflection_${dayjs().format('YYYYMMDD_HH')}`, {
        summary: `反思 ${reflections.length} 个决策: ${reflections.filter(r => r.assessment === 'correct').length} 正确, ${reflections.filter(r => r.assessment === 'wrong').length} 错误`,
        stats,
      })
    }

    // ==================== Phase 3: 紧急事件处理（仅限权责范围） ====================
    result.phase = 'planning'
    log.info('[Brain] Phase 3: Planning...')

    const criticalEvents = events.filter(e => getEventPriority(e) === 'critical')
    const highEvents = events.filter(e => getEventPriority(e) === 'high')

    const allPending = await Action.find({ status: 'pending' }).select('entityId type').lean()
    const pendingSet = new Set(allPending.map((a: any) => `${a.entityId}:${a.type}`))

    if (criticalEvents.length > 0) {
      log.info(`[Brain] ${criticalEvents.length} CRITICAL events: ${criticalEvents.map(describeEvent).join('; ')}`)
      for (const event of criticalEvents) {
        if (event.type === 'spend_spike' || event.type === 'roas_crash') {
          const c = campaignMap.get(event.campaignId)
          if (!canOperate({ pkgName: c?.pkgName, optimizer: c?.optimizer })) continue
          if (pendingSet.has(`${event.campaignId}:pause`)) continue
          pendingSet.add(`${event.campaignId}:pause`)
          await Action.create({
            type: 'pause', platform: 'facebook', accountId: '',
            entityId: event.campaignId, entityName: event.campaignName,
            params: { source: 'brain_urgent', level: 'campaign', priority: 'critical' },
            reason: `[紧急] ${describeEvent(event)}`, status: 'pending',
          })
          result.actions.push({ type: 'pause', campaignId: event.campaignId, campaignName: event.campaignName, reason: describeEvent(event), executed: false })
        }
      }
    }

    for (const event of highEvents) {
      if (event.type === 'zero_conversion') {
        const c = campaignMap.get(event.campaignId)
        if (!canOperate({ pkgName: c?.pkgName, optimizer: c?.optimizer })) continue
        if (pendingSet.has(`${event.campaignId}:pause`)) continue
        pendingSet.add(`${event.campaignId}:pause`)
        await Action.create({
          type: 'pause', platform: 'facebook', accountId: '',
          entityId: event.campaignId, entityName: event.campaignName,
          params: { source: 'brain_high', level: 'campaign', priority: 'high' },
          reason: `[高优] ${describeEvent(event)}`, status: 'pending',
        })
        result.actions.push({ type: 'pause', campaignId: event.campaignId, campaignName: event.campaignName, reason: describeEvent(event), executed: false })
      }
    }

    // ==================== Phase 4: 权责范围内精准决策（带大盘锚定值） ====================
    result.phase = 'decision'
    log.info(`[Brain] Phase 4: Analyzing ${scopedCampaigns.length} in-scope campaigns (with benchmarks)...`)

    // 只分类权责范围内的 campaign
    const classified = await classifyCampaigns(scopedCampaigns)
    const classSummary = classifySummary(classified)

    // LLM 决策：只处理权责范围内的，附带大盘锚定值
    const decisions = await makeDecisions(classified, benchmarks)

    // 过滤掉已经在紧急事件中处理过的
    const executedIds = new Set(result.actions.map(a => a.campaignId))
    const remainingActions = decisions.actions.filter(a => !executedIds.has(a.campaignId))

    // ==================== Phase 5: 执行（已经是 scope 内，不需要再过滤） ====================
    result.phase = 'execution'
    log.info(`[Brain] Phase 5: Executing ${remainingActions.length} actions...`)

    const existingPending = await Action.find({ status: 'pending' }).select('entityId type').lean()
    const pendingKeys = new Set(existingPending.map((a: any) => `${a.entityId}:${a.type}`))

    let skippedDuplicate = 0
    for (const action of remainingActions) {
      const key = `${action.campaignId}:${action.type === 'increase_budget' ? 'adjust_budget' : action.type}`
      if (pendingKeys.has(key)) {
        skippedDuplicate++
        continue
      }
      pendingKeys.add(key)
      const c = scopedCampaigns.find(x => x.campaignId === action.campaignId)
      await Action.create({
        type: action.type === 'increase_budget' ? 'adjust_budget' : action.type,
        platform: 'facebook',
        accountId: '',
        entityId: action.campaignId,
        entityName: action.campaignName,
        params: {
          source: 'brain',
          priority: action.auto ? 'high' : 'normal',
          currentBudget: action.currentBudget,
          newBudget: action.newBudget,
          level: 'campaign',
          roasAtDecision: c?.todayRoas,
          spendAtDecision: c?.todaySpend,
        },
        reason: action.auto ? `[建议立即] ${action.reason}` : action.reason,
        status: 'pending',
      })
      result.actions.push({ ...action, executed: false })
    }

    // ==================== Phase 6: 记录 ====================
    result.phase = 'recording'
    const totalSpend = allCampaigns.reduce((s, c) => s + c.todaySpend, 0)
    const totalRevenue = allCampaigns.reduce((s, c) => s + c.todayRevenue, 0)
    const scopedSpend = scopedCampaigns.reduce((s, c) => s + c.todaySpend, 0)

    const pendingApproval = result.actions.filter(a => !a.executed)

    if (skippedDuplicate > 0) log.info(`[Brain] Skipped ${skippedDuplicate} (duplicate pending)`)

    result.summary = [
      `扫描 ${allCampaigns.length} 个 campaign`,
      `总花费 $${Math.round(totalSpend)} | ROAS ${benchmarks.weightedRoas}`,
      `权责范围: ${scopedCampaigns.length} 个 (花费 $${Math.round(scopedSpend)})`,
      `检测 ${events.length} 个事件 (${criticalEvents.length} 紧急)`,
      `反思 ${reflections.length} 个历史决策`,
      `${pendingApproval.length} 个待审批`,
      classSummary ? `分类: 严重亏损${classSummary.loss_severe || 0} 轻微亏损${classSummary.loss_mild || 0} 高潜力${classSummary.high_potential || 0} 稳定${(classSummary.stable_good || 0) + (classSummary.stable_normal || 0)} 观察${classSummary.observing || 0}` : '',
    ].filter(Boolean).join(' | ')

    result.durationMs = Date.now() - startTime

    await Snapshot.updateOne({ _id: snapshot._id }, {
      totalCampaigns: allCampaigns.length,
      classification: classSummary,
      totalSpend: Math.round(totalSpend),
      totalRevenue: Math.round(totalRevenue),
      overallRoas: benchmarks.weightedRoas,
      actions: result.actions,
      summary: result.summary,
      alerts: decisions.alerts,
      durationMs: result.durationMs,
      status: 'completed',
    })

    await memory.rememberShort('decision', `cycle_${dayjs().format('YYYYMMDD_HH')}`, {
      summary: result.summary,
      actionCount: result.actions.length,
      eventCount: events.length,
    })

    const focusItems = [
      ...criticalEvents.map(e => describeEvent(e)),
      ...pendingApproval.map(a => `待审批: ${a.reason}`),
    ].slice(0, 5)
    await memory.setFocus(focusItems)

    log.info(`[Brain] Cycle complete: ${result.summary} (${result.durationMs}ms)`)
    result.phase = 'completed'
    return result
  } catch (err: any) {
    log.error(`[Brain] Failed at phase ${result.phase}:`, err.message)
    await Snapshot.updateOne({ _id: snapshot._id }, {
      status: 'failed', error: err.message, durationMs: Date.now() - startTime,
    })
    result.summary = `失败: ${err.message}`
    result.durationMs = Date.now() - startTime
    return result
  }
}

/**
 * 带重试的操作执行
 */
async function executeWithRetry(action: DecisionAction, maxRetries = 3): Promise<any> {
  if (!getTopTouToken()) {
    return { ...action, executed: false, error: 'TopTou token not set' }
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      let result: any
      if (action.type === 'pause') {
        result = await toptouApi.updateStatus({
          level: 'campaign',
          list: [{ id: action.campaignId, accountId: action.accountId, status: 'PAUSED' }],
        })
      } else if (action.type === 'increase_budget' && action.newBudget) {
        result = await toptouApi.updateNameOrBudget({
          level: 'campaign', id: action.campaignId,
          accountId: action.accountId, daily_budget: action.newBudget,
        })
      } else if (action.type === 'resume') {
        result = await toptouApi.updateStatus({
          level: 'campaign',
          list: [{ id: action.campaignId, accountId: action.accountId, status: 'ACTIVE' }],
        })
      }

      await Action.create({
        type: action.type === 'increase_budget' ? 'adjust_budget' : action.type,
        platform: 'facebook',
        accountId: action.accountId,
        entityId: action.campaignId,
        entityName: action.campaignName,
        params: { source: 'brain_auto', attempt, ...action },
        reason: action.reason,
        status: 'executed',
        result,
        executedAt: new Date(),
      })

      return { ...action, executed: true, attempt, result }
    } catch (err: any) {
      log.warn(`[Brain] Execute attempt ${attempt}/${maxRetries} failed for ${action.campaignId}: ${err.message}`)
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 30000 * attempt))
      } else {
        return { ...action, executed: false, error: `Failed after ${maxRetries} attempts: ${err.message}` }
      }
    }
  }
}
