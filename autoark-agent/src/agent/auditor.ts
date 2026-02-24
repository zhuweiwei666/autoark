/**
 * Agent 4: Auditor — 三层审查 + 纠正回环
 *
 * 独立于 Brain cycle 运行，用延迟后的新数据回看：
 * 1. Screener 审查：2h 前筛选的 skip/watch campaign 有没有漏网之鱼
 * 2. Decision 审查：已执行的操作是否正确（复用改进后的 reflection）
 * 3. Executor 审查：执行是否成功
 *
 * 产出 AuditReport，交给 Librarian 处理 findings。
 */
import dayjs from 'dayjs'
import { log } from '../platform/logger'
import { AuditReport, AuditFinding } from './auditor.model'
import { Snapshot } from '../data/snapshot.model'
import { Action } from '../action/action.model'
import { Skill } from './skill.model'
import { monitor } from './monitor'
import { getRedis } from '../config/redis'
import { reflectAll, getReflectionStats } from './reflection'
import type { CampaignMetrics } from './analyzer'

// ==================== Screener 审查 ====================

/**
 * 审查 2 小时前的筛选结果：被 skip/watch 的 campaign 是否后来出了问题
 */
async function auditScreener(): Promise<{ findings: AuditFinding[]; total: number; falseNegatives: number; falsePositives: number }> {
  const findings: AuditFinding[] = []

  const twoHoursAgo = dayjs().subtract(2, 'hour').toDate()
  const fourHoursAgo = dayjs().subtract(4, 'hour').toDate()
  const snapshot = await Snapshot.findOne({
    status: 'completed',
    runAt: { $gte: fourHoursAgo, $lte: twoHoursAgo },
  }).sort({ runAt: -1 }).lean() as any

  if (!snapshot) {
    log.info('[Auditor] No snapshot from 2-4h ago for screener audit')
    return { findings, total: 0, falseNegatives: 0, falsePositives: 0 }
  }

  let currentData: any
  try {
    currentData = await monitor()
  } catch (e: any) {
    log.warn(`[Auditor] Failed to get current data for screener audit: ${e.message}`)
    return { findings, total: 0, falseNegatives: 0, falsePositives: 0 }
  }

  const currentMap = new Map(currentData.campaigns.map((c: any) => [c.id, c]))
  let falseNegatives = 0
  let falsePositives = 0

  const pastActions = snapshot.actions || []
  const screened = (snapshot as any).screening?.results || []

  // 检查被 skip 或 watch 的 campaign 是否出了问题
  for (const sr of screened) {
    if (sr.verdict !== 'skip' && sr.verdict !== 'watch') continue

    const current = currentMap.get(sr.campaignId) as any
    if (!current) continue

    const roi = current.adjustedRoi || current.roi || 0
    const spend = current.spend || 0

    if (spend > 50 && roi < 0.3) {
      falseNegatives++
      findings.push({
        type: 'screener_miss',
        campaignId: sr.campaignId,
        campaignName: current.name,
        skillName: sr.matchedSkill || 'default',
        detail: `2h 前标记为 ${sr.verdict}，现在花费 $${spend.toFixed(0)} ROI ${roi.toFixed(2)} 严重亏损`,
        severity: 'high',
        suggestion: `考虑降低筛选阈值或增加新的 Screener Skill 覆盖此场景`,
      })
    } else if (spend > 100 && (current.installs || 0) === 0) {
      falseNegatives++
      findings.push({
        type: 'screener_miss',
        campaignId: sr.campaignId,
        campaignName: current.name,
        skillName: sr.matchedSkill || 'default',
        detail: `2h 前标记为 ${sr.verdict}，现在花费 $${spend.toFixed(0)} 零转化`,
        severity: 'high',
        suggestion: `零转化检测 Skill 可能需要降低花费阈值`,
      })
    }
  }

  // 检查被标记为 needs_decision 但实际不需要操作的（过度告警）
  const needsDecision = screened.filter((s: any) => s.verdict === 'needs_decision')
  for (const sr of needsDecision) {
    const current = currentMap.get(sr.campaignId) as any
    if (!current) continue

    const roi = current.adjustedRoi || current.roi || 0
    const hadAction = pastActions.some((a: any) => a.campaignId === sr.campaignId)

    if (!hadAction && roi > 1.5 && current.spend > 20) {
      falsePositives++
      findings.push({
        type: 'screener_overalert',
        campaignId: sr.campaignId,
        campaignName: current.name,
        skillName: sr.matchedSkill,
        detail: `2h 前标记为 needs_decision (${sr.matchedSkill})，但 ROI 恢复到 ${roi.toFixed(2)}，无需操作`,
        severity: 'low',
        suggestion: `${sr.matchedSkill} Skill 可能阈值过于激进`,
      })
    }
  }

  const total = screened.length
  log.info(`[Auditor] Screener audit: ${total} screened, ${falseNegatives} false negatives, ${falsePositives} false positives`)
  return { findings, total, falseNegatives, falsePositives }
}

