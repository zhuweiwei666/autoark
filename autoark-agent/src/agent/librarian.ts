/**
 * Agent 5: Librarian — 知识管理 + Skill 生命周期 + 上下文提供
 *
 * 所有 Skill 和知识的唯一写入者。Auditor 提交 findings，Librarian 决定如何处理。
 * 职责：
 * 1. 接收 Auditor findings → 更新 Skill stats + 沉淀知识
 * 2. Skill 生命周期管理（调参/禁用/晋升）
 * 3. 知识库管理（衰减/清理/综合）
 * 4. 为其他 Agent 提供上下文
 */
import dayjs from 'dayjs'
import { log } from '../platform/logger'
import { Skill } from './skill.model'
import { Knowledge } from './librarian.model'
import { AuditReport, AuditFinding } from './auditor.model'
import { memory } from './memory.service'
import { Action } from '../action/action.model'

// ==================== 1. 处理 Auditor Findings ====================

/**
 * 接收审查报告，更新 Skill stats 和知识库
 */
export async function processAuditFindings(findings: AuditFinding[]): Promise<void> {
  if (findings.length === 0) return

  for (const f of findings) {
    if (f.type === 'decision_wrong' || f.type === 'decision_correct') {
      if (f.skillName) {
        await updateSkillFromFinding(f)
      }
    }

    if (f.type === 'screener_miss' || f.type === 'screener_overalert') {
      await learnFromScreenerFinding(f)
    }

    if (f.suggestion && f.severity !== 'low') {
      await sinkKnowledge(f)
    }
  }

  log.info(`[Librarian] Processed ${findings.length} findings`)
}

async function updateSkillFromFinding(f: AuditFinding): Promise<void> {
  if (!f.skillName) return
  const isCorrect = f.type === 'decision_correct'

  const update: any = { $set: { 'stats.lastTriggeredAt': new Date() } }
  if (isCorrect) {
    update.$inc = { 'stats.correct': 1 }
  } else {
    update.$inc = { 'stats.wrong': 1 }
    if (f.suggestion) {
      update.$push = { learnedNotes: { $each: [f.suggestion], $slice: -10 } }
    }
  }

  await Skill.updateOne({ name: f.skillName }, update)

  const skill = await Skill.findOne({ name: f.skillName }).select('stats').lean() as any
  if (skill?.stats) {
    const total = (skill.stats.correct || 0) + (skill.stats.wrong || 0)
    const accuracy = total > 0 ? Math.round((skill.stats.correct || 0) / total * 100) : 0
    await Skill.updateOne({ name: f.skillName }, { $set: { 'stats.accuracy': accuracy } })
  }
}

async function learnFromScreenerFinding(f: AuditFinding): Promise<void> {
  const key = `screener:${f.type}:${f.skillName || 'default'}:${dayjs().format('YYYYMMDD')}`
  await Knowledge.findOneAndUpdate(
    { key },
    {
      category: 'skill_insight',
      content: f.detail,
      data: { type: f.type, skillName: f.skillName, campaignId: f.campaignId, severity: f.severity },
      source: 'auditor',
      relatedSkills: f.skillName ? [f.skillName] : [],
      tags: [f.type, f.severity],
      lastValidatedAt: new Date(),
      $inc: { validations: 1 },
      $setOnInsert: { confidence: 0.5 },
    },
    { upsert: true }
  )
}

async function sinkKnowledge(f: AuditFinding): Promise<void> {
  const category = f.type.startsWith('screener') ? 'skill_insight' :
    f.type.startsWith('decision') ? 'decision_lesson' : 'skill_insight'

  const key = `finding:${f.type}:${f.campaignId}:${dayjs().format('YYYYMMDD_HH')}`
  await Knowledge.findOneAndUpdate(
    { key },
    {
      category,
      content: `${f.detail}${f.suggestion ? ` → ${f.suggestion}` : ''}`,
      data: { ...f },
      source: 'auditor',
      relatedSkills: f.skillName ? [f.skillName] : [],
      tags: [f.type, f.severity],
      lastValidatedAt: new Date(),
      $inc: { validations: 1 },
      $setOnInsert: { confidence: 0.6 },
    },
    { upsert: true }
  )
}

// ==================== 2. Skill 生命周期管理 ====================

/**
 * 检查所有 Skill 的健康状态，执行生命周期操作
 */
