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
} from '../models/Aggregation'
import { authenticate, getUserAccountIds } from '../middlewares/auth'
import { UserRole } from '../models/User'
import { getAccountIdsForQuery, normalizeForStorage } from '../utils/accountId'
import { parseLimitedNumber, pickSafeQueryString } from '../utils/pagination'

const router = Router()

router.use(authenticate)

const AGG_MAX_RANGE_DAYS = 90
const AGG_MAX_ROWS = 500
const AGG_FILTER_MAX_LENGTH = 120
const AGG_COUNTRY_MAX_LENGTH = 40

const parseAggLimit = (value: any, fallback = 200) => parseLimitedNumber(value, fallback, AGG_MAX_ROWS)
const parseAggTrendLimit = (value: any) => parseLimitedNumber(value, 500, AGG_MAX_ROWS)
const pickAggFilter = (value: any, maxLength = AGG_FILTER_MAX_LENGTH) => pickSafeQueryString(value, maxLength)

class AggDateError extends Error {}

const parseStrictAggDate = (value: any, fieldName: string) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AggDateError(`${fieldName} must be a valid YYYY-MM-DD date`)
  }
  const parsed = dayjs(value)
  if (!parsed.isValid() || parsed.format('YYYY-MM-DD') !== value) {
    throw new AggDateError(`${fieldName} must be a valid YYYY-MM-DD date`)
  }
  return parsed
}

const getDate = (value: any, fallback: dayjs.Dayjs, fieldName: string) => {
  if (typeof value !== 'string') return fallback
  return parseStrictAggDate(value, fieldName)
}

const parseAggSingleDate = (value: any, fieldName = 'date') => {
  if (value === undefined || value === null || value === '') return dayjs().format('YYYY-MM-DD')
  return parseStrictAggDate(value, fieldName).format('YYYY-MM-DD')
}

const parseAggDateRange = (req: Request, fallbackDays = 7) => {
  const fallbackEnd = dayjs()
  const end = getDate(req.query.endDate, fallbackEnd, 'endDate')
  const requestedStart = getDate(req.query.startDate, end.subtract(fallbackDays, 'day'), 'startDate')
  if (requestedStart.isAfter(end)) {
    throw new AggDateError('startDate must be earlier than or equal to endDate')
  }
  const maxStart = end.subtract(AGG_MAX_RANGE_DAYS - 1, 'day')
  const start = requestedStart.isBefore(maxStart)
      ? maxStart
      : requestedStart

  return {
    start: start.format('YYYY-MM-DD'),
    end: end.format('YYYY-MM-DD'),
  }
}

const sendAggregationError = (res: Response, error: any, logPrefix: string) => {
  logger.error(`${logPrefix}: ${error.message}`)
  const status = error instanceof AggDateError ? 400 : 500
  res.status(status).json({ success: false, error: error.message })
}

const getAccountScope = async (req: Request): Promise<string[] | null> => {
  const accountIds = await getUserAccountIds(req)
  return accountIds === null ? null : getAccountIdsForQuery(accountIds)
}

const hasScopedAccountAccess = (accountIds: string[] | null, accountId: string): boolean => {
  if (accountIds === null) return true
  const requested = normalizeForStorage(accountId)
  return accountIds.some(id => normalizeForStorage(id) === requested)
}

