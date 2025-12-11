import { Router, Request, Response } from 'express'
import { materialAutoTestService } from '../services/materialAutoTest.service'
import logger from '../utils/logger'
import { authenticate } from '../middlewares/auth'

const router = Router()

// 所有接口需要认证
router.use(authenticate)

/**
 * GET /api/material-auto-test/configs
 * 获取所有自动测试配置
 */
router.get('/configs', async (req: Request, res: Response) => {
  try {
    const configs = await materialAutoTestService.getConfigs()
    res.json({ success: true, data: configs })
  } catch (error: any) {
    logger.error('[MaterialAutoTest] Get configs failed:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/material-auto-test/configs/:id
 * 获取单个配置
 */
router.get('/configs/:id', async (req: Request, res: Response) => {
  try {
    const config = await materialAutoTestService.getConfigById(req.params.id)
    if (!config) {
      return res.status(404).json({ success: false, error: 'Config not found' })
    }
    res.json({ success: true, data: config })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/material-auto-test/configs
 * 创建配置
 */
router.post('/configs', async (req: Request, res: Response) => {
  try {
    const data = {
      ...req.body,
      createdBy: req.user?.userId || 'unknown',
    }
    const config = await materialAutoTestService.createConfig(data)
    res.status(201).json({ success: true, data: config })
  } catch (error: any) {
    logger.error('[MaterialAutoTest] Create config failed:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/material-auto-test/configs/:id
 * 更新配置
 */
router.put('/configs/:id', async (req: Request, res: Response) => {
  try {
    const config = await materialAutoTestService.updateConfig(req.params.id, req.body)
    if (!config) {
      return res.status(404).json({ success: false, error: 'Config not found' })
    }
    res.json({ success: true, data: config })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * DELETE /api/material-auto-test/configs/:id
 * 删除配置
 */
router.delete('/configs/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await materialAutoTestService.deleteConfig(req.params.id)
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Config not found' })
    }
    res.json({ success: true, message: 'Config deleted' })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/material-auto-test/configs/:id/toggle
 * 启用/禁用配置
 */
router.post('/configs/:id/toggle', async (req: Request, res: Response) => {
  try {
    const config = await materialAutoTestService.getConfigById(req.params.id)
    if (!config) {
      return res.status(404).json({ success: false, error: 'Config not found' })
    }
    
    const updated = await materialAutoTestService.updateConfig(req.params.id, {
      enabled: !config.enabled,
    })
    
    res.json({ success: true, data: updated })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/material-auto-test/test/:materialId
 * 手动为素材创建测试广告
 */
router.post('/test/:materialId', async (req: Request, res: Response) => {
  try {
    const { configId } = req.body
    const result = await materialAutoTestService.createTestAd(req.params.materialId, configId)
    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[MaterialAutoTest] Create test ad failed:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/material-auto-test/check
 * 手动触发检查新素材
 */
router.post('/check', async (req: Request, res: Response) => {
  try {
    await materialAutoTestService.checkNewMaterials()
    res.json({ success: true, message: 'Check completed' })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router
