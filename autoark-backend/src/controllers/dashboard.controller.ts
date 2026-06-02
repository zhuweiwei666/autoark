import { Request, Response, NextFunction } from 'express'
import dayjs from 'dayjs'
import * as dashboardService from '../services/dashboard.service'
import { parseLimitedNumber } from '../utils/pagination'

const DASHBOARD_MAX_RANGE_DAYS = 90
const DASHBOARD_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

class DashboardDateRangeError extends Error {
  statusCode = 400
}

const parseDashboardDate = (value: any, fieldName: string): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || !DASHBOARD_DATE_PATTERN.test(value)) {
    throw new DashboardDateRangeError(`${fieldName} must be a valid YYYY-MM-DD date`)
  }

  const parsed = dayjs(value)
  if (!parsed.isValid() || parsed.format('YYYY-MM-DD') !== value) {
    throw new DashboardDateRangeError(`${fieldName} must be a valid YYYY-MM-DD date`)
  }

  return value
}

const parseDashboardDateRange = (
  req: Request,
  options: { defaultDays?: number } = {},
) => {
  const defaultDays = Math.max(1, options.defaultDays || 8)
  const today = dayjs().format('YYYY-MM-DD')
  const requestedStartDate = parseDashboardDate(req.query.startDate, 'startDate')
  const requestedEndDate = parseDashboardDate(req.query.endDate, 'endDate')
  const endDate = requestedEndDate || today
  let startDate = requestedStartDate

  if (!startDate) {
    startDate = dayjs(endDate).subtract(defaultDays - 1, 'day').format('YYYY-MM-DD')
  }

  const start = dayjs(startDate)
  const end = dayjs(endDate)
  if (start.isAfter(end)) {
    throw new DashboardDateRangeError('startDate must be earlier than or equal to endDate')
  }

  const requestedDays = end.diff(start, 'day') + 1
  if (requestedDays > DASHBOARD_MAX_RANGE_DAYS) {
    startDate = end.subtract(DASHBOARD_MAX_RANGE_DAYS - 1, 'day').format('YYYY-MM-DD')
  }

  return { startDate, endDate }
}

const sendDashboardDateRangeError = (res: Response, error: any) => {
  if (error instanceof DashboardDateRangeError) {
    res.status(error.statusCode).json({
      success: false,
      error: error.message,
      meta: { maxDays: DASHBOARD_MAX_RANGE_DAYS },
    })
    return true
  }
  return false
}

const getFilters = (req: Request) => {
  const { channel, country } = req.query
  const { startDate, endDate } = parseDashboardDateRange(req)

  return {
    startDate,
    endDate,
    channel: channel as string,
    country: country as string,
  }
}

export const getDaily = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const filters = getFilters(req)
    const data = await dashboardService.getDaily(filters)
    res.json(data)
  } catch (error: any) {
    if (sendDashboardDateRangeError(res, error)) return
    next(error)
  }
}

export const getByCountry = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const filters = getFilters(req)
    const data = await dashboardService.getByCountry(filters)
    res.json(data)
  } catch (error: any) {
    if (sendDashboardDateRangeError(res, error)) return
    next(error)
  }
}

export const getByAdSet = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const filters = getFilters(req)
    const data = await dashboardService.getByAdSet(filters)
    res.json(data)
  } catch (error: any) {
    if (sendDashboardDateRangeError(res, error)) return
    next(error)
  }
}

// --- New Handlers for Read-Only Dashboard ---

export async function getSystemHealthHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const data = await dashboardService.getSystemHealth()
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export async function getFacebookOverviewHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const data = await dashboardService.getFacebookOverview()
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export async function getCronLogsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const limit = parseLimitedNumber(req.query.limit, 50, 200)
    const data = await dashboardService.getCronLogs(limit)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export async function getOpsLogsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const limit = parseLimitedNumber(req.query.limit, 50, 200)
    const data = await dashboardService.getOpsLogs(limit)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

// ========== 数据看板 V1 API Handlers ==========

export async function getCoreMetricsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { startDate, endDate } = parseDashboardDateRange(req)
    const data = await dashboardService.getCoreMetrics(startDate, endDate)
    res.json({ success: true, data })
  } catch (err: any) {
    if (sendDashboardDateRangeError(res, err)) return
    next(err)
  }
}

export async function getTodaySpendTrendHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { startDate, endDate } = parseDashboardDateRange(req)
    const data = await dashboardService.getTodaySpendTrend(startDate, endDate)
    res.json({ success: true, data })
  } catch (err: any) {
    if (sendDashboardDateRangeError(res, err)) return
    next(err)
  }
}

export async function getCampaignSpendRankingHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const limit = parseLimitedNumber(req.query.limit, 10, 100)
    const { startDate, endDate } = parseDashboardDateRange(req)
    const data = await dashboardService.getCampaignSpendRanking(limit, startDate, endDate)
    res.json({ success: true, data })
  } catch (err: any) {
    if (sendDashboardDateRangeError(res, err)) return
    next(err)
  }
}

export async function getCountrySpendRankingHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const limit = parseLimitedNumber(req.query.limit, 10, 100)
    const { startDate, endDate } = parseDashboardDateRange(req)
    const data = await dashboardService.getCountrySpendRanking(limit, startDate, endDate)
    res.json({ success: true, data })
  } catch (err: any) {
    if (sendDashboardDateRangeError(res, err)) return
    next(err)
  }
}
