import { Router, Request, Response } from 'express'
import { ruleService } from '../services/rule.service'
import logger from '../utils/logger'
import { authenticate } from '../middlewares/auth'

const router = Router()

// 所有规则接口需要认证
router.use(authenticate)

/**
 * GET /api/rules
 * 获取所有规则
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status } = req.query
    const rules = await ruleService.getRules({ 
      status: status as string,
      createdBy: req.user?.userId 
    })
    res.json({ success: true, data: rules })
  } catch (error: any) {
    logger.error('[RuleController] Get rules failed:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/rules/templates
 * 获取预设规则模板
 */
router.get('/templates', async (req: Request, res: Response) => {
  try {
    const templates = ruleService.getTemplates()
    res.json({ success: true, data: templates })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/rules/:id
 * 获取单个规则详情
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const rule = await ruleService.getRuleById(req.params.id)
    if (!rule) {
      return res.status(404).json({ success: false, error: 'Rule not found' })
    }
    res.json({ success: true, data: rule })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/rules
 * 创建新规则
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const data = {
      ...req.body,
      createdBy: req.user?.userId || 'unknown',
    }
    const rule = await ruleService.createRule(data)
    res.status(201).json({ success: true, data: rule })
  } catch (error: any) {
    logger.error('[RuleController] Create rule failed:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/rules/:id
 * 更新规则
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const rule = await ruleService.updateRule(req.params.id, req.body)
    if (!rule) {
      return res.status(404).json({ success: false, error: 'Rule not found' })
    }
    res.json({ success: true, data: rule })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * DELETE /api/rules/:id
 * 删除规则
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await ruleService.deleteRule(req.params.id)
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Rule not found' })
    }
    res.json({ success: true, message: 'Rule deleted' })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/rules/:id/execute
 * 手动执行规则
 */
router.post('/:id/execute', async (req: Request, res: Response) => {
  try {
    const execution = await ruleService.executeRule(req.params.id)
    res.json({ success: true, data: execution })
  } catch (error: any) {
    logger.error('[RuleController] Execute rule failed:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/rules/:id/toggle
 * 切换规则状态（激活/暂停）
 */
router.post('/:id/toggle', async (req: Request, res: Response) => {
  try {
    const rule = await ruleService.getRuleById(req.params.id)
    if (!rule) {
      return res.status(404).json({ success: false, error: 'Rule not found' })
    }
    
    const newStatus = rule.status === 'active' ? 'paused' : 'active'
    const updated = await ruleService.updateRule(req.params.id, { status: newStatus })
    
    res.json({ success: true, data: updated })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router