// ==================== Decision 审查 ====================

/**
 * 审查 4-24 小时前执行的决策
 */
async function auditDecisions(allCampaigns: CampaignMetrics[]): Promise<{ findings: AuditFinding[]; total: number; correct: number; wrong: number; unclear: number }> {
  const campaignMap = new Map(allCampaigns.map(c => [c.campaignId, c]))
  const reflections = await reflectAll(campaignMap, allCampaigns)

  const findings: AuditFinding[] = []
  let correct = 0, wrong = 0, unclear = 0

  for (const r of reflections) {
    if (r.assessment === 'correct') correct++
    else if (r.assessment === 'wrong') {
      wrong++
      findings.push({
        type: 'decision_wrong',
        campaignId: r.campaignId,
        detail: r.reason,
        severity: 'medium',
        suggestion: r.lesson,
      })
    } else {
      unclear++
    }
  }

  log.info(`[Auditor] Decision audit: ${reflections.length} reviewed, ${correct} correct, ${wrong} wrong, ${unclear} unclear`)
  return { findings, total: reflections.length, correct, wrong, unclear }
}

// ==================== Executor 审查 ====================

/**
 * 审查最近执行的 action 是否成功
 */
async function auditExecutor(): Promise<{ findings: AuditFinding[]; total: number; succeeded: number; failed: number }> {
  const recentActions = await Action.find({
    status: { $in: ['executed', 'failed'] },
    executedAt: { $gte: dayjs().subtract(4, 'hour').toDate() },
    'params.audited': { $ne: true },
  }).lean()

  const findings: AuditFinding[] = []
  let succeeded = 0, failed = 0

  for (const action of recentActions) {
    const a = action as any
    if (a.status === 'executed') {
      succeeded++
      findings.push({
        type: 'executor_ok',
        campaignId: a.entityId,
        campaignName: a.entityName,
        detail: `${a.type} 执行成功`,
        severity: 'low',
        suggestion: '',
      })
    } else {
      failed++
      findings.push({
        type: 'executor_fail',
        campaignId: a.entityId,
        campaignName: a.entityName,
        skillName: a.params?.skillName,
        detail: `${a.type} 执行失败: ${a.result?.error || 'unknown'}`,
        severity: 'high',
        suggestion: `重试或检查 TopTou API / Token 状态`,
      })
    }

    await Action.updateOne({ _id: a._id }, { $set: { 'params.audited': true } })
  }

  log.info(`[Auditor] Executor audit: ${recentActions.length} actions, ${succeeded} ok, ${failed} failed`)
  return { findings, total: recentActions.length, succeeded, failed }
}

// ==================== 纠正回环 ====================

/**
 * 将纠正指令写入 Redis，下一轮 Brain cycle 会读取
 */
