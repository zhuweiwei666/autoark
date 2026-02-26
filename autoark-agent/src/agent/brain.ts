/**
 * Agent Brain — 多 Agent 协调者
 *
 * Phase 0: Corrective → 读取 Auditor 纠正指令（优先处理）
 * Phase 1: Monitor    → 感知全量数据
 * Phase 2: Screener   → Skill 驱动筛选，输出 needs_decision 列表
 * Phase 3: Classifier → 对筛选出的 campaign 分类打标
 * Phase 4: Decision   → Skill 驱动 + LLM 决策，输出 actions
 * Phase 5: Executor   → auto 直接执行 / pending 待审批
 * Phase 6: Feishu     → 飞书通知
 * Phase 7: Auditor    → 审查 + Librarian 知识沉淀
 */
import dayjs from 'dayjs'
import { log } from '../platform/logger'
import { monitor } from './monitor'
import { classifyCampaigns, classifySummary } from './classifier'
import { makeDecisions, DecisionAction } from './decision'
import { reflectAll, getReflectionStats } from './reflection'
import { screenCampaigns, ScreeningSummary } from './screener'
import { popCorrective } from './auditor'
import { processAuditFindings } from './librarian'
import { memory } from './memory.service'
import { AgentEvent, getEventPriority, describeEvent } from './events'
import { CampaignMetrics } from './analyzer'
import { Snapshot } from '../data/snapshot.model'
import { Action } from '../action/action.model'
import * as toptouApi from '../platform/toptou/api'
import { getTopTouToken } from '../platform/toptou/client'
import { notifyFeishu } from '../platform/feishu/feishu.service'
import { getAgentConfig } from './agent-config.model'
import { buildUnifiedCampaignSnapshot } from './data-fusion'
import { appendTraceStep, createDecisionTrace, DecisionTrace } from './collab/types'
import { pushExperienceToPython } from './bridge/python-bridge'
import { evaluateGlobalGuardrail } from './governor'

export interface MarketBenchmark {
  totalCampaigns: number
  totalSpend: number
  weightedRoas: number
  avgCpi: number
  avgAdjustedRoi: number
  medianRoi: number
  p25Roi: number
  p75Roi: number
  avgPayRate: number
  byPlatform: Record<string, { count: number; avgRoi: number; avgCpi: number; totalSpend: number }>
}

export interface BrainCycleResult {
  snapshotId: string
  phase: string
  events: AgentEvent[]
  reflections: any[]
  actions: any[]
  screening?: ScreeningSummary
  decisionTrace?: DecisionTrace
  summary: string
  durationMs: number
}

