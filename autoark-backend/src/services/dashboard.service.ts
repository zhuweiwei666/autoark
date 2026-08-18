import { PipelineStage } from 'mongoose'
import { MetricsDaily, Account, Campaign, Ad, SyncLog, OpsLog } from '../models'
import mongoose from 'mongoose'
import { pickAllowedString, pickSafeQueryString } from '../utils/pagination'
import { AggCampaign, AggCountry, AggDaily } from '../models/Aggregation'
import { addDateDays, enumerateDateRange, formatShanghaiDate } from '../utils/shanghaiDate'

// --- Existing Dashboard Service Logic ---

interface DashboardFilters {
  startDate: string
  endDate: string
  channel?: string
  appPackageId?: string
  country?: string
}

export const DASHBOARD_CHANNEL_FILTERS = ['facebook', 'tiktok'] as const

const sanitizeDashboardFilters = (filters: DashboardFilters): DashboardFilters => {
  const channel = pickAllowedString(filters.channel, DASHBOARD_CHANNEL_FILTERS, '')
  const country = pickSafeQueryString(filters.country, 32)

  return {
    ...filters,
    channel: channel || undefined,
    country,
  }
}

const buildMatchStage = (filters: DashboardFilters) => {
  const safeFilters = sanitizeDashboardFilters(filters)
  const match: any = {
    date: { $gte: safeFilters.startDate, $lte: safeFilters.endDate },
  }

  if (safeFilters.channel) {
    match.channel = safeFilters.channel
  }

  if (safeFilters.country) {
    match.country = safeFilters.country
  }

  return match
}

export const getDaily = async (filters: DashboardFilters) => {
  const match = buildMatchStage(filters)

  const pipeline: PipelineStage[] = [
    { $match: match },
    {
      $group: {
        _id: '$date',
        spendUsd: { $sum: '$spendUsd' },
        installs: { $sum: '$installs' },
        revenueD0: { $sum: '$revenueD0' },
        impressions: { $sum: '$impressions' },
        clicks: { $sum: '$clicks' },
      },
    },
    { $sort: { _id: 1 as const } },
    {
      $project: {
        _id: 0,
        date: '$_id',
        spendUsd: 1,
        installs: 1,
        revenueD0: 1,
        cpiUsd: {
          $cond: [
            { $gt: ['$installs', 0] },
            { $divide: ['$spendUsd', '$installs'] },
            0,
          ],
        },
        roiD0: {
          $cond: [
            { $gt: ['$spendUsd', 0] },
            { $divide: ['$revenueD0', '$spendUsd'] },
            0,
          ],
        },
        ctr: {
          $cond: [
            { $gt: ['$impressions', 0] },
            { $divide: ['$clicks', '$impressions'] },
            0,
          ],
        },
      },
    },
  ]

  return await MetricsDaily.aggregate(pipeline)
}

export const getByCountry = async (filters: DashboardFilters) => {
  const match = buildMatchStage(filters)

  const pipeline: PipelineStage[] = [
    { $match: match },
    {
      $group: {
        _id: '$country',
        spendUsd: { $sum: '$spendUsd' },
        installs: { $sum: '$installs' },
        revenueD0: { $sum: '$revenueD0' },
      },
    },
    { $sort: { spendUsd: -1 as -1 } },
    {
      $project: {
        _id: 0,
        country: '$_id',
        spendUsd: 1,
        installs: 1,
        revenueD0: 1,
        roiD0: {
          $cond: [
            { $gt: ['$spendUsd', 0] },
            { $divide: ['$revenueD0', '$spendUsd'] },
            0,
          ],
        },
      },
    },
  ]

  return await MetricsDaily.aggregate(pipeline)
}

export const getByAdSet = async (filters: DashboardFilters) => {
  const match = buildMatchStage(filters)

  const pipeline: PipelineStage[] = [
    { $match: match },
    {
      $group: {
        _id: '$adsetId',
        spendUsd: { $sum: '$spendUsd' },
        installs: { $sum: '$installs' },
        revenueD0: { $sum: '$revenueD0' },
      },
    },
    { $sort: { spendUsd: -1 as -1 } },
    {
      $project: {
        _id: 0,
        adsetId: '$_id',
        spendUsd: 1,
        installs: 1,
        cpiUsd: {
          $cond: [
            { $gt: ['$installs', 0] },
            { $divide: ['$spendUsd', '$installs'] },
            0,
          ],
        },
        roiD0: {
          $cond: [
            { $gt: ['$spendUsd', 0] },
            { $divide: ['$revenueD0', '$spendUsd'] },
            0,
          ],
        },
      },
    },
  ]

  return await MetricsDaily.aggregate(pipeline)
}

