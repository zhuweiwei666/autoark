import AdPerformanceBreakdown from '../models/AdPerformanceBreakdown'
import { fetchFacebookEdgePages } from '../integration/facebook/pagination'
import { normalizeForApi, normalizeForStorage } from '../utils/accountId'

export type OptimizerInsightKind = 'country' | 'placement' | 'hourly'

type OptimizerAccountSource = {
  accountId: string
  token: string
  tokenId?: any
  operator?: string
  organizationId?: any
  currency?: string
}

type DateWindow = {
  since: string
  until: string
}

const PURCHASE_ACTION_TYPES = [
  'purchase',
  'mobile_app_purchase',
  'offsite_conversion.fb_pixel_purchase',
  'onsite_conversion.purchase',
  'onsite_conversion.purchase.mobile_app',
]

const BREAKDOWNS: Record<OptimizerInsightKind, string[]> = {
  country: ['country'],
  placement: ['publisher_platform', 'platform_position', 'impression_device'],
  hourly: ['hourly_stats_aggregated_by_advertiser_time_zone'],
}

const INSIGHT_FIELDS = [
  'campaign_id',
  'adset_id',
  'ad_id',
  'impressions',
  'clicks',
  'spend',
  'actions',
  'action_values',
  'purchase_roas',
  'date_start',
  'date_stop',
].join(',')

const finiteNumber = (value: any): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const actionValue = (actions: any, types = PURCHASE_ACTION_TYPES): number => {
  if (!Array.isArray(actions)) return 0
  for (const actionType of types) {
    const match = actions.find(
      (entry: any) => entry?.action_type === actionType,
    )
    if (match) return finiteNumber(match.value)
  }
  return 0
}

const safeErrorMessage = (error: any): string => {
  const value =
    error?.userMessage || error?.message || 'Facebook Insights request failed'
  return String(value)
    .replace(/access_token=[^&\s]+/gi, 'access_token=[REDACTED]')
    .slice(0, 500)
}

const dimensionForRow = (kind: OptimizerInsightKind, row: any) => {
  if (kind === 'country') {
    const country = String(row.country || 'unknown')
    return {
      dimensionKey: country,
      dimension: { country },
    }
  }

  if (kind === 'placement') {
    const publisherPlatform = String(row.publisher_platform || 'unknown')
    const platformPosition = String(row.platform_position || 'unknown')
    const impressionDevice = String(row.impression_device || 'unknown')
    return {
      dimensionKey: [
        publisherPlatform,
        platformPosition,
        impressionDevice,
      ].join('|'),
      dimension: { publisherPlatform, platformPosition, impressionDevice },
    }
  }

  const hour = String(
    row.hourly_stats_aggregated_by_advertiser_time_zone ||
      row.hourly_stats_aggregated_by_audience_time_zone ||
      'unknown',
  )
  return {
    dimensionKey: hour,
    dimension: { hour },
  }
}

export const normalizeOptimizerInsightRow = ({
  kind,
  row,
  account,
  sourceSyncedAt,
}: {
  kind: OptimizerInsightKind
  row: any
  account: OptimizerAccountSource
  sourceSyncedAt: Date
}) => {
  const spend = finiteNumber(row.spend)
  const purchaseValue = actionValue(row.action_values)
  const purchases = actionValue(row.actions)
  const { dimensionKey, dimension } = dimensionForRow(kind, row)

  return {
    date: String(row.date_start || ''),
    kind,
    dimensionKey,
    dimension,
    organizationId: account.organizationId,
    tokenId: account.tokenId,
    optimizer: account.operator,
    accountId: normalizeForStorage(account.accountId),
    currency: account.currency,
    campaignId: row.campaign_id ? String(row.campaign_id) : undefined,
    adsetId: row.adset_id ? String(row.adset_id) : undefined,
    adId: row.ad_id ? String(row.ad_id) : '',
    spend,
    impressions: finiteNumber(row.impressions),
    clicks: finiteNumber(row.clicks),
    purchases,
    purchaseValue,
    roas: spend > 0 ? purchaseValue / spend : 0,
    sourceSyncedAt,
  }
}

const persistRows = async (rows: any[]) => {
  if (rows.length === 0) return
  const operations = rows.map((row) => ({
    updateOne: {
      filter: {
        date: row.date,
        adId: row.adId,
        kind: row.kind,
        dimensionKey: row.dimensionKey,
      },
      update: { $set: row },
      upsert: true,
    },
  }))

  const chunkSize = 1000
  for (let index = 0; index < operations.length; index += chunkSize) {
    await AdPerformanceBreakdown.bulkWrite(
      operations.slice(index, index + chunkSize),
      {
        ordered: false,
      },
    )
  }
}

