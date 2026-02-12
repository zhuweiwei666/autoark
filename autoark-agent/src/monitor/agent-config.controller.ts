import { Router, Request, Response } from 'express'
import { authenticate } from '../auth/auth.middleware'
import { getAgentConfig, updateAgentConfig } from '../agent/agent-config.model'
import { Skill } from '../agent/skill.model'
import { memory } from '../agent/memory.service'

const router = Router()
router.use(authenticate)

// 获取某个 Agent 的配置
router.get('/:agentId', async (req: Request, res: Response) => {
  const config = await getAgentConfig(req.params.agentId as string)
  if (!config) return res.status(404).json({ error: 'Agent not found' })

  // 附加关联数据
  const extra: any = {}
  if (req.params.agentId === 'strategy') {
    extra.availableSkills = await Skill.find().select('name description isActive match').lean()
  }
  if (req.params.agentId === 'auditor') {
    extra.lessons = await memory.recallLessons(undefined, 10)
  }

  res.json({ config, ...extra })
})

// 更新某个 Agent 的配置
router.put('/:agentId', async (req: Request, res: Response) => {
  const updated = await updateAgentConfig(req.params.agentId as string, req.body)
  res.json(updated)
})

// 获取所有 Agent 配置
router.get('/', async (_req: Request, res: Response) => {
  const ids = ['monitor', 'strategy', 'executor', 'auditor']
  const configs: any = {}
  for (const id of ids) {
    configs[id] = await getAgentConfig(id)
  }
  res.json(configs)
})

export default router
