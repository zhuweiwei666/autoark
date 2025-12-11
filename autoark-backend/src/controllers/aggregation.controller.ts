/**
 * 📊 预聚合数据 API
 * 
 * 统一的数据接口，前端和 AI 都从这里获取数据
 */

import { Router, Request, Response } from 'express'
import dayjs from 'dayjs'
import logger from '../utils/logger'
import {
  getDailySummary,
  getCountryData,
  getAccountData,
  getCampaignData,
  getOptimizerData,
  getMaterialData,
  refreshRecentDays,
  refreshAggregation,
} from '../services/aggregation.service'
import {
  AggDaily,
  AggCountry,
  AggAccount,
  AggCampaign,
  AggOptimizer,
  AggMaterial,
} from '../models/Aggregation'

const router = Router()

// ==================== Dashboard 汇总 ====================

/**
 * GET /api/agg/daily
 * 获取每日汇总数据
 */
router.get('/daily', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query
    const end = (endDate as string) || dayjs().format('YYYY-MM-DD')
    const start = (startDate as string) || dayjs().subtract(7, 'day').format('YYYY-MM-DD')

    const data = await getDailySummary(start, end)

    res.json({
      success: true,
      data,
      meta: { startDate: start, endDate: end, count: data.length },
    })
  } catch (error: any) {
    logger.error('[AggController] Get daily failed:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/agg/today
 * 获取今日实时数据
 */
router.get('/today', async (req: Request, res: Response) => {
  try {
    const today = dayjs().format('YYYY-MM-DD')
    await refreshAggregation(today)
    
    const data = await AggDaily.findOne({ date: today }).lean()

    res.json({
      success: true,
      data: data || { date: today, spend: 0, revenue: 0, roas: 0 },
    })
  } catch (error: any) {
    logger.error('[AggController] Get today failed:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== 国家数据 ====================

/**
 * GET /api/agg/countries
 * 获取分国家数据
 */
router.get('/countries', async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || dayjs().format('YYYY-MM-DD')
    const data = await getCountryData(date)

    res.json({
      success: true,
      data,
      meta: { date, count: data.length },
    })
  } catch (error: any) {
    logger.error('[AggController] Get countries failed:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/agg/countries/trend
 * 获取国家趋势（最近 7 天）
 */
router.get('/countries/trend', async (req: Request, res: Response) => {
  try {
    const { country } = req.query
    const endDate = dayjs().format('YYYY-MM-DD')
    const startDate = dayjs().subtract(7, 'day').format('YYYY-MM-DD')

    const query: any = { date: { $gte: startDate, $lte: endDate } }
    if (country) query.country = country

    const data = await AggCountry.find(query).sort({ date: 1 }).lean()

    res.json({
      success: true,
      data,
      meta: { startDate, endDate, count: data.length },
    })
  } catch (error: any) {
    logger.error('[AggController] Get country trend failed:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== 账户数据 ====================

/**
 * GET /api/agg/accounts
 * 获取分账户数据
 */
router.get('/accounts', async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || dayjs().format('YYYY-MM-DD')
    const data = await getAccountData(date)

    res.json({
      success: true,
      data,
      meta: { date, count: data.length },
    })
  } catch (error: any) {
    logger.error('[AggController] Get accounts failed:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== 广告系列数据 ====================

/**
 * GET /api/agg/campaigns
 * 获取广告系列数据
 */
router.get('/campaigns', async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || dayjs().format('YYYY-MM-DD')
    const { optimizer, accountId } = req.query

    const data = await getCampaignData(date, {
      optimizer: optimizer as string,
      accountId: accountId as string,
    })

    res.json({
      success: true,
      data,
      meta: { date, count: data.length },
    })
  } catch (error: any) {
    logger.error('[AggController] Get campaigns failed:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/agg/campaigns/trend
 * 获取广告系列趋势
 */
router.get('/campaigns/trend', async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.query
    const endDate = dayjs().format('YYYY-MM-DD')
    const startDate = dayjs().subtract(7, 'day').format('YYYY-MM-DD')

    const query: any = { date: { $gte: startDate, $lte: endDate } }
    if (campaignId) query.campaignId = campaignId

    const data = await AggCampaign.find(query).sort({ date: 1 }).lean()

    res.json({
      success: true,
      data,
      meta: { startDate, endDate, count: data.length },
    })
  } catch (error: any) {
    logger.error('[AggController] Get campaign trend failed:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== 投手数据 ====================

/**
 * GET /api/agg/optimizers
 * 获取分投手数据
 */
router.get('/optimizers', async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || dayjs().format('YYYY-MM-DD')
    const data = await getOptimizerData(date)

    res.json({
      success: true,
      data,
      meta: { date, count: data.length },
    })
  } catch (error: any) {
    logger.error('[AggController] Get optimizers failed:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/agg/optimizers/trend
 * 获取投手趋势
 */
router.get('/optimizers/trend', async (req: Request, res: Response) => {
  try {
    const { optimizer } = req.query
    const endDate = dayjs().format('YYYY-MM-DD')
    const startDate = dayjs().subtract(7, 'day').format('YYYY-MM-DD')

    const query: any = { date: { $gte: startDate, $lte: endDate } }
    if (optimizer) query.optimizer = optimizer

    const data = await AggOptimizer.find(query).sort({ date: 1 }).lean()

    res.json({
      success: true,
      data,
      meta: { startDate, endDate, count: data.length },
    })
  } catch (error: any) {
    logger.error('[AggController] Get optimizer trend failed:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== 素材数据 ====================

/**
 * GET /api/agg/materials
 * 获取素材数据
 */
router.get('/materials', async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || dayjs().format('YYYY-MM-DD')
    const data = await getMaterialData(date)

    res.json({
      success: true,
      data,
      meta: { date, count: data.length },
    })
  } catch (error: any) {
    logger.error('[AggController] Get materials failed:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== 手动刷新 ====================

/**
 * POST /api/agg/refresh
 * 手动刷新数据
 */
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { date } = req.body
    
    if (date) {
      await refreshAggregation(date, true)
      res.json({ success: true, message: `Refreshed ${date}` })
    } else {
      await refreshRecentDays()
      res.json({ success: true, message: 'Refreshed recent 3 days' })
    }
  } catch (error: any) {
    logger.error('[AggController] Refresh failed:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== AI 数据接口 ====================

/**
 * GET /api/agg/ai/snapshot
 * 获取 AI 使用的数据快照（所有维度）
 */
router.get('/ai/snapshot', async (req: Request, res: Response) => {
  try {
    const today = dayjs().format('YYYY-MM-DD')
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
    const sevenDaysAgo = dayjs().subtract(7, 'day').format('YYYY-MM-DD')

    // 刷新最近数据
    await refreshRecentDays()

    // 并行获取所有数据
    const [
      todaySummary,
      yesterdaySummary,
      weekTrend,
      countries,
      accounts,
      campaigns,
      optimizers,
    ] = await Promise.all([
      AggDaily.findOne({ date: today }).lean(),
      AggDaily.findOne({ date: yesterday }).lean(),
      AggDaily.find({ date: { $gte: sevenDaysAgo } }).sort({ date: 1 }).lean(),
      AggCountry.find({ date: today }).sort({ spend: -1 }).limit(15).lean(),
      AggAccount.find({ date: today }).sort({ spend: -1 }).lean(),
      AggCampaign.find({ date: today, spend: { $gt: 1 } }).sort({ spend: -1 }).limit(50).lean(),
      AggOptimizer.find({ date: today }).sort({ spend: -1 }).lean(),
    ])

    // 计算对比
    const todaySpend = todaySummary?.spend || 0
    const yesterdaySpend = yesterdaySummary?.spend || 0
    const spendChange = yesterdaySpend > 0 ? ((todaySpend - yesterdaySpend) / yesterdaySpend * 100).toFixed(1) + '%' : 'N/A'

    res.json({
      success: true,
      data: {
        dataTime: dayjs().format('YYYY-MM-DD HH:mm:ss'),
        today: todaySummary || { spend: 0, revenue: 0, roas: 0 },
        yesterday: yesterdaySummary || { spend: 0, revenue: 0, roas: 0 },
        comparison: { spendChange },
        weekTrend,
        countries,
        accounts,
        campaigns,
        optimizers,
      },
    })
  } catch (error: any) {
    logger.error('[AggController] Get AI snapshot failed:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router