// --- New Dashboard Service Methods for Read-Only Dashboard ---

export async function getSystemHealth() {
  let mongoConnected = false
  try {
    mongoConnected = mongoose.connection.readyState === 1
  } catch (e) {
    mongoConnected = false
  }

  const lastSync = await SyncLog.findOne().sort({ createdAt: -1 }).lean()

  return {
    serverTime: new Date(),
    uptimeSeconds: process.uptime(),
    mongoConnected,
    lastSyncAt: lastSync?.createdAt ?? null,
  }
}

export async function getFacebookOverview() {
  const [accounts, campaigns, ads, lastSync] = await Promise.all([
    Account.countDocuments(),
    Campaign.countDocuments(),
    Ad.countDocuments(),
    SyncLog.findOne().sort({ createdAt: -1 }).lean(),
  ])

  return {
    accounts,
    campaigns,
    ads,
    lastSyncAt: lastSync?.createdAt ?? null,
  }
}

export async function getCronLogs(limit = 50) {
  const logs = await SyncLog.find().sort({ createdAt: -1 }).limit(limit).lean()
  return logs
}

export async function getOpsLogs(limit = 50) {
  const logs = await OpsLog.find().sort({ createdAt: -1 }).limit(limit).lean()
  return logs
}

// ========== 数据看板 V1 API ==========

const emptyDashboardMetric = () => ({
  spend: 0,
  impressions: 0,
  clicks: 0,
  installs: 0,
  purchase_value: 0,
  ctr: 0,
  cpm: 0,
  cpc: 0,
  cpi: 0,
  roas: 0,
  available: false,
  dataStatus: 'unavailable',
})

const dashboardMetricFromDaily = (row: any) => row
  ? {
      spend: Number(row.spend || 0),
      impressions: Number(row.impressions || 0),
      clicks: Number(row.clicks || 0),
      installs: Number(row.installs || 0),
      purchase_value: Number(row.revenue || 0),
      ctr: Number(row.ctr || 0),
      cpm: Number(row.cpm || 0),
      cpc: Number(row.cpc || 0),
      cpi: Number(row.cpi || 0),
      roas: Number(row.roas || 0),
      available: true,
      dataStatus: row.dataStatus || 'fresh',
    }
  : emptyDashboardMetric()

/**
 * 获取核心指标概览。Meta API 只由后台采集任务调用；这个兼容接口和
 * AI 分析链都只读取 MongoDB 聚合快照。
 */
export async function getCoreMetrics(startDate?: string, endDate?: string) {
  const today = endDate || formatShanghaiDate()
  const yesterday = addDateDays(today, -1)
  const rangeStart = startDate || addDateDays(today, -6)
  const expectedDays = enumerateDateRange(rangeStart, today).length
  const rows = await AggDaily.find({
    date: { $gte: rangeStart < yesterday ? rangeStart : yesterday, $lte: today },
  }).lean()
  const rowsByDate = new Map(rows.map((row: any) => [row.date, row]))
  const rangeRows = rows.filter((row: any) => row.date >= rangeStart && row.date <= today)
  const rangeTotals = rangeRows.reduce((total, row: any) => ({
    spend: total.spend + Number(row.spend || 0),
    impressions: total.impressions + Number(row.impressions || 0),
    clicks: total.clicks + Number(row.clicks || 0),
    installs: total.installs + Number(row.installs || 0),
    purchase_value: total.purchase_value + Number(row.revenue || 0),
  }), { spend: 0, impressions: 0, clicks: 0, installs: 0, purchase_value: 0 })
  const rangeStatus = rangeRows.length === 0
    ? 'unavailable'
    : rangeRows.length < expectedDays || rangeRows.some((row: any) => row.dataStatus === 'partial')
      ? 'partial'
      : rangeRows.some((row: any) => row.dataStatus === 'stale')
        ? 'stale'
        : 'fresh'

  return {
    today: dashboardMetricFromDaily(rowsByDate.get(today)),
    yesterday: dashboardMetricFromDaily(rowsByDate.get(yesterday)),
    sevenDays: {
      ...rangeTotals,
      roas: rangeTotals.spend > 0 ? rangeTotals.purchase_value / rangeTotals.spend : 0,
      avgDailySpend: expectedDays > 0 ? rangeTotals.spend / expectedDays : 0,
      available: rangeRows.length > 0,
      dataStatus: rangeStatus,
      coveredDays: rangeRows.length,
      expectedDays,
    },
    dataSource: 'database',
  }
}