async function pushCorrective(actions: Array<{ campaignId: string; reason: string; action: string }>): Promise<void> {
  if (actions.length === 0) return
  try {
    const redis = getRedis()
    if (!redis) return
    const existing = await redis.get('agent:corrective') || '[]'
    const list = JSON.parse(existing)
    list.push(...actions)
    await redis.set('agent:corrective', JSON.stringify(list.slice(-20)), 'EX', 7200)
    log.info(`[Auditor] Pushed ${actions.length} corrective actions`)
  } catch { /* Redis optional */ }
}

/**
 * Brain cycle 开始时读取并清空纠正指令
 */
export async function popCorrective(): Promise<Array<{ campaignId: string; reason: string; action: string }>> {
  try {
    const redis = getRedis()
    if (!redis) return []
    const data = await redis.get('agent:corrective')
    if (!data) return []
    await redis.del('agent:corrective')
    return JSON.parse(data)
  } catch { return [] }
}

// ==================== 主入口 ====================

/**
 * 运行完整审查（Screener + Decision + Executor）
 */
export async function runAudit(allCampaigns?: CampaignMetrics[]): Promise<any> {
  log.info('[Auditor] Starting audit cycle...')
  const startTime = Date.now()

  const campaigns = allCampaigns || []
  const screener = await auditScreener()
  const decision = await auditDecisions(campaigns)
  const executor = await auditExecutor()

  const allFindings = [...screener.findings, ...decision.findings, ...executor.findings]
  const highSeverity = allFindings.filter(f => f.severity === 'high')

  // 纠正回环：严重的 screener miss 需要重新筛选
  const corrective = screener.findings
    .filter(f => f.type === 'screener_miss' && f.severity === 'high')
    .map(f => ({ campaignId: f.campaignId, reason: f.detail, action: 'rescreen' }))

  const executorRetries = executor.findings
    .filter(f => f.type === 'executor_fail')
    .map(f => ({ campaignId: f.campaignId, reason: f.detail, action: 'retry_execute' }))

  await pushCorrective([...corrective, ...executorRetries])

  const screenerAccuracy = screener.total > 0 ? Math.round((1 - (screener.falseNegatives + screener.falsePositives) / screener.total) * 100) : 100
  const decisionAccuracy = decision.total > 0 ? Math.round(decision.correct / (decision.correct + decision.wrong || 1) * 100) : 0

  const summary = [
    `Screener: ${screener.total} 审查, ${screener.falseNegatives} 漏网, ${screener.falsePositives} 过度告警, 准确率 ${screenerAccuracy}%`,
    `Decision: ${decision.total} 审查, ${decision.correct} 正确, ${decision.wrong} 错误, 准确率 ${decisionAccuracy}%`,
    `Executor: ${executor.total} 审查, ${executor.succeeded} 成功, ${executor.failed} 失败`,
    highSeverity.length > 0 ? `严重问题: ${highSeverity.length} 个` : '',
    corrective.length > 0 ? `纠正指令: ${corrective.length} 个` : '',
  ].filter(Boolean).join(' | ')

  const report = await AuditReport.create({
    auditType: 'full',
    screenerAudit: { total: screener.total, falseNegatives: screener.falseNegatives, falsePositives: screener.falsePositives, accuracy: screenerAccuracy, findings: screener.findings },
    decisionAudit: { total: decision.total, correct: decision.correct, wrong: decision.wrong, unclear: decision.unclear, accuracy: decisionAccuracy, findings: decision.findings },
    executorAudit: { total: executor.total, succeeded: executor.succeeded, failed: executor.failed, findings: executor.findings },
    corrective: [...corrective, ...executorRetries],
    summary,
  })

  log.info(`[Auditor] Audit complete (${Date.now() - startTime}ms): ${summary}`)

  return {
    reportId: report._id.toString(),
    summary,
    findings: allFindings,
    corrective: [...corrective, ...executorRetries],
  }
}
