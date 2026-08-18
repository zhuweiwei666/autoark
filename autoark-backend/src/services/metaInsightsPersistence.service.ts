import { createHash, randomUUID } from 'crypto'
import { FB_API_VERSION } from '../config/facebook.config'
import MetaInsightsCoverage, {
  MetaInsightsCoverageStatus,
} from '../models/MetaInsightsCoverage'
import MetaInsightsFact, {
  MetaInsightsAuthorizationType,
} from '../models/MetaInsightsFact'
import { isRecentDate } from '../models/Aggregation'
import { normalizeForStorage } from '../utils/accountId'
import { getFrozenBeforeDate } from '../utils/shanghaiDate'

const FACT_BULK_MAX_OPERATIONS = 1000
const COVERAGE_BULK_MAX_OPERATIONS = 1000
const DEFAULT_RETRY_MS = 60 * 60 * 1000
const AUTH_RETRY_MS = 6 * 60 * 60 * 1000

type AuthorizationMetadata = {
  authorizationType?: MetaInsightsAuthorizationType
  metaCredentialId?: string
  legacyTokenId?: string
}

export type MetaInsightsFactRow = {
  provider: 'facebook'
  date: string
  accountId: string
  accountName: string
  campaignId: string
  campaignName: string
  optimizer: string
  country: string
  spend: number
  revenue: number
  impressions: number
  clicks: number
  installs: number
  sourceHash: string
  snapshotId: string
  sourceApiVersion: string
  authorizationType: MetaInsightsAuthorizationType
  authorizationId?: string
  fetchedAt: Date
}

export type MetaInsightsFactSnapshot = {
  date: string
  accountId: string
  snapshotId: string
  rows: MetaInsightsFactRow[]
}

export type MetaInsightsCoverageOutcome = {
  date: string
  accountId: string
  status: MetaInsightsCoverageStatus
  hasSnapshot: boolean
  factRows?: number
  authorizationType?: MetaInsightsAuthorizationType
  authorizationId?: string
  error?: unknown
}

const numeric = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const integer = (value: unknown): number => Math.trunc(numeric(value))

const extractRevenue = (insight: any): number => {
  if (!Array.isArray(insight?.action_values)) return 0
  const purchase = insight.action_values.find((action: any) =>
    ['purchase', 'mobile_app_purchase', 'omni_purchase'].includes(
      action?.action_type,
    ),
  )
  return numeric(purchase?.value)
}

const extractInstalls = (insight: any): number => {
  if (!Array.isArray(insight?.actions)) return 0
  return insight.actions.reduce(
    (total: number, action: any) =>
      action?.action_type === 'mobile_app_install'
        ? total + integer(action.value)
        : total,
    0,
  )
}

const roundMoney = (value: number): number => Math.round(value * 100) / 100

const factHash = (row: Omit<MetaInsightsFactRow, 'sourceHash'>): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        date: row.date,
        accountId: row.accountId,
        campaignId: row.campaignId,
        country: row.country,
        spend: row.spend,
        revenue: row.revenue,
        impressions: row.impressions,
        clicks: row.clicks,
        installs: row.installs,
      }),
    )
    .digest('hex')

const authorizationIdentity = (authorization?: AuthorizationMetadata) => ({
  authorizationType:
    authorization?.authorizationType ||
    ('unknown' as MetaInsightsAuthorizationType),
  authorizationId:
    authorization?.metaCredentialId || authorization?.legacyTokenId,
})

export const buildMetaInsightsFactSnapshot = (input: {
  date: string
  accountId: string
  accountName?: string
  insights: any[]
  campaignNameMap?: Map<string, string>
  authorization?: AuthorizationMetadata
  fetchedAt?: Date
}): MetaInsightsFactSnapshot => {
  const accountId = normalizeForStorage(input.accountId)
  const snapshotId = randomUUID()
  const fetchedAt = input.fetchedAt || new Date()
  const authorization = authorizationIdentity(input.authorization)
  const rowsByKey = new Map<string, Omit<MetaInsightsFactRow, 'sourceHash'>>()

  for (const insight of input.insights || []) {
    const campaignId = String(insight?.campaign_id || 'unknown')
    const country = String(insight?.country || 'unknown').toUpperCase()
    const campaignName =
      input.campaignNameMap?.get(campaignId) ||
      String(insight?.campaign_name || '')
    const key = `${campaignId}\u0000${country}`
    const existing = rowsByKey.get(key)
    const spend = numeric(insight?.spend)
    const revenue = extractRevenue(insight)
    const impressions = integer(insight?.impressions)
    const clicks = integer(insight?.clicks)
    const installs = extractInstalls(insight)

    if (existing) {
      existing.spend = roundMoney(existing.spend + spend)
      existing.revenue = roundMoney(existing.revenue + revenue)
      existing.impressions += impressions
      existing.clicks += clicks
      existing.installs += installs
      continue
    }

    rowsByKey.set(key, {
      provider: 'facebook',
      date: input.date,
      accountId,
      accountName: input.accountName || '',
      campaignId,
      campaignName,
      optimizer: campaignName.split('_')[0] || 'unknown',
      country,
      spend: roundMoney(spend),
      revenue: roundMoney(revenue),
      impressions,
      clicks,
      installs,
      snapshotId,
      sourceApiVersion: FB_API_VERSION,
      ...authorization,
      fetchedAt,
    })
  }

  return {
    date: input.date,
    accountId,
    snapshotId,
    rows: [...rowsByKey.values()].map((row) => ({
      ...row,
      sourceHash: factHash(row),
    })),
  }
}

