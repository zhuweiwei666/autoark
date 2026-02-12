import { Router, Request, Response } from 'express'
import { authenticate } from '../auth/auth.middleware'
import { Skill } from '../agent/skill.model'

const router = Router()
router.use(authenticate)

router.get('/', async (_req: Request, res: Response) => {
  const skills = await Skill.find().sort({ priority: -1 }).lean()
  res.json(skills)
})

router.post('/', async (req: Request, res: Response) => {
  const skill = await Skill.create(req.body)
  res.json(skill)
})

router.put('/:id', async (req: Request, res: Response) => {
  const skill = await Skill.findByIdAndUpdate(req.params.id, req.body, { new: true })
  res.json(skill)
})

router.delete('/:id', async (req: Request, res: Response) => {
  await Skill.findByIdAndDelete(req.params.id)
  res.json({ success: true })
})

export default router