export async function manageSkillLifecycle(): Promise<string[]> {
  const actions: string[] = []
  const skills = await Skill.find({ enabled: true }).lean() as any[]

  for (const skill of skills) {
    const stats = skill.stats || {}
    const total = (stats.correct || 0) + (stats.wrong || 0)

    if (total < 5) continue

    const accuracy = total > 0 ? Math.round((stats.correct || 0) / total * 100) : 0

    // 准确率过低 → 禁用
    if (accuracy < 40 && total >= 10) {
      await Skill.updateOne({ _id: skill._id }, { $set: { enabled: false } })
      const msg = `Skill "${skill.name}" 已禁用: 准确率 ${accuracy}% (${stats.correct}/${total})`
      actions.push(msg)
      log.warn(`[Librarian] ${msg}`)

      await Knowledge.create({
        category: 'skill_insight',
        key: `skill_disabled:${skill.name}:${dayjs().format('YYYYMMDD')}`,
        content: msg,
        data: { skillId: skill._id, stats, accuracy },
        source: 'evolution',
        confidence: 0.9,
        relatedSkills: [skill.name],
        tags: ['skill_disabled', skill.agentId],
      })
    }

    // 连续错误检查
    const recentWrongNotes = (skill.learnedNotes || []).slice(-5)
    if (recentWrongNotes.length >= 5) {
      const msg = `Skill "${skill.name}" 连续 5 条错误记录，需要人工审查`
      actions.push(msg)
      log.warn(`[Librarian] ${msg}`)
    }

    // 准确率高 → 晋升（提高优先级）
    if (accuracy >= 85 && total >= 20 && skill.order > 20) {
      await Skill.updateOne({ _id: skill._id }, { $inc: { order: -5 } })
      actions.push(`Skill "${skill.name}" 晋升: 准确率 ${accuracy}%，优先级提高`)
    }
  }

  if (actions.length > 0) {
    log.info(`[Librarian] Skill lifecycle: ${actions.length} actions`)
  }
  return actions
}

// ==================== 3. 知识库管理 ====================

/**
 * 知识置信度衰减：30 天未验证的知识 confidence 下降
 */
export async function decayKnowledge(): Promise<number> {
  const threshold = dayjs().subtract(30, 'day').toDate()
  const stale = await Knowledge.find({
    archived: { $ne: true },
    lastValidatedAt: { $lt: threshold },
    confidence: { $gt: 0.2 },
  })

  let decayed = 0
  for (const k of stale) {
    k.confidence = Math.max(0.1, k.confidence - 0.1)
    if (k.confidence <= 0.2) {
      k.archived = true
    }
    await k.save()
    decayed++
  }

  // 清理极低置信度的知识
  const archived = await Knowledge.countDocuments({ archived: true })
  if (archived > 100) {
    await Knowledge.deleteMany({ archived: true, confidence: { $lt: 0.15 } })
  }

  if (decayed > 0) log.info(`[Librarian] Knowledge decay: ${decayed} entries decayed`)
  return decayed
}

/**
 * 从 rejected actions 中学习用户偏好
 */
export async function learnUserPreferences(): Promise<void> {
  const recent = await Action.find({
    status: 'rejected',
    reviewedAt: { $gte: dayjs().subtract(7, 'day').toDate() },
  }).lean()

  if (recent.length === 0) return

  for (const a of recent as any[]) {
    const key = `user_pref:reject:${a.type}:${a.params?.skillName || 'unknown'}`
    await Knowledge.findOneAndUpdate(
      { key },
      {
        category: 'user_preference',
        content: `用户拒绝了 ${a.type} 操作 (${a.entityName || a.entityId}): ${a.reviewNote || '无备注'}`,
        data: { actionType: a.type, skillName: a.params?.skillName, entityName: a.entityName, reason: a.reason },
        source: 'user_feedback',
        relatedSkills: a.params?.skillName ? [a.params.skillName] : [],
        tags: ['user_preference', `rejected:${a.type}`],
        confidence: 0.8,
        lastValidatedAt: new Date(),
        $inc: { validations: 1 },
      },
      { upsert: true }
    )
  }

  log.info(`[Librarian] Learned ${recent.length} user preferences from rejected actions`)
}

// ==================== 4. 上下文提供 ====================

/**
 * 为指定 Agent 和 campaign 提供知识上下文
 */
