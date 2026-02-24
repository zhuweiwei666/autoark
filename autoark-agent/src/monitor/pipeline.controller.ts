import { Router, Request, Response } from 'express'
import { authenticate } from '../auth/auth.middleware'
import { think } from '../agent/brain'
import { getReflectionStats } from '../agent/reflection'
import { Snapshot } from '../data/snapshot.model'
import { Skill } from '../agent/skill.model'
import { Action } from '../action/action.model'
import { AuditReport } from '../agent/auditor.model'
import { Knowledge } from '../agent/librarian.model'
import { memory } from '../agent/memory.service'
import { getScope, setScope, describeScopeForPrompt } from '../agent/scope'
import { runEvolution } from '../agent/evolution'
import dayjs from 'dayjs'

const router = Router()
router.use(authenticate)

// 手动触发 Agent 思考
router.post('/run', async (_req: Request, res: Response) => {
  try {
    const result = await think('manual')
    res.json({ success: true, data: result })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// 最近一次完成的运行（优先返回 completed，不返回 running）
router.get('/latest', async (_req: Request, res: Response) => {
  const snapshot = await Snapshot.findOne({ status: 'completed' }).sort({ runAt: -1 }).lean()
    || await Snapshot.findOne().sort({ runAt: -1 }).lean()
  res.json(snapshot || { status: 'never_run' })
})

// 运行历史
router.get('/history', async (req: Request, res: Response) => {
  const limit = Number(req.query.limit) || 20
  const snapshots = await Snapshot.find()
    .select('runAt triggeredBy totalCampaigns classification totalSpend overallRoas summary status durationMs actions')
    .sort({ runAt: -1 })
    .limit(limit)
    .lean()
  res.json(snapshots)
})

// 快照详情
router.get('/snapshot/:id', async (req: Request, res: Response) => {
  const snapshot = await Snapshot.findById(req.params.id).lean()
  if (!snapshot) return res.status(404).json({ error: 'Not found' })
  res.json(snapshot)
})

// 反思统计
router.get('/reflection-stats', async (req: Request, res: Response) => {
  const days = Number(req.query.days) || 7
  const stats = await getReflectionStats(days)
  res.json(stats)
})

// Agent 当前状态
router.get('/status', async (_req: Request, res: Response) => {
  const latest = await Snapshot.findOne().sort({ runAt: -1 }).lean()
  const focus = await memory.getFocus()
  const stats = await getReflectionStats(7)
  res.json({
    lastRun: latest?.runAt || null,
    lastStatus: latest?.status || 'never_run',
    lastSummary: latest?.summary || '',
    focus,
    reflectionAccuracy: stats.accuracy,
    totalDecisions7d: stats.total,
  })
})

// 经验教训
router.get('/lessons', async (req: Request, res: Response) => {
  const lessons = await memory.recallLessons(undefined, 20)
  res.json(lessons)
})

// 触发进化分析
router.post('/evolve', async (_req: Request, res: Response) => {
  try {
    const proposals = await runEvolution()
    res.json({ success: true, proposals })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// 查看权责范围
router.get('/scope', async (_req: Request, res: Response) => {
  res.json({ scope: getScope(), description: describeScopeForPrompt() })
})

// 修改权责范围
router.post('/scope', async (req: Request, res: Response) => {
  const { accountIds, packageNames, optimizers } = req.body
  setScope({
    ...(accountIds !== undefined ? { accountIds } : {}),
    ...(packageNames !== undefined ? { packageNames } : {}),
    ...(optimizers !== undefined ? { optimizers } : {}),
  })
  res.json({ scope: getScope(), description: describeScopeForPrompt() })
})

// Dashboard 聚合 API — 一次拿全前端所需数据
router.get('/dashboard', async (_req: Request, res: Response) => {
  try {
    const now = new Date()
    const today = dayjs().startOf('day').toDate()

    // 最近 5 轮 cycle
    const recentSnapshots = await Snapshot.find({ status: 'completed' })
      .sort({ runAt: -1 }).limit(5).lean() as any[]

    const latest = recentSnapshots[0]

    // Skill 统计
    const skills = await Skill.find({}).sort({ 'stats.triggered': -1 }).lean() as any[]

    // Action 统计（最近 24h）
    const since24h = dayjs().subtract(24, 'hour').toDate()
    const recentActions = await Action.find({ createdAt: { $gte: since24h } }).lean() as any[]
    const executed = recentActions.filter((a: any) => a.status === 'executed').length
    const failed = recentActions.filter((a: any) => a.status === 'failed').length
    const pending = recentActions.filter((a: any) => a.status === 'pending').length

    // 审查统计
    const latestAudit = await AuditReport.findOne().sort({ auditedAt: -1 }).lean() as any
    const reflectionStats = await getReflectionStats(7)

    // 知识库统计
    let knowledgeTotal = 0, knowledgeNewToday = 0
    try {
      knowledgeTotal = await Knowledge.countDocuments({ archived: { $ne: true } })
      knowledgeNewToday = await Knowledge.countDocuments({ createdAt: { $gte: today }, archived: { $ne: true } })
    } catch { /* Knowledge collection might not exist yet */ }

    // 构建 Agent 状态
    const screenerSkills = skills.filter((s: any) => s.agentId === 'screener')
    const decisionSkills = skills.filter((s: any) => s.agentId === 'decision')

    const agents = {
      monitor: {
        status: latest ? 'online' : 'idle',
        lastRun: latest?.runAt,
        campaignCount: latest?.totalCampaigns || 0,
        spend: latest?.totalSpend || 0,
        roas: latest?.overallRoas || 0,
      },
      screener: {
        status: latest ? 'online' : 'idle',
        lastRun: latest?.runAt,
        needsDecision: 0, watch: 0, skip: 0,
        topSkills: screenerSkills.slice(0, 5).map((s: any) => ({ name: s.name, triggered: s.stats?.triggered || 0, accuracy: s.stats?.accuracy || 0 })),
      },
      decision: {
        status: recentActions.length > 0 ? 'active' : 'idle',
        lastRun: latest?.runAt,
        actionsCount: recentActions.length,
        autoExecuted: executed,
        pending,
      },
      executor: {
        status: executed > 0 ? 'active' : 'idle',
        lastRun: latest?.runAt,
        executed,
        failed,
      },
      auditor: {
        status: latestAudit ? 'online' : 'idle',
        lastRun: latestAudit?.auditedAt,
        accuracy: reflectionStats.accuracy,
        findings: latestAudit ? (latestAudit.screenerAudit?.findings?.length || 0) + (latestAudit.decisionAudit?.findings?.length || 0) : 0,
        correct: reflectionStats.correct,
        wrong: reflectionStats.wrong,
      },
      librarian: {
        status: knowledgeTotal > 0 ? 'online' : 'idle',
        knowledgeCount: knowledgeTotal,
        knowledgeNewToday,
        skillsManaged: skills.length,
      },
    }

    // 解析 screening 数据
    if (latest?.summary) {
      const m = latest.summary.match(/筛选[：:]\s*(\d+)\s*需决策\s*\/\s*(\d+)\s*观察\s*\/\s*(\d+)\s*跳过/)
      if (m) {
        agents.screener.needsDecision = parseInt(m[1])
        agents.screener.watch = parseInt(m[2])
        agents.screener.skip = parseInt(m[3])
      }
    }

    // 构建 timeline cycles
    const recentCycles = recentSnapshots.map((s: any) => ({
      id: s._id,
      runAt: s.runAt,
      duration: s.durationMs,
      summary: s.summary,
      status: s.status,
      totalCampaigns: s.totalCampaigns,
      totalSpend: s.totalSpend,
      overallRoas: s.overallRoas,
      classification: s.classification,
      actions: (s.actions || []).map((a: any) => ({
        type: a.type, campaign: a.campaignName, auto: a.auto, executed: a.executed,
      })),
    }))

    // Skill 热力图数据
    const skillStats = skills.map((s: any) => ({
      name: s.name,
      agentId: s.agentId,
      triggered: s.stats?.triggered || 0,
      accuracy: s.stats?.accuracy || 0,
      enabled: s.enabled,
      correct: s.stats?.correct || 0,
      wrong: s.stats?.wrong || 0,
    }))

    res.json({
      currentPhase: 'idle',
      lastCycleAt: latest?.runAt,
      lastCycleSummary: latest?.summary || '暂无数据',
      agents,
      recentCycles,
      skillStats,
      knowledgeSummary: { total: knowledgeTotal, newToday: knowledgeNewToday },
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
