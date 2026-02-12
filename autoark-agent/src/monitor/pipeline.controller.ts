import { Router, Request, Response } from 'express'
import { authenticate } from '../auth/auth.middleware'
import { think } from '../agent/brain'
import { getReflectionStats } from '../agent/reflection'
import { Snapshot } from '../data/snapshot.model'
import { memory } from '../agent/memory.service'
import { getScope, setScope, describeScopeForPrompt } from '../agent/scope'
import { runEvolution } from '../agent/evolution'

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

// 最近一次运行
router.get('/latest', async (_req: Request, res: Response) => {
  const snapshot = await Snapshot.findOne().sort({ runAt: -1 }).lean()
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

export default router