const aggregateDailyFromAccounts = async (start: string, end: string, accountIds: string[]) => {
  const rows = await AggAccount.find({
    date: { $gte: start, $lte: end },
    accountId: { $in: accountIds },
  }).lean()

  const byDate = new Map<string, any>()
  for (const row of rows) {
    const current = byDate.get(row.date) || {
      date: row.date,
      spend: 0,
      revenue: 0,
      impressions: 0,
      clicks: 0,
      installs: 0,
      activeAccounts: new Set<string>(),
      activeCampaigns: 0,
    }
    current.spend += row.spend || 0
    current.revenue += row.revenue || 0
    current.impressions += row.impressions || 0
    current.clicks += row.clicks || 0
    current.installs += row.installs || 0
    current.activeCampaigns += row.campaigns || 0
    if ((row.spend || 0) > 0) current.activeAccounts.add(row.accountId)
    byDate.set(row.date, current)
  }

  return Array.from(byDate.values()).map(row => ({
    ...row,
    activeAccounts: row.activeAccounts.size,
    roas: row.spend > 0 ? row.revenue / row.spend : 0,
    ctr: row.impressions > 0 ? row.clicks / row.impressions : 0,
    cpi: row.installs > 0 ? row.spend / row.installs : 0,
  })).sort((a, b) => a.date.localeCompare(b.date))
}

const requireSuperAdmin = (req: Request, res: Response): boolean => {
  if (req.user?.role === UserRole.SUPER_ADMIN) return true
  res.status(403).json({ success: false, error: '只有超级管理员可以访问全局聚合数据' })
  return false
}

// ==================== Dashboard 汇总 ====================

/**
 * GET /api/agg/daily
 * 获取每日汇总数据
 */
router.get('/daily', async (req: Request, res: Response) => {
  try {
    const { start, end } = parseAggDateRange(req, 7)

    const accountIds = await getAccountScope(req)
    const data = accountIds === null
      ? await getDailySummary(start, end)
      : await aggregateDailyFromAccounts(start, end, accountIds)

    res.json({
      success: true,
      data,
      meta: { startDate: start, endDate: end, count: data.length },
    })
  } catch (error: any) {
    sendAggregationError(res, error, '[AggController] Get daily failed')
  }
})

/**
 * GET /api/agg/today
 * 获取今日数据（直接从数据库读取，超快）
 */
router.get('/today', async (req: Request, res: Response) => {
  try {
    const today = dayjs().format('YYYY-MM-DD')
    const accountIds = await getAccountScope(req)
    const data = accountIds === null
      ? await AggDaily.findOne({ date: today }).lean()
      : (await aggregateDailyFromAccounts(today, today, accountIds))[0]

    res.json({
      success: true,
      data: data || { date: today, spend: 0, revenue: 0, roas: 0 },
    })
  } catch (error: any) {
    sendAggregationError(res, error, '[AggController] Get today failed')
  }
})

// ==================== 国家数据 ====================

/**
 * GET /api/agg/countries
 * 获取分国家数据
 */
router.get('/countries', async (req: Request, res: Response) => {
  try {
    const date = parseAggSingleDate(req.query.date)
    const limit = parseAggLimit(req.query.limit)
    const accountIds = await getAccountScope(req)
    const data = accountIds === null ? await getCountryData(date, limit) : []

    res.json({
      success: true,
      data,
      meta: { date, count: data.length, limit },
    })
  } catch (error: any) {
    sendAggregationError(res, error, '[AggController] Get countries failed')
  }
})

/**
 * GET /api/agg/countries/trend
 * 获取国家趋势（最近 7 天）
 */
router.get('/countries/trend', async (req: Request, res: Response) => {
  try {
    const country = pickAggFilter(req.query.country, AGG_COUNTRY_MAX_LENGTH)
    const endDate = dayjs().format('YYYY-MM-DD')
    const startDate = dayjs().subtract(7, 'day').format('YYYY-MM-DD')

    const query: any = { date: { $gte: startDate, $lte: endDate } }
    if (country) query.country = country

    const accountIds = await getAccountScope(req)
    const data = accountIds === null ? await AggCountry.find(query).sort({ date: 1 }).lean() : []

    res.json({
      success: true,
      data,
      meta: { startDate, endDate, count: data.length },
    })
  } catch (error: any) {
    sendAggregationError(res, error, '[AggController] Get country trend failed')
  }
})

// ==================== 账户数据 ====================

/**
 * GET /api/agg/accounts
 * 获取分账户数据
 */
