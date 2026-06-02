/**
 * 📊 Summary Controller - 使用预聚合表提供极速数据访问
 * 
 * 架构设计：
 * - 前端请求 → 直接读取预聚合表（MongoDB）
 * - 定时任务（每10分钟）→ 从 Facebook API 刷新数据到预聚合表
 * - 前端请求不再触发 Facebook API 调用
 */

import { Router, Request, Response } from 'express'
import dayjs from 'dayjs'
import logger from '../utils/logger'
import {
  AggDaily,
  AggCountry,
  AggAccount,
  AggCampaign,
  AggOptimizer,
} from '../models/Aggregation'
import MaterialMetrics from '../models/MaterialMetrics'
import { refreshRecentDays } from '../services/aggregation.service'
import { UserRole } from '../models/User'
import { getUserAccountIds, authenticate } from '../middlewares/auth'
import { getAccountIdsForQuery, normalizeForStorage } from '../utils/accountId'
import {
  parseLimitedNumber,
  parsePagination,
  pickAllowedString,
  pickSafeQueryString,
  pickSafeRegexLiteral,
} from '../utils/pagination'

const router = Router()

// 所有路由需要认证
router.use(authenticate)

const requireSuperAdmin = (req: Request, res: Response): boolean => {
  if (req.user?.role === UserRole.SUPER_ADMIN) return true
  res.status(403).json({ success: false, error: '只有超级管理员可以访问全局聚合管理接口' })
  return false
}

const aggregateAccountDaily = async (startDate: string, endDate: string, accountIds: string[]) => {
  const rows = await AggAccount.find({
    date: { $gte: startDate, $lte: endDate },
    accountId: { $in: accountIds },
  }).lean()

  return rows.reduce((acc, row) => {
    acc.totalSpend += row.spend || 0
    acc.totalRevenue += row.revenue || 0
    acc.totalImpressions += row.impressions || 0
    acc.totalClicks += row.clicks || 0
    acc.totalInstalls += row.installs || 0
    acc.activeCampaigns += row.campaigns || 0
    if ((row.spend || 0) > 0) acc.activeAccountsSet.add(row.accountId)
    return acc
  }, {
    totalSpend: 0,
    totalRevenue: 0,
    totalImpressions: 0,
    totalClicks: 0,
    totalInstalls: 0,
    activeCampaigns: 0,
    activeAccountsSet: new Set<string>(),
  } as any)
}

const expandScopedAccountIds = (accountIds: string[] | null): string[] | null => {
  if (accountIds === null) return null
  return getAccountIdsForQuery(accountIds)
}

const hasScopedAccountAccess = (accountIds: string[] | null, accountId: string): boolean => {
  if (accountIds === null) return true
  const requested = normalizeForStorage(accountId)
  return accountIds.some(id => normalizeForStorage(id) === requested)
}

const SUMMARY_MAX_LIMIT = 100
const SUMMARY_MAX_TREND_DAYS = 90
const SUMMARY_MAX_RANGE_DAYS = 90
const SUMMARY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const ACCOUNT_SORT_FIELDS = [
  'accountId',
  'accountName',
  'campaigns',
  'clicks',
  'ctr',
  'impressions',
  'installs',
  'periodSpend',
  'purchase_value',
  'revenue',
  'roas',
  'spend',
  'status',
]
const COUNTRY_SORT_FIELDS = [
  'campaigns',
  'clicks',
  'country',
  'countryName',
  'ctr',
  'impressions',
  'installs',
  'purchase_roas',
  'purchase_value',
  'revenue',
  'roas',
  'spend',
]
const CAMPAIGN_SORT_FIELDS = [
  'accountId',
  'accountName',
  'campaignId',
  'campaignName',
  'clicks',
  'cpc',
  'cpi',
  'cpm',
  'ctr',
  'impressions',
  'installs',
  'mobile_app_install',
  'objective',
  'optimizer',
  'purchase_roas',
  'purchase_value',
  'revenue',
  'roas',
  'spend',
  'status',
]
const MATERIAL_SORT_FIELDS = [
  'adsCount',
  'campaignsCount',
  'clicks',
  'cpc',
  'cpi',
  'cpm',
  'ctr',
  'daysActive',
  'impressions',
  'installs',
  'purchases',
  'qualityScore',
  'revenue',
  'roas',
  'spend',
]

