import { Router, Request, Response } from 'express'
import dayjs from 'dayjs'
import logger from '../utils/logger'
import {
  aggregateMaterialMetrics,
  getMaterialRankings,
  getMaterialTrend,
  findDuplicateMaterials,
  getMaterialUsage,
  getRecommendedMaterials,
  getDecliningMaterials,
} from '../services/materialMetrics.service'

const router = Router()

// ==================== 素材排行榜 ====================

/**
 * 获取素材排行榜
 * GET /api/materials/rankings
 * Query: startDate, endDate, sortBy, limit, type
 */
router.get('/rankings', async (req: Request, res: Response) => {
  try {
    const {
      startDate = dayjs().subtract(7, 'day').format('YYYY-MM-DD'),
      endDate = dayjs().format('YYYY-MM-DD'),
      sortBy = 'roas',
      limit = '20',
      type,
    } = req.query
    
    const rankings = await getMaterialRankings({
      dateRange: { start: startDate as string, end: endDate as string },
      sortBy: sortBy as any,
      limit: parseInt(limit as string, 10),
      materialType: type as any,
    })
    
    res.json({
      success: true,
      data: rankings,
      query: { startDate, endDate, sortBy, limit, type },
    })
  } catch (error: any) {
    logger.error('[MaterialController] Get rankings failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== 素材趋势 ====================

/**
 * 获取单个素材的历史趋势
 * GET /api/materials/trend
 * Query: imageHash, videoId, days
 */
router.get('/trend', async (req: Request, res: Response) => {
  try {
    const { imageHash, videoId, days = '7' } = req.query
    
    if (!imageHash && !videoId) {
      return res.status(400).json({
        success: false,
        error: 'Either imageHash or videoId is required',
      })
    }
    
    const trend = await getMaterialTrend(
      { imageHash: imageHash as string, videoId: videoId as string },
      parseInt(days as string, 10)
    )
    
    res.json({ success: true, data: trend })
  } catch (error: any) {
    logger.error('[MaterialController] Get trend failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== 素材去重 ====================

/**
 * 查找重复素材
 * GET /api/materials/duplicates
 */
router.get('/duplicates', async (req: Request, res: Response) => {
  try {
    const duplicates = await findDuplicateMaterials()
    
    res.json({
      success: true,
      data: duplicates,
      summary: {
        duplicateImages: duplicates.byImageHash.length,
        duplicateVideos: duplicates.byVideoId.length,
      },
    })
  } catch (error: any) {
    logger.error('[MaterialController] Find duplicates failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * 获取素材使用情况
 * GET /api/materials/usage
 * Query: imageHash, videoId, creativeId
 */
router.get('/usage', async (req: Request, res: Response) => {
  try {
    const { imageHash, videoId, creativeId } = req.query
    
    if (!imageHash && !videoId && !creativeId) {
      return res.status(400).json({
        success: false,
        error: 'At least one of imageHash, videoId, or creativeId is required',
      })
    }
    
    const usage = await getMaterialUsage({
      imageHash: imageHash as string,
      videoId: videoId as string,
      creativeId: creativeId as string,
    })
    
    res.json({ success: true, data: usage })
  } catch (error: any) {
    logger.error('[MaterialController] Get usage failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== 素材推荐 ====================

/**
 * 获取推荐素材
 * GET /api/materials/recommendations
 * Query: type, minSpend, minRoas, minDays, limit
 */
router.get('/recommendations', async (req: Request, res: Response) => {
  try {
    const {
      type,
      minSpend = '50',
      minRoas = '1.0',
      minDays = '3',
      limit = '20',
    } = req.query
    
    const recommendations = await getRecommendedMaterials({
      type: type as any,
      minSpend: parseFloat(minSpend as string),
      minRoas: parseFloat(minRoas as string),
      minDays: parseInt(minDays as string, 10),
      limit: parseInt(limit as string, 10),
    })
    
    res.json({ success: true, data: recommendations })
  } catch (error: any) {
    logger.error('[MaterialController] Get recommendations failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * 获取表现下滑的素材（预警）
 * GET /api/materials/declining
 * Query: minSpend, declineThreshold, limit
 */
router.get('/declining', async (req: Request, res: Response) => {
  try {
    const {
      minSpend = '30',
      declineThreshold = '30',
      limit = '20',
    } = req.query
    
    const declining = await getDecliningMaterials({
      minSpend: parseFloat(minSpend as string),
      declineThreshold: parseFloat(declineThreshold as string),
      limit: parseInt(limit as string, 10),
    })
    
    res.json({ success: true, data: declining })
  } catch (error: any) {
    logger.error('[MaterialController] Get declining failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== 手动聚合 ====================

/**
 * 手动触发素材指标聚合
 * POST /api/materials/aggregate
 * Body: { date?: string }
 */
router.post('/aggregate', async (req: Request, res: Response) => {
  try {
    const { date = dayjs().format('YYYY-MM-DD') } = req.body
    
    logger.info(`[MaterialController] Manual aggregation triggered for ${date}`)
    const result = await aggregateMaterialMetrics(date)
    
    res.json({
      success: true,
      data: result,
      message: `Aggregated material metrics for ${date}`,
    })
  } catch (error: any) {
    logger.error('[MaterialController] Aggregation failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * 批量补数据
 * POST /api/materials/backfill
 * Body: { startDate: string, endDate: string }
 */
router.post('/backfill', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.body
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate and endDate are required',
      })
    }
    
    logger.info(`[MaterialController] Backfill triggered for ${startDate} to ${endDate}`)
    
    const results: Array<{ date: string; result: any }> = []
    let currentDate = dayjs(startDate)
    const end = dayjs(endDate)
    
    while (currentDate.isBefore(end) || currentDate.isSame(end, 'day')) {
      const dateStr = currentDate.format('YYYY-MM-DD')
      try {
        const result = await aggregateMaterialMetrics(dateStr)
        results.push({ date: dateStr, result })
      } catch (err: any) {
        results.push({ date: dateStr, result: { error: err.message } })
      }
      currentDate = currentDate.add(1, 'day')
    }
    
    res.json({
      success: true,
      data: results,
      summary: {
        daysProcessed: results.length,
        successCount: results.filter(r => !r.result.error).length,
        errorCount: results.filter(r => r.result.error).length,
      },
    })
  } catch (error: any) {
    logger.error('[MaterialController] Backfill failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router
