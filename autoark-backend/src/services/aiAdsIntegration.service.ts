import dayjs from 'dayjs'
import Account from '../models/Account'
import FbToken from '../models/FbToken'
import {
  AggAccount,
  AggCampaign,
  AggCountryAccount,
} from '../models/Aggregation'
import { getAccountIdsForQuery, normalizeForStorage } from '../utils/accountId'

export const AI_ADS_DIMENSIONS = [
  'overview',
  'account',
  'campaign',
  'country',
  'delivery',
] as const

export type AiAdsDimension = (typeof AI_ADS_DIMENSIONS)[number]

const MAX_RANGE_DAYS = 90
const MAX_PAGE_SIZE = 100
const MAX_PAGE = 100
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const CURRENCY_PATTERN = /^[A-Z]{3}$/
const DELIVERY_NAMING_CONTRACT = {
  version: 1,
  pattern: '<optimizer>_<channel>_<product>_<platform>_*',
}

const CHANNEL_ALIASES: Record<string, string> = {
  fb: 'facebook_ads',
  facebook: 'facebook_ads',
  meta: 'facebook_ads',
  gg: 'google_ads',
  google: 'google_ads',
  tiktok: 'tiktok_ads',
  tt: 'tiktok_ads',
  kwai: 'kwai_ads',
}

const PLATFORM_ALIASES: Record<string, string> = {
  web: 'web',
  android: 'android',
  apk: 'android',
  ios: 'ios',
}

export interface CampaignDeliveryName {
  optimizer: string
  channel: string
  product: string
  platform: string
  matched: boolean
}

const normalizedToken = (value: unknown): string =>
  String(value || '')
    .trim()
    .toLocaleLowerCase()

export const parseCampaignDeliveryName = (
  campaignName: string,
): CampaignDeliveryName => {
  const parts = String(campaignName || '')
    .split('_')
    .map(normalizedToken)
  if (parts.length < 4 || parts.slice(0, 4).some((part) => !part)) {
    return {
      optimizer: 'unknown',
      channel: 'other',
      product: 'unknown',
      platform: 'all',
      matched: false,
    }
  }

  const optimizer = parts[0] || 'unknown'
  const channel = CHANNEL_ALIASES[parts[1]] || 'other'
  const product = parts[2] || 'unknown'
  const platform = PLATFORM_ALIASES[parts[3]] || 'all'
  return {
    optimizer,
    channel,
    product,
    platform,
    matched: channel !== 'other' && platform !== 'all' && product !== 'unknown',
  }
}

export class AiAdsQueryError extends Error {
  statusCode = 400
}

export interface AiAdsQuery {
  dimension: AiAdsDimension
  startDate: string
  endDate: string
  currency?: string
  page: number
  limit: number
}

const parseDate = (value: unknown, field: string, fallback: string): string => {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new AiAdsQueryError(`${field} must be a valid YYYY-MM-DD date`)
  }
  const parsed = dayjs(value)
  if (!parsed.isValid() || parsed.format('YYYY-MM-DD') !== value) {
    throw new AiAdsQueryError(`${field} must be a valid YYYY-MM-DD date`)
  }
  return value
}

const parsePositiveInteger = (
  value: unknown,
  fallback: number,
  maximum: number,
): number => {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return fallback
  return Math.min(Math.max(Number(value), 1), maximum)
}

