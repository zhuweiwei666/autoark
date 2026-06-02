import { Router, Request, Response } from 'express'
import dayjs from 'dayjs'
import logger from '../utils/logger'
import { authenticate, authorize } from '../middlewares/auth'
import { UserRole } from '../models/User'
import {
  aggregateMaterialMetrics,
  getMaterialRankings,
  getMaterialTrend,
  findDuplicateMaterials,
  getMaterialUsage,
  getRecommendedMaterials,
  getDecliningMaterials,
} from '../services/materialMetrics.service'
import { parseLimitedNumber } from '../utils/pagination'

const router = Router()
const MAX_BACKFILL_DAYS = 31
const MAX_RANKING_DAYS = 90
const DEFAULT_RANKING_LOOKBACK_DAYS = 7

const parseMaterialMetricsDate = (value: any) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = dayjs(value)
  return parsed.isValid() && parsed.format('YYYY-MM-DD') === value ? parsed : null
}

const resolveMaterialMetricsDateRange = (
  input: { startDate?: any; endDate?: any },
  options: { defaultLookbackDays: number; maxDays: number },
) => {
  const end = input.endDate === undefined
    ? dayjs()
    : parseMaterialMetricsDate(input.endDate)

  if (!end) {
    return {
      error: 'endDate must be a valid YYYY-MM-DD date',
    }
  }

  const start = input.startDate === undefined
    ? end.subtract(options.defaultLookbackDays, 'day')
    : parseMaterialMetricsDate(input.startDate)

  if (!start) {
    return {
      error: 'startDate must be a valid YYYY-MM-DD date',
    }
  }

  const dayCount = end.diff(start, 'day') + 1
  if (dayCount <= 0) {
    return {
      error: 'endDate must be on or after startDate',
    }
  }

  if (dayCount > options.maxDays) {
    return {
      error: `一次最多查询 ${options.maxDays} 天素材排行榜，请缩小日期范围`,
      meta: {
        requestedDays: dayCount,
        maxDays: options.maxDays,
      },
    }
  }

  return {
    startDate: start.format('YYYY-MM-DD'),
    endDate: end.format('YYYY-MM-DD'),
    dayCount,
  }
}

// 所有路由都需要认证
router.use(authenticate)
router.use(authorize(UserRole.SUPER_ADMIN))

// ==================== 素材排行榜 ====================

/**
 * 获取素材排行榜
 * GET /api/materials/rankings
 * Query: startDate, endDate, sortBy, limit, type, country
 */
router.get('/rankings', async (req: Request, res: Response) => {
  try {
    const {
      sortBy = 'roas',
      limit = '20',
      type,
      country,  // 🌍 新增：国家筛选
    } = req.query

    const dateRange = resolveMaterialMetricsDateRange(
      { startDate: req.query.startDate, endDate: req.query.endDate },
      { defaultLookbackDays: DEFAULT_RANKING_LOOKBACK_DAYS, maxDays: MAX_RANKING_DAYS },
    )

    if ('error' in dateRange) {
      return res.status(400).json({
        success: false,
        error: dateRange.error,
        meta: dateRange.meta,
      })
    }
    
    const safeLimit = parseLimitedNumber(limit, 20, 100)
    const rankings = await getMaterialRankings({
      dateRange: { start: dateRange.startDate, end: dateRange.endDate },
      sortBy: sortBy as any,
      limit: safeLimit,
      materialType: type as any,
      country: country as string,  // 🌍 传递国家参数
    })
    
    res.json({
      success: true,
      data: rankings,
      query: {
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        sortBy,
        limit: safeLimit,
        type,
        country,
      },
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
      parseLimitedNumber(days, 7, 90)
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
    const groupLimit = parseLimitedNumber(req.query.groupLimit ?? req.query.limit, 50, 100)
    const detailLimit = parseLimitedNumber(req.query.detailLimit, 25, 100)
    const duplicates = await findDuplicateMaterials({ groupLimit, detailLimit })
    
    res.json({
      success: true,
      data: duplicates,
      summary: {
        duplicateImages: duplicates.byImageHash.length,
        duplicateVideos: duplicates.byVideoId.length,
        groupLimit,
        detailLimit,
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
    
    const safeLimit = parseLimitedNumber(limit, 20, 100)
    const recommendations = await getRecommendedMaterials({
      type: type as any,
      minSpend: parseFloat(minSpend as string),
      minRoas: parseFloat(minRoas as string),
      minDays: parseInt(minDays as string, 10),
      limit: safeLimit,
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
    
    const safeLimit = parseLimitedNumber(limit, 20, 100)
    const declining = await getDecliningMaterials({
      minSpend: parseFloat(minSpend as string),
      declineThreshold: parseFloat(declineThreshold as string),
      limit: safeLimit,
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
    const requestedDate = req.body?.date || dayjs().format('YYYY-MM-DD')
    const aggregateDate = parseMaterialMetricsDate(requestedDate)
    if (!aggregateDate) {
      return res.status(400).json({
        success: false,
        error: 'date must be a valid YYYY-MM-DD date',
      })
    }
    const date = aggregateDate.format('YYYY-MM-DD')
    
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
    
    const start = parseMaterialMetricsDate(startDate)
    const end = parseMaterialMetricsDate(endDate)

    if (!start || !end) {
      return res.status(400).json({
        success: false,
        error: 'startDate and endDate must be valid YYYY-MM-DD dates',
      })
    }

    const dayCount = end.diff(start, 'day') + 1
    if (dayCount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'endDate must be on or after startDate',
      })
    }
    if (dayCount > MAX_BACKFILL_DAYS) {
      return res.status(400).json({
        success: false,
        error: `一次最多补 ${MAX_BACKFILL_DAYS} 天素材指标，请缩小日期范围`,
        meta: {
          requestedDays: dayCount,
          maxDays: MAX_BACKFILL_DAYS,
        },
      })
    }
    
    logger.info(`[MaterialController] Backfill triggered for ${startDate} to ${endDate}`)
    
    const results: Array<{ date: string; result: any }> = []
    let currentDate = start
    
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

// ==================== 素材下载功能已移除 ====================
// 所有素材从素材库上传，通过 Ad.materialId 精准归因
// 归因流程：素材库上传 → 创建广告(记录materialId) → 数据聚合(通过materialId精准归因)

export default router