const factOperationsForSnapshot = (
  snapshot: MetaInsightsFactSnapshot,
): any[] => {
  const operations: any[] = snapshot.rows.map((row) => ({
    updateOne: {
      filter: {
        provider: row.provider,
        date: row.date,
        accountId: row.accountId,
        campaignId: row.campaignId,
        country: row.country,
      },
      update: {
        $set: row,
        $setOnInsert: { firstSeenAt: row.fetchedAt },
      },
      upsert: true,
    },
  }))
  operations.push({
    deleteMany: {
      filter: {
        provider: 'facebook',
        date: snapshot.date,
        accountId: snapshot.accountId,
        ...(snapshot.rows.length > 0
          ? { snapshotId: { $ne: snapshot.snapshotId } }
          : {}),
      },
    },
  })
  return operations
}

export const persistMetaInsightsFactSnapshots = async (
  snapshots: MetaInsightsFactSnapshot[],
): Promise<void> => {
  let batch: any[] = []
  const flush = async () => {
    if (batch.length === 0) return
    await MetaInsightsFact.bulkWrite(batch, { ordered: true })
    batch = []
  }

  for (const snapshot of snapshots) {
    const operations = factOperationsForSnapshot(snapshot)
    if (operations.length > FACT_BULK_MAX_OPERATIONS) {
      await flush()
      await MetaInsightsFact.bulkWrite(operations, { ordered: true })
      continue
    }
    if (batch.length + operations.length > FACT_BULK_MAX_OPERATIONS) {
      await flush()
    }
    batch.push(...operations)
  }
  await flush()
}