export const parseAiAdsQuery = (query: Record<string, unknown>): AiAdsQuery => {
  const today = dayjs().format('YYYY-MM-DD')
  const endDate = parseDate(query.endDate, 'endDate', today)
  const startDate = parseDate(query.startDate, 'startDate', endDate)
  const start = dayjs(startDate)
  const end = dayjs(endDate)

  if (start.isAfter(end)) {
    throw new AiAdsQueryError(
      'startDate must be earlier than or equal to endDate',
    )
  }
  if (end.diff(start, 'day') + 1 > MAX_RANGE_DAYS) {
    throw new AiAdsQueryError(`date range cannot exceed ${MAX_RANGE_DAYS} days`)
  }

  const requestedDimension =
    typeof query.dimension === 'string' ? query.dimension : 'overview'
  if (!AI_ADS_DIMENSIONS.includes(requestedDimension as AiAdsDimension)) {
    throw new AiAdsQueryError(
      `dimension must be one of ${AI_ADS_DIMENSIONS.join(', ')}`,
    )
  }

  let currency: string | undefined
  if (query.currency !== undefined && query.currency !== '') {
    if (typeof query.currency !== 'string') {
      throw new AiAdsQueryError('currency must be a 3-letter ISO currency code')
    }
    currency = query.currency.trim().toUpperCase()
    if (!CURRENCY_PATTERN.test(currency)) {
      throw new AiAdsQueryError('currency must be a 3-letter ISO currency code')
    }
  }

  return {
    dimension: requestedDimension as AiAdsDimension,
    startDate,
    endDate,
    currency,
    page: parsePositiveInteger(query.page, 1, MAX_PAGE),
    limit: parsePositiveInteger(query.limit, 50, MAX_PAGE_SIZE),
  }
}

interface ScopedAccount {
  accountId: string
  currency: string
}

const getScopedAccounts = async (): Promise<ScopedAccount[]> => {
  const organizationId = (
    process.env.AI_ADS_INTEGRATION_ORGANIZATION_ID || ''
  ).trim()
  if (!organizationId) return []

  const tokens = await FbToken.find({
    organizationId,
    status: 'active',
  })
    .select('_id token')
    .lean()

  const tokenIds = tokens.map((token: any) => token._id).filter(Boolean)
  const tokenValues = tokens.map((token: any) => token.token).filter(Boolean)
  const scopeClauses: Record<string, unknown>[] = [{ organizationId }]
  if (tokenIds.length > 0) {
    scopeClauses.push({
      organizationId: null,
      tokenId: { $in: tokenIds },
    })
  }
  if (tokenValues.length > 0) {
    scopeClauses.push({
      organizationId: null,
      token: { $in: tokenValues },
    })
  }

  const accounts = await Account.find({
    channel: 'facebook',
    $or: scopeClauses,
  })
    .select('accountId currency')
    .lean()

  const scoped = new Map<string, ScopedAccount>()
  accounts.forEach((account: any) => {
    const accountId = normalizeForStorage(account.accountId)
    if (!accountId) return
    scoped.set(accountId, {
      accountId,
      currency:
        typeof account.currency === 'string' && account.currency.trim()
          ? account.currency.trim().toUpperCase()
          : 'UNKNOWN',
    })
  })
  return Array.from(scoped.values())
}

const calculatedMetricsStage = {
  $addFields: {
    purchase_value: '$revenue',
    roas: {
      $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$revenue', '$spend'] }, 0],
    },
    ctr: {
      $cond: [
        { $gt: ['$impressions', 0] },
        { $divide: ['$clicks', '$impressions'] },
        0,
      ],
    },
    cpc: {
      $cond: [{ $gt: ['$clicks', 0] }, { $divide: ['$spend', '$clicks'] }, 0],
    },
    cpm: {
      $cond: [
        { $gt: ['$impressions', 0] },
        { $multiply: [{ $divide: ['$spend', '$impressions'] }, 1000] },
        0,
      ],
    },
    cpi: {
      $cond: [
        { $gt: ['$installs', 0] },
        { $divide: ['$spend', '$installs'] },
        0,
      ],
    },
  },
}

const paginate = (page: number, limit: number) => ({
  $facet: {
    data: [{ $skip: (page - 1) * limit }, { $limit: limit }],
    total: [{ $count: 'count' }],
  },
})

const metricDefinitions = (currency: string | null) => ({
  revenue: 'meta_attributed_purchase_value',
  ctr: 'ratio_0_to_1',
  currency,
})

