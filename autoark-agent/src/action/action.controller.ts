/**
 * 审批 API - 查看待审批操作、批准/拒绝
 */
import { Router, Request, Response } from 'express'
import { authenticate } from '../auth/auth.middleware'
import { Action } from './action.model'
import { executeAction } from './action.executor'

const router = Router()
router.use(authenticate)

// 获取待审批操作列表
router.get('/pending', async (req: Request, res: Response) => {
  const actions = await Action.find({ userId: req.user!.id, status: 'pending' })
    .sort({ createdAt: -1 })
    .lean()
  res.json(actions)
})

// 获取所有操作（含历史）
router.get('/', async (req: Request, res: Response) => {
  const { status, limit = '50' } = req.query
  const query: any = { userId: req.user!.id }
  if (status) query.status = status
  const actions = await Action.find(query).sort({ createdAt: -1 }).limit(Number(limit)).lean()
  res.json(actions)
})

// 批准操作
router.post('/:id/approve', async (req: Request, res: Response) => {
  const action = await Action.findById(req.params.id)
  if (!action) return res.status(404).json({ error: 'Action not found' })
  if (action.status !== 'pending') return res.status(400).json({ error: `Action is ${action.status}, not pending` })

  action.status = 'approved'
  action.reviewedBy = req.user!.id as any
  action.reviewedAt = new Date()
  action.reviewNote = req.body.note
  await action.save()

  // 立即执行
  const result = await executeAction(action._id.toString())
  const updated = await Action.findById(action._id).lean()
  res.json({ executed: result.success, action: updated })
})

// 拒绝操作
router.post('/:id/reject', async (req: Request, res: Response) => {
  const action = await Action.findById(req.params.id)
  if (!action) return res.status(404).json({ error: 'Action not found' })
  if (action.status !== 'pending') return res.status(400).json({ error: `Action is ${action.status}, not pending` })

  action.status = 'rejected'
  action.reviewedBy = req.user!.id as any
  action.reviewedAt = new Date()
  action.reviewNote = req.body.note || req.body.reason
  await action.save()

  res.json({ action })
})

// 批量批准
router.post('/approve-all', async (req: Request, res: Response) => {
  const { actionIds } = req.body
  if (!actionIds?.length) return res.status(400).json({ error: 'actionIds required' })

  const results = []
  for (const id of actionIds) {
    await Action.updateOne({ _id: id, status: 'pending' }, { status: 'approved', reviewedBy: req.user!.id, reviewedAt: new Date() })
    const r = await executeAction(id)
    results.push({ id, ...r })
  }
  res.json({ results })
})

export default router