export async function getContext(
  agentId: 'screener' | 'decision' | 'executor',
  campaignData?: { pkgName?: string; optimizer?: string; accountId?: string },
): Promise<string> {
  const parts: string[] = []

  // 相关 Skill 洞察
  const skillInsights = await Knowledge.find({
    category: 'skill_insight',
    archived: { $ne: true },
    confidence: { $gte: 0.4 },
  }).sort({ confidence: -1 }).limit(5).lean()

  if (skillInsights.length > 0) {
    parts.push('## Skill 洞察')
    for (const k of skillInsights) {
      parts.push(`- [${k.confidence.toFixed(1)}] ${k.content}`)
    }
  }

  // 决策经验
  if (agentId === 'decision') {
    const lessons = await Knowledge.find({
      category: 'decision_lesson',
      archived: { $ne: true },
      confidence: { $gte: 0.4 },
    }).sort({ confidence: -1 }).limit(5).lean()

    if (lessons.length > 0) {
      parts.push('\n## 决策经验')
      for (const k of lessons) parts.push(`- [${k.confidence.toFixed(1)}] ${k.content}`)
    }

    // 用户偏好
    const prefs = await Knowledge.find({
      category: 'user_preference',
      archived: { $ne: true },
    }).sort({ validations: -1 }).limit(3).lean()

    if (prefs.length > 0) {
      parts.push('\n## 用户偏好')
      for (const k of prefs) parts.push(`- ${k.content}`)
    }
  }

  // 相关包名的模式
  if (campaignData?.pkgName) {
    const patterns = await Knowledge.find({
      category: 'campaign_pattern',
      relatedPackages: { $regex: campaignData.pkgName, $options: 'i' },
      archived: { $ne: true },
    }).limit(3).lean()

    if (patterns.length > 0) {
      parts.push('\n## 相关产品模式')
      for (const k of patterns) parts.push(`- ${k.content}`)
    }
  }

  return parts.join('\n') || ''
}

// ==================== 5. 定时任务 ====================

/**
 * 每日总结：汇总今日审查结果
 */
export async function dailySummary(): Promise<string> {
  const today = dayjs().startOf('day').toDate()
  const reports = await AuditReport.find({ auditedAt: { $gte: today } }).lean()

  if (reports.length === 0) return '今日无审查数据'

  let totalScreened = 0, totalFN = 0, totalFP = 0
  let totalDecisions = 0, totalCorrect = 0, totalWrong = 0
  let totalExec = 0, totalFailed = 0

  for (const r of reports as any[]) {
    totalScreened += r.screenerAudit?.total || 0
    totalFN += r.screenerAudit?.falseNegatives || 0
    totalFP += r.screenerAudit?.falsePositives || 0
    totalDecisions += r.decisionAudit?.total || 0
    totalCorrect += r.decisionAudit?.correct || 0
    totalWrong += r.decisionAudit?.wrong || 0
    totalExec += r.executorAudit?.total || 0
    totalFailed += r.executorAudit?.failed || 0
  }

  const skillActions = await manageSkillLifecycle()
  await decayKnowledge()
  await learnUserPreferences()

  const knowledgeCount = await Knowledge.countDocuments({ archived: { $ne: true } })

  const summary = [
    `审查 ${reports.length} 轮`,
    `Screener: ${totalScreened} 审查, ${totalFN} 漏网, ${totalFP} 过度`,
    `Decision: ${totalDecisions} 审查, ${totalCorrect} 正确, ${totalWrong} 错误`,
    `Executor: ${totalExec} 执行, ${totalFailed} 失败`,
    `知识库: ${knowledgeCount} 条活跃知识`,
    skillActions.length > 0 ? `Skill 调整: ${skillActions.join('; ')}` : '',
  ].filter(Boolean).join('\n')

  await memory.rememberShort('librarian', `daily_${dayjs().format('YYYYMMDD')}`, { summary, reports: reports.length })
  log.info(`[Librarian] Daily summary:\n${summary}`)

  return summary
}

/**
 * 每周进化分析
 */
export async function weeklyEvolution(): Promise<string> {
  const weekAgo = dayjs().subtract(7, 'day').toDate()
  const reports = await AuditReport.find({ auditedAt: { $gte: weekAgo } }).lean()

  const skills = await Skill.find({}).lean() as any[]
  const skillSummary = skills
    .filter(s => (s.stats?.correct || 0) + (s.stats?.wrong || 0) > 0)
    .map(s => {
      const total = (s.stats.correct || 0) + (s.stats.wrong || 0)
      return `${s.name}: ${s.stats.accuracy}% (${total} samples) ${s.enabled ? '' : '[已禁用]'}`
    })
    .join('\n')

  const newKnowledge = await Knowledge.find({ createdAt: { $gte: weekAgo }, archived: { $ne: true } })
    .sort({ confidence: -1 }).limit(5).lean()

  const summary = [
    `=== 本周进化报告 ===`,
    `审查轮数: ${reports.length}`,
    `\n--- Skill 准确率 ---`,
    skillSummary || '暂无数据',
    `\n--- 新增知识 (Top 5) ---`,
    ...newKnowledge.map(k => `- [${(k as any).confidence.toFixed(1)}] ${k.content}`),
  ].join('\n')

  await memory.rememberShort('librarian', `weekly_${dayjs().format('YYYYWW')}`, { summary })
  log.info(`[Librarian] Weekly evolution:\n${summary}`)

  return summary
}