router.get('/accounts', async (req: Request, res: Response) => {
  try {
    const date = parseAggSingleDate(req.query.date)
    const limit = parseAggLimit(req.query.limit)
    const accountIds = await getAccountScope(req)
    const data = accountIds === null
      ? await getAccountData(date, limit)
      : await AggAccount.find({ date, accountId: { $in: accountIds } }).sort({ spend: -1 }).limit(limit).lean()

    res.json({
      success: true,
      data,
      meta: { date, count: data.length, limit },
    })
  } catch (error: any) {
    sendAggregationError(res, error, '[AggController] Get accounts failed')
  }
})

// ==================== 广告系列数据 ====================

/**
 * GET /api/agg/campaigns
 * 获取广告系列数据
 */
router.get('/campaigns', async (req: Request, res: Response) => {
  try {
    const date = parseAggSingleDate(req.query.date)
    const limit = parseAggLimit(req.query.limit)
    const optimizerFilter = pickAggFilter(req.query.optimizer)

    const accountIds = await getAccountScope(req)
    const requestedAccountId = pickAggFilter(req.query.accountId)
    if (requestedAccountId && !hasScopedAccountAccess(accountIds, requestedAccountId)) {
      return res.json({
        success: true,
        data: [],
        meta: { date, count: 0, limit },
      })
    }

    const scopedAccountIdQuery = requestedAccountId && hasScopedAccountAccess(accountIds, requestedAccountId)
      ? { $in: getAccountIdsForQuery([requestedAccountId]) }
      : undefined
    const accountIdFilter = accountIds === null
      ? scopedAccountIdQuery
      : scopedAccountIdQuery
        ? scopedAccountIdQuery
        : undefined
    const data = accountIds === null && !accountIdFilter
      ? await getCampaignData(date, {
          optimizer: optimizerFilter,
          limit,
        })
      : await AggCampaign.find({
          date,
          ...(optimizerFilter ? { optimizer: optimizerFilter } : {}),
          accountId: accountIdFilter ? accountIdFilter : { $in: accountIds },
        }).sort({ spend: -1 }).limit(limit).lean()

    res.json({
      success: true,
      data,
      meta: { date, count: data.length, limit },
    })
  } catch (error: any) {
    sendAggregationError(res, error, '[AggController] Get campaigns failed')
  }
})

/**
 * GET /api/agg/campaigns/trend
 * 获取广告系列趋势
 */
router.get('/campaigns/trend', async (req: Request, res: Response) => {
  try {
    const campaignId = pickAggFilter(req.query.campaignId)
    const limit = parseAggTrendLimit(req.query.limit)
    const endDate = dayjs().format('YYYY-MM-DD')
    const startDate = dayjs().subtract(7, 'day').format('YYYY-MM-DD')

    const query: any = { date: { $gte: startDate, $lte: endDate } }
    if (campaignId) query.campaignId = campaignId
    const accountIds = await getAccountScope(req)
    if (accountIds !== null) query.accountId = { $in: accountIds }

    const queryBuilder = AggCampaign.find(query).sort({ date: 1, spend: -1 })
    const data = campaignId
      ? await queryBuilder.lean()
      : await queryBuilder.limit(limit).lean()

    res.json({
      success: true,
      data,
      meta: { startDate, endDate, count: data.length, limit: campaignId ? null : limit },
    })
  } catch (error: any) {
    sendAggregationError(res, error, '[AggController] Get campaign trend failed')
  }
})

// ==================== 投手数据 ====================

/**
 * GET /api/agg/optimizers
 * 获取分投手数据
 */