/**
 * 获取今日消耗趋势（按小时）- 由于数据是按天存储的，这里返回最近7天的趋势
 */
export async function getTodaySpendTrend(startDate?: string, endDate?: string) {
  const today = endDate || formatShanghaiDate()
  const rangeStart = startDate || addDateDays(today, -6)
  const rows = await AggDaily.find({
    date: { $gte: rangeStart, $lte: today },
  }).sort({ date: 1 }).lean()
  return rows.map((row: any) => ({
    date: row.date,
    spend: Number(row.spend || 0),
    impressions: Number(row.impressions || 0),
    clicks: Number(row.clicks || 0),
    dataStatus: row.dataStatus || 'fresh',
  }))
}

/**
 * 获取分 Campaign 消耗排行（只读永久聚合快照）
 */
export async function getCampaignSpendRanking(limit = 10, startDate?: string, endDate?: string) {
  const today = endDate || formatShanghaiDate()
  const rangeStart = startDate || addDateDays(today, -6)
  return AggCampaign.aggregate([
    { $match: { date: { $gte: rangeStart, $lte: today } } },
    {
      $group: {
        _id: '$campaignId',
        campaignId: { $first: '$campaignId' },
        campaignName: { $first: '$campaignName' },
        spend: { $sum: '$spend' },
        impressions: { $sum: '$impressions' },
        clicks: { $sum: '$clicks' },
        installs: { $sum: '$installs' },
        purchase_value: { $sum: '$revenue' },
      },
    },
    { $sort: { spend: -1 } },
    { $limit: limit },
    {
      $addFields: {
        ctr: { $cond: [{ $gt: ['$impressions', 0] }, { $multiply: [{ $divide: ['$clicks', '$impressions'] }, 100] }, 0] },
        cpm: { $cond: [{ $gt: ['$impressions', 0] }, { $multiply: [{ $divide: ['$spend', '$impressions'] }, 1000] }, 0] },
        cpc: { $cond: [{ $gt: ['$clicks', 0] }, { $divide: ['$spend', '$clicks'] }, 0] },
        cpi: { $cond: [{ $gt: ['$installs', 0] }, { $divide: ['$spend', '$installs'] }, 0] },
        roas: { $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$purchase_value', '$spend'] }, 0] },
      },
    },
    { $project: { _id: 0 } },
  ])
}

/**
 * 获取分国家消耗排行
 */
export async function getCountrySpendRanking(limit = 10, startDate?: string, endDate?: string) {
  const today = endDate || formatShanghaiDate()
  const rangeStart = startDate || addDateDays(today, -6)
  return AggCountry.aggregate([
    { $match: { date: { $gte: rangeStart, $lte: today } } },
    {
      $group: {
        _id: '$country',
        country: { $first: '$country' },
        countryName: { $first: '$countryName' },
        spend: { $sum: '$spend' },
        impressions: { $sum: '$impressions' },
        clicks: { $sum: '$clicks' },
        installs: { $sum: '$installs' },
        purchase_value: { $sum: '$revenue' },
      },
    },
    { $sort: { spend: -1 } },
    { $limit: limit },
    {
      $addFields: {
        ctr: {
          $cond: [
            { $gt: ['$impressions', 0] },
            { $multiply: [{ $divide: ['$clicks', '$impressions'] }, 100] },
            0,
          ],
        },
        cpm: {
          $cond: [
            { $gt: ['$impressions', 0] },
            { $multiply: [{ $divide: ['$spend', '$impressions'] }, 1000] },
            0,
          ],
        },
        cpc: {
          $cond: [{ $gt: ['$clicks', 0] }, { $divide: ['$spend', '$clicks'] }, 0],
        },
        cpi: {
          $cond: [{ $gt: ['$installs', 0] }, { $divide: ['$spend', '$installs'] }, 0],
        },
        roas: {
          $cond: [
            { $and: [{ $gt: ['$spend', 0] }, { $gt: ['$purchase_value', 0] }] },
            { $divide: ['$purchase_value', '$spend'] },
            0,
          ],
        },
      },
    },
    { $project: { _id: 0 } },
  ])
}