function computeBenchmarks(campaigns: CampaignMetrics[]): MarketBenchmark {
  const withSpend = campaigns.filter(c => c.todaySpend > 10)
  const totalSpend = withSpend.reduce((s, c) => s + c.todaySpend, 0)

  const weightedRoas = totalSpend > 0
    ? withSpend.reduce((s, c) => s + c.todayRoas * c.todaySpend, 0) / totalSpend
    : 0

  const rois = withSpend.map(c => c.todayRoas).filter(r => r > 0).sort((a, b) => a - b)
  const pct = (arr: number[], p: number) => arr.length > 0 ? arr[Math.floor(arr.length * p)] || 0 : 0

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
 * Agent 思考循环
 */
export async function think(trigger: 'cron' | 'manual' | 'event' = 'cron'): Promise<BrainCycleResult> {
  const startTime = Date.now()
  const snapshot = await Snapshot.create({ runAt: new Date(), triggeredBy: trigger, status: 'running' })
  const result: BrainCycleResult = {
    snapshotId: snapshot._id.toString(),
    phase: '', events: [], reflections: [], actions: [], summary: '', durationMs: 0,
  }
  const decisionTrace = createDecisionTrace(result.snapshotId, trigger)
  result.decisionTrace = decisionTrace

  try {
    // ==================== Phase 0: Corrective 纠正指令 ====================
    result.phase = 'corrective'
    const corrective = await popCorrective()
    if (corrective.length > 0) {
      log.info(`[Brain] Phase 0: ${corrective.length} corrective actions from Auditor: ${corrective.map(c => `${c.action}:${c.campaignId}`).join(', ')}`)
    }
    appendTraceStep(decisionTrace, {
      agentId: 'agent5_skill_kb',
      title: 'Agent5 纠正输入',
      conclusion: corrective.length > 0 ? `收到 ${corrective.length} 条纠正指令并优先处理` : '本轮无纠正指令',
      confidence: 0.9,
      evidence: [`corrective_count=${corrective.length}`],
      details: corrective.slice(0, 3).map(c => `${c.action}:${c.campaignId}`),
    })

    // ==================== Phase 1: Monitor 感知 ====================
    result.phase = 'perception'
    log.info('[Brain] Phase 1: Monitor perceiving...')
    const monitorData = await monitor()

    const events: AgentEvent[] = []
    for (const c of monitorData.campaigns) {
      for (const a of c.anomalies) {
        if (a.type === 'spend_spike') events.push({ type: 'spend_spike', campaignId: c.id, campaignName: c.name, accountId: c.accountId || '', currentRate: c.estimatedDailySpend / 24, normalRate: 0, ratio: a.severity })
        if (a.type === 'roas_crash') events.push({ type: 'roas_crash', campaignId: c.id, campaignName: c.name, accountId: c.accountId || '', before: 0, after: c.roi, dropPct: a.severity * 20 })
        if (a.type === 'zero_conversion') events.push({ type: 'zero_conversion', campaignId: c.id, campaignName: c.name, accountId: c.accountId || '', spend: c.spend, hours: dayjs().hour() })
      }
    }
    result.events = events

    let allCampaigns: CampaignMetrics[] = monitorData.campaigns.map(c => ({
      campaignId: c.id, campaignName: c.name, accountId: c.accountId || '', accountName: '',
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
    const unifiedSnapshot = buildUnifiedCampaignSnapshot(allCampaigns, result.snapshotId)
    allCampaigns = unifiedSnapshot.campaigns

    const benchmarks = computeBenchmarks(allCampaigns)
    log.info(`[Brain] Benchmarks: ${benchmarks.totalCampaigns} campaigns, $${benchmarks.totalSpend} spend, weighted ROAS ${benchmarks.weightedRoas}, ROI P25/P50/P75: ${benchmarks.p25Roi}/${benchmarks.medianRoi}/${benchmarks.p75Roi}`)
    appendTraceStep(decisionTrace, {
      agentId: 'agent1_data_fusion',
      title: 'Agent1 多源融合',
      conclusion: `输出 ${allCampaigns.length} 条可信快照，质量分 ${unifiedSnapshot.qualityScore}`,
      confidence: unifiedSnapshot.qualityScore,
      evidence: [
        `source_priority=${unifiedSnapshot.sourcePriority}`,
        `conflict_count=${unifiedSnapshot.conflictFlags.length}`,
        `weighted_roas=${benchmarks.weightedRoas}`,
      ],
      details: unifiedSnapshot.conflictFlags.length > 0 ? unifiedSnapshot.conflictFlags : ['未检测到显著跨源冲突'],
    })

    // ==================== Phase 2: Screener 筛选 ====================
    result.phase = 'screening'
    log.info('[Brain] Phase 2: Screener filtering...')

    const pendingIds = new Set(
      (await Action.find({ status: 'pending' }).select('entityId').lean())
        .map((a: any) => a.entityId).filter(Boolean)
    )

    const screening = await screenCampaigns(allCampaigns, {
      benchmarks,
      pendingActionIds: pendingIds,
    })
    result.screening = screening

    const screenedCampaigns = screening.results
      .filter(r => r.verdict === 'needs_decision')
      .map(r => allCampaigns.find(c => c.campaignId === r.campaignId)!)
      .filter(Boolean)

    const campaignMap = new Map(allCampaigns.map(c => [c.campaignId, c]))

    // ==================== Phase 3: Classifier 分类 ====================
    result.phase = 'classification'
    log.info(`[Brain] Phase 3: Classifying ${screenedCampaigns.length} screened campaigns...`)
    const classified = await classifyCampaigns(screenedCampaigns)
    const classSummary = classifySummary(classified)

    // ==================== Phase 4: Decision 决策 ====================
    result.phase = 'decision'
    log.info(`[Brain] Phase 4: Decision on ${classified.length} campaigns...`)
    const decisions = await makeDecisions(classified, benchmarks)
    if (unifiedSnapshot.dataRisk) {
      decisions.actions = decisions.actions.filter((a: any) => a.type === 'pause')
      decisions.reasoningSteps = [
        `数据风险触发（quality=${unifiedSnapshot.qualityScore}），决策降级为止损优先`,
        ...(decisions.reasoningSteps || []),
      ]
    }
    appendTraceStep(decisionTrace, {
      agentId: 'agent2_decision',
      title: 'Agent2 分析与决策',
      conclusion: `完成 ${classified.length} 个 campaign 分析，产出 ${decisions.actions.length} 条动作建议`,
      confidence: classified.length > 0 ? 0.82 : 0.7,
      evidence: [
        `screening_needs_decision=${screening.needsDecision}`,
        `classified_count=${classified.length}`,
        `decision_actions=${decisions.actions.length}`,
      ],
      details: [
        ...(decisions.reasoningSteps || []),
        ...((decisions.candidateActions || []).slice(0, 3).map((c: any) => `候选:${c.action}:${c.campaignName || c.campaignId}|conf=${c.confidence}`)),
      ],
    })

    // ==================== Phase 5: Executor（auto 直接执行 / 非 auto 存 pending 待审批）====================
    result.phase = 'execution'
    log.info(`[Brain] Phase 5: Executing ${decisions.actions.length} actions...`)

    // 加载 AI 接管配置：哪些优化师的广告全权自动执行
    const executorConfig = await getAgentConfig('executor')
    const autoOptimizers = new Set<string>(
      (executorConfig?.executor?.scope?.optimizers || []).map((o: string) => o.toLowerCase())
    )
    if (autoOptimizers.size > 0) {
      log.info(`[Executor] AI auto-managed optimizers: ${[...autoOptimizers].join(', ')}`)
    }

    const existingPending = await Action.find({ status: 'pending' }).select('entityId type').lean()
    const pendingKeys = new Set(existingPending.map((a: any) => `${a.entityId}:${a.type}`))

    let skippedDuplicate = 0
    let autoExecuted = 0
    let pendingCreated = 0
    let skippedByGovernor = 0

    for (const action of decisions.actions) {
      try {
        if (!action?.campaignId || !action?.type) continue
        // ROAS 硬约束：低于阈值时禁止放量类动作
        if (benchmarks.weightedRoas < 0.8 && (action.type === 'increase_budget' || action.type === 'resume')) {
          skippedByGovernor++
          result.actions.push({
            ...action,
            executed: false,
            finalStatus: 'governor_blocked',
            routeReason: 'roas_hard_guardrail_block',
            retryTrace: [],
            latencyMs: 0,
          })
          continue
        }
        const dbType = action.type === 'increase_budget' ? 'adjust_budget' : action.type
        const key = `${action.campaignId}:${dbType}`
        if (pendingKeys.has(key)) { skippedDuplicate++; continue }
        pendingKeys.add(key)

        // 检查是否属于 AI 接管的优化师
        const c = screenedCampaigns.find(x => x.campaignId === action.campaignId)
        const optimizer = (action.campaignName || '').split('_')[0]?.toLowerCase() || ''
        const isAutoManaged = autoOptimizers.has(optimizer)
        const isAuto = action.auto || isAutoManaged

        const actionDoc = await Action.create({
          type: dbType,
          platform: 'facebook', accountId: action.accountId || '',
          entityId: action.campaignId, entityName: action.campaignName || '',
          params: {
            source: 'brain', priority: isAuto ? 'high' : 'normal',
            currentBudget: action.currentBudget, newBudget: action.newBudget,
            level: 'campaign',
            roasAtDecision: c?.todayRoas, spendAtDecision: c?.todaySpend,
            skillName: action.skillName,
            autoManaged: isAutoManaged || undefined,
          },
          reason: action.reason + (isAutoManaged ? ` [AI接管: ${optimizer}]` : ''),
          status: isAuto ? 'approved' : 'pending',
        })

        if (isAuto) {
          const execResult = await executeWithRetry(action)
          if (execResult?.executed) {
            await Action.updateOne({ _id: actionDoc._id }, { $set: { status: 'executed', executedAt: new Date(), result: execResult.result } })
            log.info(`[Executor] Auto-executed: ${action.type} ${action.campaignName} (${action.skillName || 'rule'})${isAutoManaged ? ' [AI接管]' : ''}`)
            result.actions.push({
              ...action,
              auto: true,
              executed: true,
              via: execResult?.via || 'facebook_api',
              routeReason: execResult?.routeReason || '',
              retryTrace: execResult?.retryTrace || [],
              latencyMs: execResult?.latencyMs || 0,
              finalStatus: execResult?.finalStatus || 'executed',
            })
            autoExecuted++
          } else {
            await Action.updateOne({ _id: actionDoc._id }, { $set: { status: 'failed', result: { error: execResult?.error } } })
            log.warn(`[Executor] Auto-execute failed: ${action.campaignName} - ${execResult?.error}`)
            result.actions.push({
              ...action,
              executed: false,
              via: execResult?.via || 'unknown',
              routeReason: execResult?.routeReason || '',
              retryTrace: execResult?.retryTrace || [],
              latencyMs: execResult?.latencyMs || 0,
              finalStatus: execResult?.finalStatus || 'failed',
            })
          }
        } else {
          result.actions.push({
            ...action,
            executed: false,
            finalStatus: 'pending',
            routeReason: 'awaiting_manual_approval',
            retryTrace: [],
            latencyMs: 0,
          })
          pendingCreated++
        }
      } catch (actionErr: any) {
        log.warn(`[Brain] Failed to process action for ${action?.campaignId}: ${actionErr.message}`)
      }
    }

    if (skippedDuplicate > 0) log.info(`[Brain] Skipped ${skippedDuplicate} duplicate pending`)
    if (autoExecuted > 0) log.info(`[Brain] Auto-executed: ${autoExecuted} actions`)
    if (pendingCreated > 0) log.info(`[Brain] Pending approval: ${pendingCreated} actions`)
    if (skippedByGovernor > 0) log.info(`[Brain] Governor blocked ${skippedByGovernor} risky scaling actions`)
    appendTraceStep(decisionTrace, {
      agentId: 'agent3_executor',
      title: 'Agent3 执行路由',
      conclusion: `执行完成：自动 ${autoExecuted}，待审批 ${pendingCreated}，去重跳过 ${skippedDuplicate}`,
      confidence: result.actions.length > 0 ? 0.85 : 0.78,
      evidence: [
        `actions_total=${result.actions.length}`,
        `auto_executed=${autoExecuted}`,
        `pending_created=${pendingCreated}`,
        `governor_blocked=${skippedByGovernor}`,
      ],
      details: result.actions.slice(0, 5).map((a: any) => {
        const route = a.via ? `via=${a.via}` : 'via=pending'
        return `${a.type}:${a.campaignName || a.campaignId}:${a.finalStatus || (a.executed ? 'executed' : 'pending')}|${route}|reason=${a.routeReason || ''}`
      }),
    })
    const governorDecision = evaluateGlobalGuardrail(benchmarks, result.actions, screening)
    appendTraceStep(decisionTrace, {
      agentId: 'agent4_governor',
      title: 'Agent4 全局治理',
      conclusion: governorDecision.summary,
      confidence: governorDecision.riskLevel === 'high' ? 0.88 : 0.76,
      evidence: [
        `roas=${benchmarks.weightedRoas}`,
        `risk=${governorDecision.riskLevel}`,
        `override_count=${governorDecision.overrides.length}`,
      ],
      details: governorDecision.overrides.length > 0 ? governorDecision.overrides : ['本轮无需全局覆盖指令'],
    })

    // ==================== Phase 6: Feishu 飞书通知 ====================
    result.phase = 'notification'
    log.info('[Brain] Phase 6: Feishu notification...')
    try {
      const allSpend = allCampaigns.reduce((s, c) => s + c.todaySpend, 0)
      await notifyFeishu({
        screening,
        actions: result.actions,
        events,
        benchmarks: { ...benchmarks, totalSpend: Math.round(allSpend) },
        summary: '',
        classSummary,
        screenedCampaigns,
        decisionTrace,
        fusionSummary: {
          qualityScore: unifiedSnapshot.qualityScore,
          dataRisk: unifiedSnapshot.dataRisk,
          conflictFlags: unifiedSnapshot.conflictFlags,
          freshness: unifiedSnapshot.freshness,
        },
        governorSummary: governorDecision,
      })
    } catch (e: any) {
      log.warn(`[Brain] Feishu notification failed: ${e.message}`)
    }

    // ==================== Phase 7: Auditor 审查 + Librarian 知识沉淀 ====================
    result.phase = 'audit'
    log.info('[Brain] Phase 7: Auditor reviewing + Librarian learning...')

    // 7a. Reflection（复用改进后的反思，传入 allCampaigns 用于兄弟比较）
    const reflections = await reflectAll(campaignMap, allCampaigns)
    result.reflections = reflections
    if (reflections.length > 0) {
      const stats = await getReflectionStats(7)
      log.info(`[Brain] Reflection: ${reflections.length} reviewed, ${stats.correct} correct, ${stats.wrong} wrong, accuracy ${stats.accuracy}%`)

      // 7b. 将反思结果交给 Librarian 沉淀知识
      const findings = reflections
        .filter(r => r.assessment !== 'unclear')
        .map(r => ({
          type: r.assessment === 'correct' ? 'decision_correct' as const : 'decision_wrong' as const,
          campaignId: r.campaignId,
          skillName: '',
          detail: r.reason,
          severity: r.assessment === 'wrong' ? 'medium' as const : 'low' as const,
          suggestion: r.lesson,
        }))
      try {
        await processAuditFindings(findings)
      } catch (e: any) {
        log.warn(`[Brain] Librarian processing failed: ${e.message}`)
      }

      await memory.rememberShort('decision', `reflection_${dayjs().format('YYYYMMDD_HH')}`, {
        summary: `反思 ${reflections.length} 个决策: ${stats.correct} 正确, ${stats.wrong} 错误, 准确率 ${stats.accuracy}%`,
        stats,
      })
    }
    appendTraceStep(decisionTrace, {
      agentId: 'agent5_skill_kb',
      title: 'Agent5 技能与知识沉淀',
      conclusion: `完成反思 ${reflections.length} 条并写入知识沉淀流程`,
      confidence: reflections.length > 0 ? 0.86 : 0.72,
      evidence: [`reflection_count=${reflections.length}`],
      details: reflections.slice(0, 3).map((r: any) => `${r.campaignId}:${r.assessment}`),
    })
    if (reflections.length > 0) {
      for (const r of reflections.slice(0, 10)) {
        await pushExperienceToPython({
          traceId: decisionTrace.traceId,
          scenario: `campaign=${r.campaignId}, phase=audit`,
          decision: r.reason || 'no_reason',
          outcome: r.assessment === 'correct' ? 'success' : r.assessment === 'wrong' ? 'failure' : 'partial',
          lesson: r.lesson || '',
          evidence: [result.summary, `assessment=${r.assessment}`],
          metadata: {
            campaignId: r.campaignId,
            assessment: r.assessment,
            trigger,
          },
        })
      }
    }

    // ==================== Recording ====================
    const totalSpend = allCampaigns.reduce((s, c) => s + c.todaySpend, 0)
    const totalRevenue = allCampaigns.reduce((s, c) => s + c.todayRevenue, 0)

    result.summary = [
      `扫描 ${allCampaigns.length} 个 campaign`,
      `总花费 $${Math.round(totalSpend)} | ROAS ${benchmarks.weightedRoas}`,
      `筛选: ${screening.needsDecision} 需决策 / ${screening.watch} 观察 / ${screening.skip} 跳过`,
      `检测 ${events.length} 个事件`,
      `${result.actions.length} 个操作 (${result.actions.filter((a: any) => a.auto).length} 自动)`,
      `反思 ${reflections.length} 个历史决策`,
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
      screeningStats: { needs: screening.needsDecision, watch: screening.watch, skip: screening.skip },
    })

    log.info(`[Brain] Cycle complete: ${result.summary} (${result.durationMs}ms)`)
    result.phase = 'completed'
    return result
  } catch (err: any) {
    log.error(`[Brain] Failed at phase ${result.phase}:`, err.message)
    await Snapshot.updateOne({ _id: snapshot._id }, {
      status: 'failed', error: err.message, durationMs: Date.now() - startTime,
    })
    result.summary = `失败 @ ${result.phase}: ${err.message}`
    result.durationMs = Date.now() - startTime
    return result
  }
}

/**
 * 带重试的操作执行
 * 优先 Facebook API，失败降级 TopTou
 */
export async function executeWithRetry(action: DecisionAction, maxRetries = 3): Promise<any> {
  const retryTrace: string[] = []
  const startedAt = Date.now()
  // 第一优先：Facebook API
  const fbToken = process.env.FB_ACCESS_TOKEN
  if (fbToken && action.campaignId) {
    try {
      const fbParams: any = { access_token: fbToken }
      if (action.type === 'pause') fbParams.status = 'PAUSED'
      else if (action.type === 'resume') fbParams.status = 'ACTIVE'
      else if (action.type === 'increase_budget' && action.newBudget) fbParams.daily_budget = action.newBudget

      const axios = (await import('axios')).default
      await axios.post(`https://graph.facebook.com/v21.0/${action.campaignId}`, null, { params: fbParams, timeout: 15000 })
      log.info(`[Executor] Facebook API: ${action.type} ${action.campaignName} (${action.campaignId})`)
      return {
        ...action,
        executed: true,
        attempt: 1,
        via: 'facebook_api',
        routeReason: 'facebook_first_default',
        latencyMs: Date.now() - startedAt,
        retryTrace,
        finalStatus: 'executed',
      }
    } catch (fbErr: any) {
      retryTrace.push(`facebook_api_failed:${fbErr.response?.data?.error?.message || fbErr.message}`)
      log.warn(`[Executor] Facebook API failed for ${action.campaignId}, falling back to TopTou: ${fbErr.response?.data?.error?.message || fbErr.message}`)
    }
  } else {
    retryTrace.push('facebook_api_skipped:no_token_or_campaign_id')
  }

  // 降级：TopTou
  if (!getTopTouToken()) {
    retryTrace.push('toptou_unavailable:no_token')
    return {
      ...action,
      executed: false,
      error: 'Both Facebook API and TopTou unavailable',
      routeReason: 'fallback_required_but_unavailable',
      latencyMs: Date.now() - startedAt,
      retryTrace,
      finalStatus: 'failed',
    }
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      let apiResult: any
      if (action.type === 'pause') {
        apiResult = await toptouApi.updateStatus({
          level: 'campaign',
          list: [{ id: action.campaignId, accountId: action.accountId, status: 'PAUSED' }],
        })
      } else if (action.type === 'increase_budget' && action.newBudget) {
        apiResult = await toptouApi.updateNameOrBudget({
          level: 'campaign', id: action.campaignId,
          accountId: action.accountId, daily_budget: action.newBudget,
        })
      } else if (action.type === 'resume') {
        apiResult = await toptouApi.updateStatus({
          level: 'campaign',
          list: [{ id: action.campaignId, accountId: action.accountId, status: 'ACTIVE' }],
        })
      }
      log.info(`[Executor] TopTou fallback: ${action.type} ${action.campaignName}`)
      retryTrace.push(`toptou_attempt_${attempt}:success`)
      return {
        ...action,
        executed: true,
        attempt,
        via: 'toptou',
        result: apiResult,
        routeReason: 'facebook_failed_fallback_toptou',
        latencyMs: Date.now() - startedAt,
        retryTrace,
        finalStatus: 'executed',
      }
    } catch (err: any) {
      retryTrace.push(`toptou_attempt_${attempt}:failed:${err.message}`)
      log.warn(`[Executor] TopTou attempt ${attempt}/${maxRetries} failed for ${action.campaignId}: ${err.message}`)
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 30000 * attempt))
      } else {
        return {
          ...action,
          executed: false,
          error: `Failed after ${maxRetries} attempts: ${err.message}`,
          routeReason: 'fallback_exhausted',
          latencyMs: Date.now() - startedAt,
          retryTrace,
          finalStatus: 'failed',
        }
      }
    }
  }
}