const parseSummaryPagination = (req: Request, defaultLimit: number) => {
  const { page, pageSize, skip } = parsePagination(
    { page: req.query.page, limit: req.query.limit },
    { defaultPageSize: defaultLimit, maxPageSize: SUMMARY_MAX_LIMIT },
  )
  return { page, limit: pageSize, skip }
}

class SummaryDateRangeError extends Error {
  statusCode = 400
}

const parseSummaryDate = (value: any, fieldName: string): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || !SUMMARY_DATE_PATTERN.test(value)) {
    throw new SummaryDateRangeError(`${fieldName} must be a valid YYYY-MM-DD date`)
  }

  const parsed = dayjs(value)
  if (!parsed.isValid() || parsed.format('YYYY-MM-DD') !== value) {
    throw new SummaryDateRangeError(`${fieldName} must be a valid YYYY-MM-DD date`)
  }

  return value
}

const parseSummaryDateRange = (
  req: Request,
  options: { defaultDays?: number } = {},
) => {
  const defaultDays = Math.max(1, options.defaultDays || 1)
  const today = dayjs().format('YYYY-MM-DD')
  const requestedDate = parseSummaryDate(req.query.date, 'date')
  const requestedStartDate = parseSummaryDate(req.query.startDate, 'startDate')
  const requestedEndDate = parseSummaryDate(req.query.endDate, 'endDate')

  const endDate = requestedEndDate || requestedDate || today
  let startDate = requestedStartDate || requestedDate
  if (!startDate) {
    startDate = dayjs(endDate).subtract(defaultDays - 1, 'day').format('YYYY-MM-DD')
  }

  const start = dayjs(startDate)
  const end = dayjs(endDate)
  if (start.isAfter(end)) {
    throw new SummaryDateRangeError('startDate must be earlier than or equal to endDate')
  }

  const requestedDays = end.diff(start, 'day') + 1
  const capped = requestedDays > SUMMARY_MAX_RANGE_DAYS
  if (capped) {
    startDate = end.subtract(SUMMARY_MAX_RANGE_DAYS - 1, 'day').format('YYYY-MM-DD')
  }

  return {
    date: requestedDate || endDate,
    startDate,
    endDate,
    requestedDays,
    capped,
  }
}

const sendSummaryDateRangeError = (res: Response, error: any) => {
  if (error instanceof SummaryDateRangeError) {
    res.status(error.statusCode).json({
      success: false,
      error: error.message,
      meta: { maxDays: SUMMARY_MAX_RANGE_DAYS },
    })
    return true
  }
  return false
}

// ==================== 仪表盘汇总 ====================

