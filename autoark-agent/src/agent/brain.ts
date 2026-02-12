/**
 * Agent Brain - 动态规划中枢
 * 
 * 不是固定 pipeline，而是自主决定做什么：
 * 1. 感知环境 → 生成事件
 * 2. 查看记忆 → 有没有待办任务、待复盘决策
 * 3. 根据事件优先级 → 决定做什么
 * 4. 执行 → 带重试和纠错
 * 5. 记录 → 存记忆，设置后续提醒
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
    // ==================== Phase 1: 监控感知 ====================
    result.phase = 'perception'
    log.info('[Brain] Phase 1: Monitor perceiving...')
    const monitorData = await monitor()
    
    // 从 DecisionReadyData 中提取事件（异常即事件）
    const events: AgentEvent[] = []
    for (const c of monitorData.campaigns) {
      for (const a of c.anomalies) {
        if (a.type === 'spend_spike') events.push({ type: 'spend_spike', campaignId: c.id, campaignName: c.name, accountId: '', currentRate: c.estimatedDailySpend / 24, normalRate: 0, ratio: a.severity })
        if (a.type === 'roas_crash') events.push({ type: 'roas_crash', campaignId: c.id, campaignName: c.name, accountId: '', before: 0, after: c.roi, dropPct: a.severity * 20 })
        if (a.type === 'zero_conversion') events.push({ type: 'zero_conversion', campaignId: c.id, campaignName: c.name, accountId: '', spend: c.spend, hours: dayjs().hour() })
      }
    }
    result.events = events

    // 兼容旧格式：构建 campaigns 和 campaignMap
    const campaigns: CampaignMetrics[] = monitorData.campaigns.map(c => ({
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
    const campaignMap = new Map(campaigns.map(c => [c.campaignId, c]))

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

    // ==================== Phase 3: 规划（动态决定做什么）====================
    result.phase = 'planning'
    log.info('[Brain] Phase 3: Planning...')

    const criticalEvents = events.filter(e => getEventPriority(e) === 'critical')
    const highEvents = events.filter(e => getEventPriority(e) === 'high')

    // 加载已有 pending 用于去重
    const allPending = await Action.find({ status: 'pending' }).select('entityId type').lean()
    const pendingSet = new Set(allPending.map((a: any) => `${a.entityId}:${a.type}`))

    // 紧急事件 → 走审批（仅限权责范围内）
    if (criticalEvents.length > 0) {
      log.info(`[Brain] ${criticalEvents.length} CRITICAL events: ${criticalEvents.map(describeEvent).join('; ')}`)
      for (const event of criticalEvents) {
        if (event.type === 'spend_spike' || event.type === 'roas_crash') {
          const c = campaignMap.get(event.campaignId)
          if (!canOperate({ accountId: event.accountId, pkgName: c?.pkgName, optimizer: c?.optimizer })) continue
          if (pendingSet.has(`${event.campaignId}:pause`)) continue
          pendingSet.add(`${event.campaignId}:pause`)
          await Action.create({
            type: 'pause', platform: 'facebook', accountId: event.accountId,
            entityId: event.campaignId, entityName: event.campaignName,
            params: { source: 'brain_urgent', level: 'campaign', priority: 'critical' },
            reason: `[紧急] ${describeEvent(event)}`, status: 'pending',
          })
          result.actions.push({ type: 'pause', campaignId: event.campaignId, campaignName: event.campaignName, reason: describeEvent(event), executed: false })
        }
      }
    }

    // 高优先级事件 → 走审批（仅限权责范围内）
    for (const event of highEvents) {
      if (event.type === 'zero_conversion') {
        const c = campaignMap.get(event.campaignId)
        if (!canOperate({ accountId: event.accountId, pkgName: c?.pkgName, optimizer: c?.optimizer })) continue
        if (pendingSet.has(`${event.campaignId}:pause`)) continue
        pendingSet.add(`${event.campaignId}:pause`)
        await Action.create({
          type: 'pause', platform: 'facebook', accountId: event.accountId,
          entityId: event.campaignId, entityName: event.campaignName,
          params: { source: 'brain_high', level: 'campaign', priority: 'high' },
          reason: `[高优] ${describeEvent(event)}`, status: 'pending',
        })
        result.actions.push({ type: 'pause', campaignId: event.campaignId, campaignName: event.campaignName, reason: describeEvent(event), executed: false })
      }
    }

    // ==================== Phase 4: 全量分析决策 ====================
    result.phase = 'decision'
    log.info('[Brain] Phase 4: Analyzing all campaigns...')

    const classified = await classifyCampaigns(campaigns)
    const classSummary = classifySummary(classified)

    // LLM 决策（monitor 的环境上下文会通过 context.ts 自动注入）
    const decisions = await makeDecisions(classified)

    // 过滤掉已经在紧急事件中处理过的
    const executedIds = new Set(result.actions.map(a => a.campaignId))
    const remainingActions = decisions.actions.filter(a => !executedIds.has(a.campaignId))

    // ==================== Phase 5: 执行 ====================
    result.phase = 'execution'
    log.info(`[Brain] Phase 5: Executing ${remainingActions.length} actions...`)

    // 去重：不重复生成已有的 pending 操作
    const existingPending = await Action.find({ status: 'pending' }).select('entityId type').lean()
    const pendingKeys = new Set(existingPending.map((a: any) => `${a.entityId}:${a.type}`))

    let skippedOutOfScope = 0
    let skippedDuplicate = 0
    for (const action of remainingActions) {
      const c = campaigns.find(x => x.campaignId === action.campaignId)
      if (!canOperate({ accountId: action.accountId, pkgName: c?.pkgName, optimizer: c?.optimizer })) {
        skippedOutOfScope++
        continue
      }
      // 已有相同 pending 的跳过
      const key = `${action.campaignId}:${action.type === 'increase_budget' ? 'adjust_budget' : action.type}`
      if (pendingKeys.has(key)) {
        skippedDuplicate++
        continue
      }
      pendingKeys.add(key)
      await Action.create({
        type: action.type === 'increase_budget' ? 'adjust_budget' : action.type,
        platform: 'facebook',
        accountId: action.accountId,
        entityId: action.campaignId,
        entityName: action.campaignName,
        params: {
          source: 'brain',
          priority: action.auto ? 'high' : 'normal',
          currentBudget: action.currentBudget,
          newBudget: action.newBudget,
          level: 'campaign',
          roasAtDecision: campaigns.find(c => c.campaignId === action.campaignId)?.todayRoas,
          spendAtDecision: campaigns.find(c => c.campaignId === action.campaignId)?.todaySpend,
        },
        reason: action.auto ? `[建议立即] ${action.reason}` : action.reason,
        status: 'pending',
      })
      result.actions.push({ ...action, executed: false })
    }

    // ==================== Phase 6: 记录 ====================
    result.phase = 'recording'
    const totalSpend = campaigns.reduce((s, c) => s + c.todaySpend, 0)
    const totalRevenue = campaigns.reduce((s, c) => s + c.todayRevenue, 0)

    const autoExecuted = result.actions.filter(a => a.executed)
    const pendingApproval = result.actions.filter(a => !a.executed)

    if (skippedOutOfScope > 0) log.info(`[Brain] Skipped ${skippedOutOfScope} (out of scope)`)
    if (skippedDuplicate > 0) log.info(`[Brain] Skipped ${skippedDuplicate} (duplicate pending)`)

    result.summary = [
      `扫描 ${campaigns.length} 个 campaign`,
      `总花费 $${Math.round(totalSpend)} | ROAS ${totalSpend > 0 ? (totalRevenue / totalSpend).toFixed(2) : 0}`,
      `检测 ${events.length} 个事件 (${criticalEvents.length} 紧急)`,
      `反思 ${reflections.length} 个历史决策`,
      `自动执行 ${autoExecuted.length} 个操作 | ${pendingApproval.length} 个待审批`,
      classSummary ? `分类: 严重亏损${classSummary.loss_severe || 0} 轻微亏损${classSummary.loss_mild || 0} 高潜力${classSummary.high_potential || 0} 稳定${(classSummary.stable_good || 0) + (classSummary.stable_normal || 0)} 观察${classSummary.observing || 0}` : '',
    ].filter(Boolean).join(' | ')

    result.durationMs = Date.now() - startTime

    await Snapshot.updateOne({ _id: snapshot._id }, {
      totalCampaigns: campaigns.length,
      classification: classSummary,
      totalSpend: Math.round(totalSpend),
      totalRevenue: Math.round(totalRevenue),
      overallRoas: totalSpend > 0 ? Number((totalRevenue / totalSpend).toFixed(2)) : 0,
      actions: result.actions,
      summary: result.summary,
      alerts: decisions.alerts,
      durationMs: result.durationMs,
      status: 'completed',
    })

    // 存入短期记忆
    await memory.rememberShort('decision', `cycle_${dayjs().format('YYYYMMDD_HH')}`, {
      summary: result.summary,
      actionCount: result.actions.length,
      eventCount: events.length,
    })

    // 更新注意力焦点
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

      // 记录到 Action 表
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
        await new Promise(r => setTimeout(r, 30000 * attempt)) // 30s, 60s, 90s
      } else {
        return { ...action, executed: false, error: `Failed after ${maxRetries} attempts: ${err.message}` }
      }
    }
  }
}
