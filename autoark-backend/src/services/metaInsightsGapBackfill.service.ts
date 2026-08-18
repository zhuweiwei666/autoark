import { isFacebookAggregationEnabled } from '../config/facebookSync'
import MetaInsightsCoverage from '../models/MetaInsightsCoverage'
import logger from '../utils/logger'
import { normalizeForStorage } from '../utils/accountId'
import { formatShanghaiDate } from '../utils/shanghaiDate'
import { refreshAggregation } from './aggregation.service'
import { freezeMatureMetaInsightsCoverage } from './metaInsightsPersistence.service'

const MAX_ACCOUNT_DATE_PAIRS_PER_RUN = 100

export interface MetaInsightsGapBackfillResult {
  attemptedPairs: number
  completedPairs: number
  pendingPairs: number
  frozenRows: number
  dates: string[]
}

let gapBackfillInFlight: Promise<MetaInsightsGapBackfillResult> | null = null

const runBackfill = async (): Promise<MetaInsightsGapBackfillResult> => {
  const now = new Date()
  if (!isFacebookAggregationEnabled()) {
    return {
      attemptedPairs: 0,
      completedPairs: 0,
      pendingPairs: 0,
      frozenRows: 0,
      dates: [],
    }
  }

  const gaps = await MetaInsightsCoverage.find({
    provider: 'facebook',
    status: { $in: ['stale', 'unavailable'] },
    date: { $lte: formatShanghaiDate(now) },
    $or: [{ nextRetryAt: { $exists: false } }, { nextRetryAt: { $lte: now } }],
  })
    .select('date accountId')
    .sort({ date: 1, nextRetryAt: 1 })
    .limit(MAX_ACCOUNT_DATE_PAIRS_PER_RUN)
    .lean()

  const accountsByDate = new Map<string, Set<string>>()
  for (const gap of gaps as any[]) {
    const accountId = normalizeForStorage(gap.accountId)
    if (!accountId || !gap.date) continue
    const accountIds = accountsByDate.get(gap.date) || new Set<string>()
    accountIds.add(accountId)
    accountsByDate.set(gap.date, accountIds)
  }

  let completedPairs = 0
  for (const [date, accountIdSet] of accountsByDate) {
    const accountIds = [...accountIdSet]
    const result = await refreshAggregation(date, true, {
      accountIds,
      ignoreRetryBackoff: true,
    })
    completedPairs += result.processedAccountIds.length
  }

  const frozenRows = await freezeMatureMetaInsightsCoverage(now)
  const attemptedPairs = gaps.length
  const result = {
    attemptedPairs,
    completedPairs,
    pendingPairs: Math.max(0, attemptedPairs - completedPairs),
    frozenRows,
    dates: [...accountsByDate.keys()],
  }
  logger.info(
    `[MetaInsightsGapBackfill] Attempted ${result.attemptedPairs} account-days; ` +
      `completed ${result.completedPairs}, pending ${result.pendingPairs}, ` +
      `froze ${result.frozenRows}`,
  )
  return result
}

export const runPendingMetaInsightsGapBackfill = async () => {
  if (gapBackfillInFlight) return gapBackfillInFlight
  gapBackfillInFlight = runBackfill().finally(() => {
    gapBackfillInFlight = null
  })
  return gapBackfillInFlight
}

export default runPendingMetaInsightsGapBackfill
