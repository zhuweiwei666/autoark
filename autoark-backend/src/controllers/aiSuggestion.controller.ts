import { Router, Request, Response } from 'express'
import { aiSuggestionService } from '../services/aiSuggestion.service'
import logger from '../utils/logger'
import { authenticate } from '../middlewares/auth'

const router = Router()

// 所有接口需要认证
router.use(authenticate)

/**
 * GET /api/ai-suggestions
 * 获取 AI 建议列表
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, limit, skip } = req.query
    const result = await aiSuggestionService.getSuggestions({
      status: status as string,
      limit: limit ? parseInt(limit as string) : 50,
      skip: skip ? parseInt(skip as string) : 0,
    })
    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[AiSuggestion] Get suggestions failed:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/ai-suggestions/pending
 * 获取待处理的建议
 */
router.get('/pending', async (req: Request, res: Response) => {
  try {
    const { priority, entityType, accountId, limit } = req.query
    const suggestions = await aiSuggestionService.getPendingSuggestions({
      priority: priority as any,
      entityType: entityType as string,
      accountId: accountId as string,
      limit: limit ? parseInt(limit as string) : 50,
    })
    res.json({ success: true, data: suggestions })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/ai-suggestions/stats
 * 获取统计信息
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await aiSuggestionService.getStats()
    res.json({ success: true, data: stats })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/ai-suggestions/generate
 * 手动触发生成建议
 */
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const suggestions = await aiSuggestionService.generateSuggestions()
    res.json({ 
      success: true, 
      data: suggestions,
      message: `Generated ${suggestions.length} new suggestions`
    })
  } catch (error: any) {
    logger.error('[AiSuggestion] Generate failed:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/ai-suggestions/:id/approve
 * 批准建议
 */
router.post('/:id/approve', async (req: Request, res: Response) => {
  try {
    const suggestion = await aiSuggestionService.approveSuggestion(
      req.params.id,
      req.user?.userId || 'unknown'
    )
    if (!suggestion) {
      return res.status(404).json({ success: false, error: 'Suggestion not found' })
    }
    res.json({ success: true, data: suggestion })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/ai-suggestions/:id/reject
 * 拒绝建议
 */
router.post('/:id/reject', async (req: Request, res: Response) => {
  try {
    const suggestion = await aiSuggestionService.rejectSuggestion(
      req.params.id,
      req.user?.userId || 'unknown'
    )
    if (!suggestion) {
      return res.status(404).json({ success: false, error: 'Suggestion not found' })
    }
    res.json({ success: true, data: suggestion })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/ai-suggestions/:id/execute
 * 执行单个建议
 */
router.post('/:id/execute', async (req: Request, res: Response) => {
  try {
    const suggestion = await aiSuggestionService.executeSuggestion(
      req.params.id,
      req.user?.userId || 'unknown'
    )
    res.json({ success: true, data: suggestion })
  } catch (error: any) {
    logger.error('[AiSuggestion] Execute failed:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/ai-suggestions/execute-batch
 * 批量执行建议
 */
router.post('/execute-batch', async (req: Request, res: Response) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'Please provide suggestion IDs' })
    }
    
    const result = await aiSuggestionService.executeBatch(
      ids,
      req.user?.userId || 'unknown'
    )
    
    res.json({ 
      success: true, 
      data: result,
      message: `Executed ${result.success} suggestions, ${result.failed} failed`
    })
  } catch (error: any) {
    logger.error('[AiSuggestion] Batch execute failed:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/ai-suggestions/cleanup
 * 清理过期建议
 */
router.post('/cleanup', async (req: Request, res: Response) => {
  try {
    const count = await aiSuggestionService.cleanupExpired()
    res.json({ success: true, data: { cleaned: count } })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router