const emptyResult = (
  query: AiAdsQuery,
  currency: string | null = query.currency || null,
  accountCount = 0,
) => ({
  success: true,
  data:
    query.dimension === 'overview'
      ? {
          currency,
          spend: 0,
          revenue: 0,
          purchase_value: 0,
          impressions: 0,
          clicks: 0,
          installs: 0,
          roas: 0,
          ctr: 0,
          cpc: 0,
          cpm: 0,
          cpi: 0,
          activeAccounts: 0,
          activeCampaigns: 0,
        }
      : [],
  meta: {
    dimension: query.dimension,
    period: { startDate: query.startDate, endDate: query.endDate },
    source: 'autoark_preaggregated',
    scope: 'gaoyuhua',
    metricDefinitions: metricDefinitions(currency),
    coverage: {
      scopedAccounts: accountCount,
      coveredAccounts: 0,
      missingAccounts: accountCount,
      returnedRows: 0,
    },
    freshness: {
      latestDate: null,
      updatedAt: null,
      complete: accountCount === 0,
    },
    ...(query.dimension === 'delivery'
      ? { namingContract: DELIVERY_NAMING_CONTRACT }
      : {}),
    ...(query.dimension === 'overview'
      ? {}
      : {
          pagination: {
            page: query.page,
            limit: query.limit,
            total: 0,
            pages: 0,
          },
        }),
  },
})

const aggregateDimension = async (query: AiAdsQuery, accountIds: string[]) => {
  const accountIdsForQuery = getAccountIdsForQuery(accountIds)
  const match = {
    date: { $gte: query.startDate, $lte: query.endDate },
    accountId: { $in: accountIdsForQuery },
  }

  if (query.dimension === 'account') {
    return AggAccount.aggregate([
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
        },
      },
      calculatedMetricsStage,
      { $sort: { spend: -1, accountId: 1 } },
      paginate(query.page, query.limit),
    ])
  }

  if (query.dimension === 'campaign') {
    return AggCampaign.aggregate([
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
        },
      },
      calculatedMetricsStage,
      { $sort: { spend: -1, campaignId: 1 } },
      paginate(query.page, query.limit),
    ])
  }

  return AggCountryAccount.aggregate([
    { $match: match },
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
      },
    },
    calculatedMetricsStage,
    { $sort: { spend: -1, country: 1 } },
    paginate(query.page, query.limit),
  ])
}

interface DeliveryMetricRow {
  date: string
  campaignId: string
  campaignName: string
  spend: number
  revenue: number
  impressions: number
  clicks: number
  installs: number
}

interface DeliveryAggregateRow extends Omit<CampaignDeliveryName, 'matched'> {
  date: string
  spend: number
  revenue: number
  purchase_value: number
  impressions: number
  clicks: number
  installs: number
  campaigns: number
  namingMatched: boolean
  roas: number
  ctr: number
  cpc: number
  cpm: number
  cpi: number
}

const ratio = (numerator: number, denominator: number): number =>
  denominator > 0 ? numerator / denominator : 0