router.get('/optimizers', async (req: Request, res: Response) => {
  try {
    const date = parseAggSingleDate(req.query.date)
    const limit = parseAggLimit(req.query.limit)
    const accountIds = await getAccountScope(req)
    const data = accountIds === null
      ? await getOptimizerData(date, limit)
      : await AggCampaign.aggregate([
          { $match: { date, accountId: { $in: accountIds } } },
          { $group: { _id: '$optimizer', spend: { $sum: '$spend' }, revenue: { $sum: '$revenue' }, campaigns: { $sum: 1 } } },
          { $project: { optimizer: '$_id', spend: 1, revenue: 1, roas: { $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$revenue', '$spend'] }, 0] }, campaigns: 1 } },
          { $sort: { spend: -1 } },
          { $limit: limit },
        ])

    res.json({
      success: true,
      data,
      meta: { date, count: data.length, limit },
    })
  } catch (error: any) {
    sendAggregationError(res, error, '[AggController] Get optimizers failed')
  }
})

/**
 * GET /api/agg/optimizers/trend
 * 获取投手趋势
 */
router.get('/optimizers/trend', async (req: Request, res: Response) => {
  try {
    const optimizer = pickAggFilter(req.query.optimizer)
    const limit = parseAggTrendLimit(req.query.limit)
    const endDate = dayjs().format('YYYY-MM-DD')
    const startDate = dayjs().subtract(7, 'day').format('YYYY-MM-DD')

    const query: any = { date: { $gte: startDate, $lte: endDate } }
    if (optimizer) query.optimizer = optimizer
    const accountIds = await getAccountScope(req)
    const data = accountIds === null
      ? optimizer
        ? await AggOptimizer.find(query).sort({ date: 1 }).lean()
        : await AggOptimizer.find(query).sort({ date: 1, spend: -1 }).limit(limit).lean()
      : await AggCampaign.aggregate([
          { $match: { ...query, accountId: { $in: accountIds } } },
          { $group: { _id: { date: '$date', optimizer: '$optimizer' }, spend: { $sum: '$spend' }, revenue: { $sum: '$revenue' }, campaigns: { $sum: 1 } } },
          { $project: { date: '$_id.date', optimizer: '$_id.optimizer', spend: 1, revenue: 1, roas: { $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$revenue', '$spend'] }, 0] }, campaigns: 1 } },
          { $sort: { date: 1, spend: -1 } },
          ...(!optimizer ? [{ $limit: limit }] : []),
        ])

    res.json({
      success: true,
      data,
      meta: { startDate, endDate, count: data.length, limit: optimizer ? null : limit },
    })
  } catch (error: any) {
    sendAggregationError(res, error, '[AggController] Get optimizer trend failed')
  }
})

// ==================== 素材数据 ====================

/**
 * GET /api/agg/materials
 * 获取素材数据
 */
router.get('/materials', async (req: Request, res: Response) => {
  try {
    const date = parseAggSingleDate(req.query.date)
    const accountIds = await getAccountScope(req)
    const data = accountIds === null ? await getMaterialData(date) : []

    res.json({
      success: true,
      data,
      meta: { date, count: data.length },
    })
  } catch (error: any) {
    sendAggregationError(res, error, '[AggController] Get materials failed')
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
    if (!requireSuperAdmin(req, res)) return
    
    if (date) {
      const refreshDate = parseAggSingleDate(date)
      await refreshAggregation(refreshDate, true)
      res.json({ success: true, message: `Refreshed ${refreshDate}` })
    } else {
      await refreshRecentDays()
      res.json({ success: true, message: 'Refreshed recent 3 days' })
    }
  } catch (error: any) {
    sendAggregationError(res, error, '[AggController] Refresh failed')
  }
})

// ==================== AI 数据接口 ====================

/**
 * GET /api/agg/ai/snapshot
 * 获取 AI 使用的数据快照（所有维度）
 * 🚀 直接读取，不刷新
 */
router.get('/ai/snapshot', async (req: Request, res: Response) => {
  try {
    const today = dayjs().format('YYYY-MM-DD')
    if (!requireSuperAdmin(req, res)) return
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
    const sevenDaysAgo = dayjs().subtract(7, 'day').format('YYYY-MM-DD')

    // 并行获取所有数据（直接从数据库读取）
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