export const beginMetaInsightsCoverageAttempts = async (
  date: string,
  accountIds: string[],
  attemptedAt = new Date(),
): Promise<void> => {
  const normalizedAccountIds = Array.from(
    new Set(accountIds.map(normalizeForStorage).filter(Boolean)),
  )
  if (normalizedAccountIds.length === 0) return

  const nextRetryAt = new Date(attemptedAt.getTime() + DEFAULT_RETRY_MS)
  const baseFilter: any = {
    provider: 'facebook',
    date,
    accountId: { $in: normalizedAccountIds },
  }

  // Mark an existing snapshot stale while it is being refreshed. If the
  // process dies after the API call starts, the durable row remains retryable
  // instead of incorrectly claiming that the old snapshot is fresh.
  await Promise.all([
    MetaInsightsCoverage.updateMany(
      { ...baseFilter, hasSnapshot: true },
      {
        $set: { status: 'stale', lastAttemptAt: attemptedAt, nextRetryAt },
        $unset: { frozenAt: '' },
        $inc: { attemptCount: 1 },
      },
    ),
    MetaInsightsCoverage.updateMany(
      { ...baseFilter, hasSnapshot: { $ne: true } },
      {
        $set: {
          status: 'unavailable',
          lastAttemptAt: attemptedAt,
          nextRetryAt,
        },
        $unset: { frozenAt: '' },
        $inc: { attemptCount: 1 },
      },
    ),
  ])

  for (
    let offset = 0;
    offset < normalizedAccountIds.length;
    offset += COVERAGE_BULK_MAX_OPERATIONS
  ) {
    const batch = normalizedAccountIds.slice(
      offset,
      offset + COVERAGE_BULK_MAX_OPERATIONS,
    )
    await MetaInsightsCoverage.bulkWrite(
      batch.map((accountId) => ({
        updateOne: {
          filter: { provider: 'facebook', date, accountId },
          update: {
            $setOnInsert: {
              provider: 'facebook',
              date,
              accountId,
              status: 'unavailable',
              hasSnapshot: false,
              factRows: 0,
              lastAttemptAt: attemptedAt,
              nextRetryAt,
              attemptCount: 1,
              consecutiveFailures: 0,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    )
  }
}

const errorSummary = (error: any) => ({
  code:
    Number(
      error?.code ||
        error?.response?.error?.code ||
        error?.response?.data?.error?.code,
    ) || undefined,
  subcode:
    Number(
      error?.subcode ||
        error?.response?.error?.error_subcode ||
        error?.response?.data?.error?.error_subcode,
    ) || undefined,
  message: String(
    error?.userMessage || error?.message || error || 'Insights unavailable',
  )
    .replace(/\bEAA[A-Za-z0-9_-]{12,}/g, '[REDACTED_FB_TOKEN]')
    .slice(0, 500),
})

const retryDelay = (error: any): number => {
  const summary = errorSummary(error)
  if (
    summary.code === 190 ||
    /authorization|token|credential/i.test(summary.message)
  ) {
    return AUTH_RETRY_MS
  }
  return DEFAULT_RETRY_MS
}

export const persistMetaInsightsCoverageOutcomes = async (
  outcomes: MetaInsightsCoverageOutcome[],
  attemptedAt = new Date(),
): Promise<void> => {
  if (outcomes.length === 0) return
  const operations: any[] = outcomes.map((outcome) => {
    const accountId = normalizeForStorage(outcome.accountId)
    const filter = { provider: 'facebook', date: outcome.date, accountId }
    if (outcome.status === 'fresh') {
      return {
        updateOne: {
          filter,
          update: {
            $set: {
              provider: 'facebook',
              date: outcome.date,
              accountId,
              status: 'fresh',
              hasSnapshot: true,
              factRows: outcome.factRows || 0,
              lastAttemptAt: attemptedAt,
              lastSuccessAt: attemptedAt,
              consecutiveFailures: 0,
              sourceApiVersion: FB_API_VERSION,
              authorizationType: outcome.authorizationType || 'unknown',
              ...(outcome.authorizationId
                ? { authorizationId: outcome.authorizationId }
                : {}),
              ...(!isRecentDate(outcome.date) ? { frozenAt: attemptedAt } : {}),
            },
            $unset: {
              lastFailureAt: '',
              nextRetryAt: '',
              lastErrorCode: '',
              lastErrorSubcode: '',
              lastErrorMessage: '',
              ...(outcome.authorizationId ? {} : { authorizationId: '' }),
            },
          },
          upsert: true,
        },
      }
    }

    const summary = errorSummary(outcome.error)
    return {
      updateOne: {
        filter,
        update: {
          $set: {
            provider: 'facebook',
            date: outcome.date,
            accountId,
            status: outcome.status,
            hasSnapshot: outcome.hasSnapshot,
            ...(outcome.factRows !== undefined
              ? { factRows: outcome.factRows }
              : {}),
            lastAttemptAt: attemptedAt,
            lastFailureAt: attemptedAt,
            nextRetryAt: new Date(
              attemptedAt.getTime() + retryDelay(outcome.error),
            ),
            lastErrorMessage: summary.message,
            ...(summary.code !== undefined
              ? { lastErrorCode: summary.code }
              : {}),
            ...(summary.subcode !== undefined
              ? { lastErrorSubcode: summary.subcode }
              : {}),
          },
          $unset: {
            frozenAt: '',
            ...(summary.code === undefined ? { lastErrorCode: '' } : {}),
            ...(summary.subcode === undefined ? { lastErrorSubcode: '' } : {}),
          },
          $inc: { consecutiveFailures: 1 },
        },
        upsert: true,
      },
    }
  })
  await MetaInsightsCoverage.bulkWrite(operations, { ordered: false })
}

export const getDeferredInsightsAccountIds = async (
  date: string,
  accountIds: string[],
  now = new Date(),
): Promise<Set<string>> => {
  if (accountIds.length === 0) return new Set()
  const rows = await MetaInsightsCoverage.find({
    provider: 'facebook',
    date,
    accountId: { $in: accountIds.map(normalizeForStorage) },
    status: { $in: ['stale', 'unavailable'] },
    nextRetryAt: { $gt: now },
  })
    .select('accountId')
    .lean()
  return new Set(rows.map((row: any) => normalizeForStorage(row.accountId)))
}

export const getFreshCoverageAccountIds = async (
  date: string,
  accountIds: string[],
): Promise<Set<string>> => {
  if (accountIds.length === 0) return new Set()
  const rows = await MetaInsightsCoverage.find({
    provider: 'facebook',
    date,
    accountId: { $in: accountIds.map(normalizeForStorage) },
    status: 'fresh',
    hasSnapshot: true,
  })
    .select('accountId')
    .lean()
  return new Set(rows.map((row: any) => normalizeForStorage(row.accountId)))
}

export const getCoverageSnapshotAccountIds = async (
  date: string,
  accountIds: string[],
): Promise<Set<string>> => {
  if (accountIds.length === 0) return new Set()
  const rows = await MetaInsightsCoverage.find({
    provider: 'facebook',
    date,
    accountId: { $in: accountIds.map(normalizeForStorage) },
    hasSnapshot: true,
  })
    .select('accountId')
    .lean()
  return new Set(rows.map((row: any) => normalizeForStorage(row.accountId)))
}

export const freezeMatureMetaInsightsCoverage = async (
  now = new Date(),
): Promise<number> => {
  const result = await MetaInsightsCoverage.updateMany(
    {
      provider: 'facebook',
      date: { $lt: getFrozenBeforeDate(now) },
      status: 'fresh',
      hasSnapshot: true,
      frozenAt: { $exists: false },
    },
    { $set: { frozenAt: now } },
  )
  return result.modifiedCount || 0
}