const replaceRows = async ({
  accountId,
  kind,
  window,
  rows,
}: {
  accountId: string
  kind: OptimizerInsightKind
  window: DateWindow
  rows: any[]
}) => {
  await AdPerformanceBreakdown.deleteMany({
    accountId: normalizeForStorage(accountId),
    kind,
    date: { $gte: window.since, $lte: window.until },
  })
  await persistRows(rows)
}

export const collectOptimizerAccountInsights = async ({
  account,
  window,
  kinds = ['country', 'placement', 'hourly'],
}: {
  account: OptimizerAccountSource
  window: DateWindow
  kinds?: OptimizerInsightKind[]
}) => {
  const sourceSyncedAt = new Date()
  const maxPages = Math.min(
    100,
    Math.max(1, Number(process.env.AI_OPTIMIZER_INSIGHTS_MAX_PAGES || 50)),
  )

  const settled = await Promise.all(
    kinds.map(async (kind) => {
      try {
        const rows = await fetchFacebookEdgePages<any>(
          `/${normalizeForApi(account.accountId)}/insights`,
          {
            access_token: account.token,
            level: 'ad',
            fields: INSIGHT_FIELDS,
            time_range: JSON.stringify(window),
            time_increment: 1,
            breakdowns: BREAKDOWNS[kind].join(','),
            limit: 1000,
          },
          { maxPages },
        )
        const normalized = rows
          .map((row) =>
            normalizeOptimizerInsightRow({
              kind,
              row,
              account,
              sourceSyncedAt,
            }),
          )
          .filter((row) => row.date && row.adId)

        // A successful response is the complete truth for this
        // account/dimension/window. Replace the derived cache so attribution
        // corrections and disappeared rows cannot survive as stale winners.
        await replaceRows({
          accountId: account.accountId,
          kind,
          window,
          rows: normalized,
        })
        return {
          kind,
          status: 'complete' as const,
          rows: normalized.length,
          error: undefined,
        }
      } catch (error: any) {
        return {
          kind,
          status: 'failed' as const,
          rows: 0,
          error: safeErrorMessage(error),
        }
      }
    }),
  )

  return {
    accountId: normalizeForStorage(account.accountId),
    sourceSyncedAt,
    dimensions: Object.fromEntries(
      settled.map((result) => [result.kind, result]),
    ),
  }
}

export const collectOptimizerInsights = async ({
  accounts,
  window,
}: {
  accounts: OptimizerAccountSource[]
  window: DateWindow
}) => {
  const maxAccounts = Math.min(
    50,
    Math.max(1, Number(process.env.AI_OPTIMIZER_MAX_SOURCE_ACCOUNTS || 20)),
  )
  const selectedAccounts = accounts.slice(0, maxAccounts)
  const accountResults: any[] = []
  const concurrency = Math.min(
    5,
    Math.max(1, Number(process.env.AI_OPTIMIZER_INSIGHTS_CONCURRENCY || 2)),
  )

  for (let index = 0; index < selectedAccounts.length; index += concurrency) {
    const batch = selectedAccounts.slice(index, index + concurrency)
    accountResults.push(
      ...(await Promise.all(
        batch.map((account) =>
          collectOptimizerAccountInsights({ account, window }),
        ),
      )),
    )
  }

  const dimensions = Object.fromEntries(
    (['country', 'placement', 'hourly'] as OptimizerInsightKind[]).map(
      (kind) => {
        const results = accountResults.map((result) => result.dimensions[kind])
        const accountsSucceeded = results.filter(
          (result) => result?.status === 'complete',
        ).length
        const rows = results.reduce(
          (sum, result) => sum + finiteNumber(result?.rows),
          0,
        )
        const errors = accountResults
          .map((result) =>
            result.dimensions[kind]?.error
              ? {
                  accountId: result.accountId,
                  error: result.dimensions[kind].error,
                }
              : null,
          )
          .filter(Boolean)

        return [
          kind,
          {
            status:
              accountsSucceeded === selectedAccounts.length
                ? 'complete'
                : accountsSucceeded > 0
                  ? 'partial'
                  : 'failed',
            rows,
            accountsAttempted: selectedAccounts.length,
            accountsSucceeded,
            errors,
          },
        ]
      },
    ),
  )

  return {
    collectedAt: new Date(),
    totalAccounts: accounts.length,
    attemptedAccounts: selectedAccounts.length,
    truncatedAccounts: Math.max(accounts.length - selectedAccounts.length, 0),
    dimensions,
    accounts: accountResults,
  }
}