/**
 * 获取仪表盘汇总数据（从预聚合表读取）
 * GET /api/summary/dashboard
 * Query: date (可选，默认今天), startDate, endDate
 */
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const startTime = Date.now()
    const { date, startDate, endDate } = parseSummaryDateRange(req)

    const userAccountIds = await getUserAccountIds(req)
    const scopedAccountIds = expandScopedAccountIds(userAccountIds)

    // 汇总多日数据
    let totalSpend = 0
    let totalRevenue = 0
    let totalImpressions = 0
    let totalClicks = 0
    let totalInstalls = 0
    let activeCampaigns = 0
    let activeAccounts = 0

    if (scopedAccountIds === null) {
      // 从预聚合表读取
      const dailyData = await AggDaily.find({
        date: { $gte: startDate, $lte: endDate }
      }).lean()

      for (const day of dailyData) {
        totalSpend += day.spend || 0
        totalRevenue += day.revenue || 0
        totalImpressions += day.impressions || 0
        totalClicks += day.clicks || 0
        totalInstalls += day.installs || 0
        activeCampaigns = Math.max(activeCampaigns, day.activeCampaigns || 0)
        activeAccounts = Math.max(activeAccounts, day.activeAccounts || 0)
      }
    } else if (scopedAccountIds.length > 0) {
      const scoped = await aggregateAccountDaily(startDate, endDate, scopedAccountIds)
      totalSpend = scoped.totalSpend
      totalRevenue = scoped.totalRevenue
      totalImpressions = scoped.totalImpressions
      totalClicks = scoped.totalClicks
      totalInstalls = scoped.totalInstalls
      activeCampaigns = scoped.activeCampaigns
      activeAccounts = scoped.activeAccountsSet.size
    }

    // 计算派生指标
    const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0
    const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0
    const cpc = totalClicks > 0 ? totalSpend / totalClicks : 0
    const cpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0
    const cpi = totalInstalls > 0 ? totalSpend / totalInstalls : 0

    const duration = Date.now() - startTime
    logger.info(`[Summary] Dashboard query completed in ${duration}ms`)

    res.json({
      success: true,
      data: {
        date,
        totalSpend,
        totalRevenue,
        totalImpressions,
        totalClicks,
        totalInstalls,
        roas,
        ctr,
        cpc,
        cpm,
        cpi,
        activeCampaigns,
        activeAccounts,
      },
      cached: true,
      duration,
    })
  } catch (error: any) {
    if (sendSummaryDateRangeError(res, error)) return
    logger.error('[SummaryController] Get dashboard failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * 获取仪表盘趋势数据（最近N天）
 * GET /api/summary/dashboard/trend
 * Query: days (默认7)
 */
router.get('/dashboard/trend', async (req: Request, res: Response) => {
  try {
    const startTime = Date.now()
    const days = parseLimitedNumber(req.query.days, 7, SUMMARY_MAX_TREND_DAYS)
    const endDate = dayjs().format('YYYY-MM-DD')
    const startDate = dayjs().subtract(days - 1, 'day').format('YYYY-MM-DD')

    const userAccountIds = await getUserAccountIds(req)
    const scopedAccountIds = expandScopedAccountIds(userAccountIds)
    const dailyData = scopedAccountIds === null
      ? await AggDaily.find({
          date: { $gte: startDate, $lte: endDate }
        }).sort({ date: 1 }).lean()
      : await AggAccount.aggregate([
          { $match: { date: { $gte: startDate, $lte: endDate }, accountId: { $in: scopedAccountIds } } },
          { $group: { _id: '$date', spend: { $sum: '$spend' }, revenue: { $sum: '$revenue' }, impressions: { $sum: '$impressions' }, clicks: { $sum: '$clicks' } } },
          { $project: { date: '$_id', spend: 1, revenue: 1, impressions: 1, clicks: 1, roas: { $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$revenue', '$spend'] }, 0] } } },
          { $sort: { date: 1 } },
        ])

    // 生成完整日期数组（填充缺失日期）
    const dateMap = new Map<string, any>()
    for (const day of dailyData) {
      dateMap.set(day.date, day)
    }

    const trendData: any[] = []
    for (let i = 0; i < days; i++) {
      const date = dayjs().subtract(days - 1 - i, 'day').format('YYYY-MM-DD')
      const data = dateMap.get(date)
      trendData.push({
        date,
        totalSpend: data?.spend || 0,
        totalRevenue: data?.revenue || 0,
        totalImpressions: data?.impressions || 0,
        totalClicks: data?.clicks || 0,
        roas: data?.roas || 0,
      })
    }

    const duration = Date.now() - startTime
    logger.info(`[Summary] Dashboard trend query completed in ${duration}ms`)

    res.json({
      success: true,
      data: trendData,
      cached: true,
      duration,
    })
  } catch (error: any) {
    logger.error('[SummaryController] Get dashboard trend failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== 账户汇总 ====================

/**
 * 获取账户汇总数据（从预聚合表读取）
 * GET /api/summary/accounts
 * Query: date, startDate, endDate, sortBy, order, limit, page
 */
router.get('/accounts', async (req: Request, res: Response) => {
  try {
    const startTime = Date.now()
    const { startDate, endDate } = parseSummaryDateRange(req)
    const sortBy = pickAllowedString(req.query.sortBy, ACCOUNT_SORT_FIELDS, 'spend')
    const sortOrder = (req.query.sortOrder as string) === 'asc' ? 1 : -1
    const { page, limit, skip } = parseSummaryPagination(req, 100)

    // 提取筛选条件
    const optimizer = pickSafeRegexLiteral(req.query.optimizer)
    const status = pickSafeQueryString(req.query.status)
    const accountId = pickSafeQueryString(req.query.accountId)
    const name = pickSafeRegexLiteral(req.query.name)

    // 用户数据隔离
    const userAccountIds = await getUserAccountIds(req)
    const scopedAccountIds = expandScopedAccountIds(userAccountIds)

    // 构建查询条件
    const match: any = { date: { $gte: startDate, $lte: endDate } }
    
    // 用户隔离：非超管只能看到自己关联的账户
    if (scopedAccountIds !== null) {
      if (scopedAccountIds.length === 0) {
        return res.json({
          success: true,
          data: [],
          pagination: { page, limit, total: 0, pages: 0 },
          cached: true,
        })
      }
      match.accountId = { $in: scopedAccountIds }
    }

    if (status) match.status = status
    if (accountId) {
      const requestedAccountId = normalizeForStorage(accountId)
      if (userAccountIds !== null && !userAccountIds.some(id => normalizeForStorage(id).includes(requestedAccountId))) {
        return res.json({
          success: true,
          data: [],
          pagination: { page, limit, total: 0, pages: 0 },
          cached: true,
        })
      }
      match.accountId = scopedAccountIds === null
        ? { $regex: accountId, $options: 'i' }
        : { $in: scopedAccountIds.filter(id => normalizeForStorage(id).includes(requestedAccountId)) }
    }
    if (name) match.accountName = { $regex: name, $options: 'i' }

    // 多日聚合
    const aggregated = await AggAccount.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$accountId',
          accountId: { $first: '$accountId' },
          accountName: { $first: '$accountName' },
          status: { $first: '$status' },
          spend: { $sum: '$spend' },
          revenue: { $sum: '$revenue' },
          impressions: { $sum: '$impressions' },
          clicks: { $sum: '$clicks' },
          installs: { $sum: '$installs' },
          campaigns: { $max: '$campaigns' },
        }
      },
      {
        $addFields: {
          roas: { $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$revenue', '$spend'] }, 0] },
          // 返回小数形式（0.0237），前端 formatPercent 会乘以 100
          ctr: { $cond: [{ $gt: ['$impressions', 0] }, { $divide: ['$clicks', '$impressions'] }, 0] },
          periodSpend: '$spend',  // 兼容前端字段名
          name: '$accountName',   // 兼容前端字段名
          id: '$accountId',       // 兼容前端字段名
          purchase_value: '$revenue',  // 兼容前端字段名
        }
      },
      { $sort: { [sortBy === 'periodSpend' ? 'spend' : sortBy]: sortOrder } },
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          total: [{ $count: 'count' }],
        }
      }
    ])

    const data = aggregated[0]?.data || []
    const total = aggregated[0]?.total[0]?.count || 0

    const duration = Date.now() - startTime
    logger.info(`[Summary] Accounts query completed in ${duration}ms, found ${total} accounts`)

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      cached: true,
      duration,
    })
  } catch (error: any) {
    if (sendSummaryDateRangeError(res, error)) return
    logger.error('[SummaryController] Get accounts failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== 国家汇总 ====================

/**
 * 获取国家汇总数据（从预聚合表读取）
 * GET /api/summary/countries
 * Query: date, startDate, endDate, sortBy, order, limit, page
 */
router.get('/countries', async (req: Request, res: Response) => {
  try {
    const startTime = Date.now()
    const { startDate, endDate } = parseSummaryDateRange(req)
    const sortBy = pickAllowedString(req.query.sortBy, COUNTRY_SORT_FIELDS, 'spend')
    const sortOrder = (req.query.order as string) === 'asc' ? 1 : -1
    const { page, limit, skip } = parseSummaryPagination(req, 50)

    if (req.user?.role !== UserRole.SUPER_ADMIN) {
      return res.json({
        success: true,
        data: [],
        pagination: { page, limit, total: 0, pages: 0 },
        cached: true,
      })
    }

    // 多日聚合
    const aggregated = await AggCountry.aggregate([
      { $match: { date: { $gte: startDate, $lte: endDate } } },
      {
        $group: {
          _id: '$country',
          country: { $first: '$country' },
          countryName: { $first: '$countryName' },
          spend: { $sum: '$spend' },
          revenue: { $sum: '$revenue' },
          impressions: { $sum: '$impressions' },
          clicks: { $sum: '$clicks' },
          installs: { $sum: '$installs' },
          campaigns: { $max: '$campaigns' },
        }
      },
      {
        $addFields: {
          roas: { $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$revenue', '$spend'] }, 0] },
          // 返回小数形式（0.0237），前端 formatPercent 会乘以 100
          ctr: { $cond: [{ $gt: ['$impressions', 0] }, { $divide: ['$clicks', '$impressions'] }, 0] },
          // 兼容前端字段名
          purchase_value: '$revenue',
          purchase_roas: { $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$revenue', '$spend'] }, 0] },
        }
      },
      { $sort: { [sortBy]: sortOrder } },
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          total: [{ $count: 'count' }],
        }
      }
    ])

    const data = aggregated[0]?.data || []
    const total = aggregated[0]?.total[0]?.count || 0

    const duration = Date.now() - startTime
    logger.info(`[Summary] Countries query completed in ${duration}ms, found ${total} countries`)

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      cached: true,
      duration,
    })
  } catch (error: any) {
    if (sendSummaryDateRangeError(res, error)) return
    logger.error('[SummaryController] Get countries failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== 广告系列汇总 ====================

/**
 * 获取广告系列汇总数据（从预聚合表读取）
 * GET /api/summary/campaigns
 * Query: date, startDate, endDate, accountId, status, sortBy, order, limit, page
 */
router.get('/campaigns', async (req: Request, res: Response) => {
  try {
    const startTime = Date.now()
    const { startDate, endDate } = parseSummaryDateRange(req)
    const accountId = pickSafeQueryString(req.query.accountId)
    const status = pickSafeQueryString(req.query.status)
    const name = pickSafeRegexLiteral(req.query.name)
    const sortBy = pickAllowedString(req.query.sortBy, CAMPAIGN_SORT_FIELDS, 'spend')
    const sortOrder = (req.query.sortOrder as string) === 'asc' ? 1 : -1
    const { page, limit, skip } = parseSummaryPagination(req, 50)

    // 用户数据隔离
    const userAccountIds = await getUserAccountIds(req)
    const scopedAccountIds = expandScopedAccountIds(userAccountIds)

    // 构建查询条件
    const match: any = { date: { $gte: startDate, $lte: endDate } }

    // 用户隔离：非超管只能看到自己关联账户的广告系列
    if (scopedAccountIds !== null) {
      if (scopedAccountIds.length === 0) {
        return res.json({
          success: true,
          data: [],
          pagination: { page, limit, total: 0, pages: 0 },
          cached: true,
        })
      }
      match.accountId = { $in: scopedAccountIds }
    }

    if (accountId) {
      if (!hasScopedAccountAccess(userAccountIds, accountId)) {
        return res.json({
          success: true,
          data: [],
          pagination: { page, limit, total: 0, pages: 0 },
          cached: true,
        })
      }
      match.accountId = { $in: getAccountIdsForQuery([accountId]) }
    }
    if (status) match.status = status
    if (name) match.campaignName = { $regex: name, $options: 'i' }

    // 多日聚合
    const aggregated = await AggCampaign.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$campaignId',
          campaignId: { $first: '$campaignId' },
          campaignName: { $first: '$campaignName' },
          accountId: { $first: '$accountId' },
          accountName: { $first: '$accountName' },
          optimizer: { $first: '$optimizer' },
          status: { $first: '$status' },
          objective: { $first: '$objective' },
          spend: { $sum: '$spend' },
          revenue: { $sum: '$revenue' },
          impressions: { $sum: '$impressions' },
          clicks: { $sum: '$clicks' },
          installs: { $sum: '$installs' },
        }
      },
      {
        $addFields: {
          roas: { $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$revenue', '$spend'] }, 0] },
          // 返回小数形式（0.0237），前端 formatPercent 会乘以 100
          ctr: { $cond: [{ $gt: ['$impressions', 0] }, { $divide: ['$clicks', '$impressions'] }, 0] },
          cpc: { $cond: [{ $gt: ['$clicks', 0] }, { $divide: ['$spend', '$clicks'] }, 0] },
          cpm: { $cond: [{ $gt: ['$impressions', 0] }, { $multiply: [{ $divide: ['$spend', '$impressions'] }, 1000] }, 0] },
          cpi: { $cond: [{ $gt: ['$installs', 0] }, { $divide: ['$spend', '$installs'] }, 0] },
          // 兼容前端字段名
          name: '$campaignName',
          id: '$campaignId',
          account_id: '$accountId',
          purchase_value: '$revenue',
          purchase_roas: { $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$revenue', '$spend'] }, 0] },
          mobile_app_install: '$installs',
        }
      },
      { $sort: { [sortBy]: sortOrder } },
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          total: [{ $count: 'count' }],
        }
      }
    ])

    const data = aggregated[0]?.data || []
    const total = aggregated[0]?.total[0]?.count || 0

    const duration = Date.now() - startTime
    logger.info(`[Summary] Campaigns query completed in ${duration}ms, found ${total} campaigns`)

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      cached: true,
      duration,
    })
  } catch (error: any) {
    if (sendSummaryDateRangeError(res, error)) return
    logger.error('[SummaryController] Get campaigns failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== 素材汇总 ====================

/**
 * 获取素材汇总数据（从 MaterialMetrics 表读取）
 * GET /api/summary/materials
 * Query: startDate, endDate, type, sortBy, order, limit, page
 */
router.get('/materials', async (req: Request, res: Response) => {
  try {
    const startTime = Date.now()
    const { startDate, endDate } = parseSummaryDateRange(req, { defaultDays: 7 })
    const materialType = req.query.type as string
    const sortBy = pickAllowedString(req.query.sortBy, MATERIAL_SORT_FIELDS, 'spend')
    const order = req.query.order === 'asc' ? 1 : -1
    const { page, limit, skip } = parseSummaryPagination(req, 50)

    if (req.user?.role !== UserRole.SUPER_ADMIN) {
      return res.json({
        success: true,
        data: [],
        pagination: { page, limit, total: 0, pages: 0 },
        cached: true,
      })
    }

    const match: any = { 
      date: { $gte: startDate, $lte: endDate },
      spend: { $gt: 0 }  // 只返回有消耗的素材
    }
    if (materialType) match.materialType = materialType

    // 多日聚合（使用 MaterialMetrics 表）
    const aggregated = await MaterialMetrics.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $ifNull: ['$materialId', { $ifNull: ['$imageHash', '$videoId'] }] },
          materialId: { $first: '$materialId' },
          materialName: { $first: '$materialName' },
          materialType: { $first: '$materialType' },
          thumbnailUrl: { $first: '$thumbnailUrl' },
          localStorageUrl: { $first: '$localStorageUrl' },
          spend: { $sum: '$spend' },
          revenue: { $sum: '$purchaseValue' },
          impressions: { $sum: '$impressions' },
          clicks: { $sum: '$clicks' },
          installs: { $sum: '$installs' },
          purchases: { $sum: '$purchases' },
          adIds: { $addToSet: '$adIds' },
          campaignIds: { $addToSet: '$campaignIds' },
          qualityScore: { $avg: '$qualityScore' },
          daysActive: { $sum: 1 },
        }
      },
      {
        $addFields: {
          roas: { $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$revenue', '$spend'] }, 0] },
          ctr: { $cond: [{ $gt: ['$impressions', 0] }, { $multiply: [{ $divide: ['$clicks', '$impressions'] }, 100] }, 0] },
          cpc: { $cond: [{ $gt: ['$clicks', 0] }, { $divide: ['$spend', '$clicks'] }, 0] },
          cpm: { $cond: [{ $gt: ['$impressions', 0] }, { $multiply: [{ $divide: ['$spend', '$impressions'] }, 1000] }, 0] },
          cpi: { $cond: [{ $gt: ['$installs', 0] }, { $divide: ['$spend', '$installs'] }, 0] },
          adsCount: { $size: { $reduce: { input: '$adIds', initialValue: [], in: { $setUnion: ['$$value', '$$this'] } } } },
          campaignsCount: { $size: { $reduce: { input: '$campaignIds', initialValue: [], in: { $setUnion: ['$$value', '$$this'] } } } },
        }
      },
      { $sort: { [sortBy]: order } },
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          total: [{ $count: 'count' }],
        }
      }
    ])

    const data = aggregated[0]?.data || []
    const total = aggregated[0]?.total[0]?.count || 0

    const duration = Date.now() - startTime
    logger.info(`[Summary] Materials query completed in ${duration}ms, found ${total} materials`)

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      cached: true,
      duration,
    })
  } catch (error: any) {
    if (sendSummaryDateRangeError(res, error)) return
    logger.error('[SummaryController] Get materials failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== 管理接口 ====================

/**
 * 获取聚合状态
 * GET /api/summary/status
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    if (!requireSuperAdmin(req, res)) return
    const today = dayjs().format('YYYY-MM-DD')
    
    // 检查各表最新数据
    const [latestDaily, latestCampaign, latestAccount, latestCountry] = await Promise.all([
      AggDaily.findOne().sort({ updatedAt: -1 }).select('date updatedAt').lean(),
      AggCampaign.findOne().sort({ updatedAt: -1 }).select('date updatedAt').lean(),
      AggAccount.findOne().sort({ updatedAt: -1 }).select('date updatedAt').lean(),
      AggCountry.findOne().sort({ updatedAt: -1 }).select('date updatedAt').lean(),
    ])

    res.json({
      success: true,
      data: {
        currentDate: today,
        tables: {
          AggDaily: { latestDate: latestDaily?.date, updatedAt: latestDaily?.updatedAt },
          AggCampaign: { latestDate: latestCampaign?.date, updatedAt: latestCampaign?.updatedAt },
          AggAccount: { latestDate: latestAccount?.date, updatedAt: latestAccount?.updatedAt },
          AggCountry: { latestDate: latestCountry?.date, updatedAt: latestCountry?.updatedAt },
        },
        refreshInterval: '10 minutes',
      }
    })
  } catch (error: any) {
    logger.error('[SummaryController] Get status failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * 手动触发刷新
 * POST /api/summary/refresh
 * Body: { days?: number }
 */
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    if (!requireSuperAdmin(req, res)) return
    const startTime = Date.now()
    logger.info('[SummaryController] Manual refresh triggered')

    await refreshRecentDays()

    const duration = Date.now() - startTime
    res.json({
      success: true,
      message: `聚合数据已刷新`,
      duration,
    })
  } catch (error: any) {
    logger.error('[SummaryController] Manual refresh failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router