const getDelivery = async (
  query: AiAdsQuery,
  accountIds: string[],
): Promise<{ data: DeliveryAggregateRow[]; total: number }> => {
  const accountIdsForQuery = getAccountIdsForQuery(accountIds)
  const campaignRows = await AggCampaign.aggregate<DeliveryMetricRow>([
    {
      $match: {
        date: { $gte: query.startDate, $lte: query.endDate },
        accountId: { $in: accountIdsForQuery },
      },
    },
    {
      $group: {
        _id: { date: '$date', campaignId: '$campaignId' },
        date: { $first: '$date' },
        campaignId: { $first: '$campaignId' },
        campaignName: { $first: '$campaignName' },
        spend: { $sum: '$spend' },
        revenue: { $sum: '$revenue' },
        impressions: { $sum: '$impressions' },
        clicks: { $sum: '$clicks' },
        installs: { $sum: '$installs' },
      },
    },
  ])

  const grouped = new Map<
    string,
    Omit<
      DeliveryAggregateRow,
      'purchase_value' | 'roas' | 'ctr' | 'cpc' | 'cpm' | 'cpi'
    >
  >()
  for (const campaign of campaignRows) {
    const parsed = parseCampaignDeliveryName(campaign.campaignName)
    const key = [
      campaign.date,
      parsed.optimizer,
      parsed.channel,
      parsed.product,
      parsed.platform,
      parsed.matched ? 'matched' : 'unmatched',
    ].join('|')
    const current = grouped.get(key) || {
      date: campaign.date,
      optimizer: parsed.optimizer,
      channel: parsed.channel,
      product: parsed.product,
      platform: parsed.platform,
      namingMatched: parsed.matched,
      spend: 0,
      revenue: 0,
      impressions: 0,
      clicks: 0,
      installs: 0,
      campaigns: 0,
    }
    current.spend += Number(campaign.spend) || 0
    current.revenue += Number(campaign.revenue) || 0
    current.impressions += Number(campaign.impressions) || 0
    current.clicks += Number(campaign.clicks) || 0
    current.installs += Number(campaign.installs) || 0
    current.campaigns += 1
    grouped.set(key, current)
  }

  const rows = [...grouped.values()]
    .map(
      (row): DeliveryAggregateRow => ({
        ...row,
        purchase_value: row.revenue,
        roas: ratio(row.revenue, row.spend),
        ctr: ratio(row.clicks, row.impressions),
        cpc: ratio(row.spend, row.clicks),
        cpm: ratio(row.spend * 1000, row.impressions),
        cpi: ratio(row.spend, row.installs),
      }),
    )
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        right.spend - left.spend ||
        left.channel.localeCompare(right.channel) ||
        left.platform.localeCompare(right.platform) ||
        left.optimizer.localeCompare(right.optimizer),
    )
  const start = (query.page - 1) * query.limit
  return {
    data: rows.slice(start, start + query.limit),
    total: rows.length,
  }
}

const getFreshness = async (
  query: AiAdsQuery,
  accountIdsForQuery: string[],
) => {
  const model =
    query.dimension === 'campaign' || query.dimension === 'delivery'
      ? AggCampaign
      : query.dimension === 'country'
        ? AggCountryAccount
        : AggAccount
  return (model as any)
    .findOne({
      date: { $gte: query.startDate, $lte: query.endDate },
      accountId: { $in: accountIdsForQuery },
    })
    .sort({ date: -1, updatedAt: -1 })
    .select('date updatedAt')
    .lean()
}

const getCoveredAccountIds = async (
  query: AiAdsQuery,
  accountIdsForQuery: string[],
): Promise<string[]> => {
  const model =
    query.dimension === 'campaign' || query.dimension === 'delivery'
      ? AggCampaign
      : query.dimension === 'country'
        ? AggCountryAccount
        : AggAccount
  return (model as any).distinct('accountId', {
    date: { $gte: query.startDate, $lte: query.endDate },
    accountId: { $in: accountIdsForQuery },
  })
}

const getOverview = async (query: AiAdsQuery, accountIds: string[]) => {
  const accountIdsForQuery = getAccountIdsForQuery(accountIds)
  const match = {
    date: { $gte: query.startDate, $lte: query.endDate },
    accountId: { $in: accountIdsForQuery },
  }
  const [metricRows, activeAccountRows, activeCampaignRows] = await Promise.all(
    [
      AggAccount.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            spend: { $sum: '$spend' },
            revenue: { $sum: '$revenue' },
            impressions: { $sum: '$impressions' },
            clicks: { $sum: '$clicks' },
            installs: { $sum: '$installs' },
          },
        },
        calculatedMetricsStage,
        { $project: { _id: 0 } },
      ]),
      AggAccount.distinct('accountId', { ...match, spend: { $gt: 0 } }),
      AggCampaign.distinct('campaignId', { ...match, spend: { $gt: 0 } }),
    ],
  )

  return {
    ...(metricRows[0] ||
      emptyResult(query, query.currency || null, accountIds.length).data),
    activeAccounts: activeAccountRows.length,
    activeCampaigns: activeCampaignRows.length,
  }
}

