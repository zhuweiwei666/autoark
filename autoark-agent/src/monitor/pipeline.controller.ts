/**
 * Pipeline API - 手动触发、查看快照、查看决策历史
 */
import { Router, Request, Response } from 'express'
import { authenticate } from '../auth/auth.middleware'
import { runPipeline } from '../agent/pipeline'
import { Snapshot } from '../data/snapshot.model'
import { log } from '../platform/logger'

const router = Router()
router.use(authenticate)

// 手动触发流水线
router.post('/run', async (_req: Request, res: Response) => {
  try {
    log.info('[Pipeline API] Manual trigger')
    const result = await runPipeline('manual')
    res.json({ success: true, data: result })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// 获取最近一次快照
router.get('/latest', async (_req: Request, res: Response) => {
  const snapshot = await Snapshot.findOne().sort({ runAt: -1 }).lean()
  res.json(snapshot || { status: 'never_run' })
})

// 获取快照历史
router.get('/history', async (req: Request, res: Response) => {
  const limit = Number(req.query.limit) || 20
  const snapshots = await Snapshot.find()
    .select('runAt triggeredBy totalCampaigns classification totalSpend overallRoas summary status durationMs')
    .sort({ runAt: -1 })
    .limit(limit)
    .lean()
  res.json(snapshots)
})

// 获取某次快照详情
router.get('/snapshot/:id', async (req: Request, res: Response) => {
  const snapshot = await Snapshot.findById(req.params.id).lean()
  if (!snapshot) return res.status(404).json({ error: 'Not found' })
  res.json(snapshot)
})

export default router