export const getAiAdsIntegrationData = async (query: AiAdsQuery) => {
  const scopedAccounts = await getScopedAccounts()
  if (scopedAccounts.length === 0) return emptyResult(query)

  const currencies = Array.from(
    new Set(scopedAccounts.map((account) => account.currency)),
  ).sort()
  if (!query.currency && currencies.length > 1) {
    throw new AiAdsQueryError(
      `multiple account currencies found (${currencies.join(', ')}); specify currency`,
    )
  }

  const selectedCurrency = query.currency || currencies[0]
  const accountIds = scopedAccounts
    .filter((account) => account.currency === selectedCurrency)
    .map((account) => account.accountId)
  if (accountIds.length === 0) {
    return emptyResult(query, selectedCurrency, 0)
  }

  const accountIdsForQuery = getAccountIdsForQuery(accountIds)
  const freshnessPromise = getFreshness(query, accountIdsForQuery)
  const coveragePromise = getCoveredAccountIds(query, accountIdsForQuery)

  if (query.dimension === 'overview') {
    const [rawData, freshness, coveredAccountRows] = await Promise.all([
      getOverview(query, accountIds),
      freshnessPromise,
      coveragePromise,
    ])
    const coveredAccounts = new Set(
      coveredAccountRows
        .map((accountId) => normalizeForStorage(accountId))
        .filter(Boolean),
    ).size
    const data = { ...rawData, currency: selectedCurrency }
    return {
      success: true,
      data,
      meta: {
        dimension: query.dimension,
        period: { startDate: query.startDate, endDate: query.endDate },
        source: 'autoark_preaggregated',
        scope: 'gaoyuhua',
        metricDefinitions: metricDefinitions(selectedCurrency),
        coverage: {
          scopedAccounts: accountIds.length,
          coveredAccounts,
          missingAccounts: Math.max(accountIds.length - coveredAccounts, 0),
          returnedRows: data ? 1 : 0,
        },
        freshness: {
          latestDate: (freshness as any)?.date || null,
          updatedAt: (freshness as any)?.updatedAt || null,
          complete: coveredAccounts === accountIds.length,
        },
      },
    }
  }

  const [aggregated, freshness, coveredAccountRows] = await Promise.all([
    query.dimension === 'delivery'
      ? getDelivery(query, accountIds)
      : aggregateDimension(query, accountIds),
    freshnessPromise,
    coveragePromise,
  ])
  const rawData =
    query.dimension === 'delivery'
      ? (aggregated as { data: DeliveryAggregateRow[]; total: number }).data
      : (aggregated as any[])[0]?.data || []
  const data = rawData.map((row: Record<string, unknown>) => ({
    ...row,
    currency: selectedCurrency,
  }))
  const total =
    query.dimension === 'delivery'
      ? (aggregated as { data: DeliveryAggregateRow[]; total: number }).total
      : (aggregated as any[])[0]?.total[0]?.count || 0
  const coveredAccounts = new Set(
    coveredAccountRows
      .map((accountId) => normalizeForStorage(accountId))
      .filter(Boolean),
  ).size

  return {
    success: true,
    data,
    meta: {
      dimension: query.dimension,
      period: { startDate: query.startDate, endDate: query.endDate },
      source: 'autoark_preaggregated',
      scope: 'gaoyuhua',
      metricDefinitions: metricDefinitions(selectedCurrency),
      coverage: {
        scopedAccounts: accountIds.length,
        coveredAccounts,
        missingAccounts: Math.max(accountIds.length - coveredAccounts, 0),
        returnedRows: data.length,
      },
      freshness: {
        latestDate: (freshness as any)?.date || null,
        updatedAt: (freshness as any)?.updatedAt || null,
        complete: coveredAccounts === accountIds.length,
      },
      ...(query.dimension === 'delivery'
        ? { namingContract: DELIVERY_NAMING_CONTRACT }
        : {}),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        pages: Math.ceil(total / query.limit),
      },
    },
  }
}
