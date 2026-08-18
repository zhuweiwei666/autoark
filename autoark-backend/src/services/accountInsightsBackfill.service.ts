import Account from '../models/Account'
import logger from '../utils/logger'
import { refreshAggregation } from './aggregation.service'
import { isFacebookAggregationEnabled } from '../config/facebookSync'
import { getAccountIdsForQuery, normalizeForStorage } from '../utils/accountId'

const DAY_MS = 24 * 60 * 60 * 1000
const RETRY_INTERVAL_MS = 60 * 60 * 1000
const MAX_BATCH_SIZE = 100

export interface AccountInsightsBackfillResult {
  attemptedAccounts: number
  completedAccounts: number
  pendingAccounts: number
  dates: string[]
}

const formatShanghaiDate = (timestamp: number) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date(timestamp))

const getHistoricalFinalizationDates = (now: Date) => [
  formatShanghaiDate(now.getTime() - DAY_MS),
  formatShanghaiDate(now.getTime() - (2 * DAY_MS)),
]

let backfillInFlight: Promise<AccountInsightsBackfillResult> | null = null

const runBackfill = async (): Promise<AccountInsightsBackfillResult> => {
  const now = new Date()
  const dates = getHistoricalFinalizationDates(now)
  if (!isFacebookAggregationEnabled()) {
    logger.info('[AccountInsightsBackfill] Aggregation disabled; skipping backfill')
    return {
      attemptedAccounts: 0,
      completedAccounts: 0,
      pendingAccounts: 0,
      dates,
    }
  }

  const retryBefore = new Date(now.getTime() - RETRY_INTERVAL_MS)
  const pendingAccounts = await Account.find({
    channel: 'facebook',
    insightsBackfillPendingSince: { $exists: true },
    $or: [
      { insightsBackfillLastAttemptAt: { $exists: false } },
      { insightsBackfillLastAttemptAt: { $lte: retryBefore } },
    ],
  })
    .select('accountId')
    .sort({
      insightsBackfillLastAttemptAt: 1,
      insightsBackfillPendingSince: 1,
    })
    .limit(MAX_BATCH_SIZE)
    .lean()

  const accountIds = Array.from(new Set(
    pendingAccounts
      .map((account: any) => normalizeForStorage(account.accountId || ''))
      .filter(Boolean),
  ))
  if (accountIds.length === 0) {
    return {
      attemptedAccounts: 0,
      completedAccounts: 0,
      pendingAccounts: 0,
      dates,
    }
  }

  await Account.updateMany(
    {
      channel: 'facebook',
      accountId: { $in: getAccountIdsForQuery(accountIds) },
    },
    { $set: { insightsBackfillLastAttemptAt: now } },
  )

  let completedAccountIds = new Set(accountIds)
  for (const date of dates) {
    const result = await refreshAggregation(date, true, {
      accountIds,
      ignoreRetryBackoff: true,
    })
    // 缓存只保证页面不归零，不能证明该日已用有效授权完成最终结算。
    const resolvedForDate = new Set(result.processedAccountIds)
    completedAccountIds = new Set(
      [...completedAccountIds].filter(accountId => resolvedForDate.has(accountId)),
    )
  }

  if (completedAccountIds.size > 0) {
    await Account.updateMany(
      {
        channel: 'facebook',
        accountId: { $in: getAccountIdsForQuery([...completedAccountIds]) },
      },
      {
        $set: { insightsBackfillCompletedAt: now },
        $unset: {
          insightsBackfillPendingSince: 1,
          insightsBackfillLastAttemptAt: 1,
        },
      },
    )
  }

  const result = {
    attemptedAccounts: accountIds.length,
    completedAccounts: completedAccountIds.size,
    pendingAccounts: accountIds.length - completedAccountIds.size,
    dates,
  }
  logger.info(
    `[AccountInsightsBackfill] Attempted ${result.attemptedAccounts}, `
      + `completed ${result.completedAccounts}, pending ${result.pendingAccounts} `
      + `for ${dates.join(', ')}`,
  )
  return result
}

export const runPendingAccountInsightsBackfill = async () => {
  if (backfillInFlight) {
    logger.info('[AccountInsightsBackfill] Reusing in-flight backfill')
    return backfillInFlight
  }

  backfillInFlight = runBackfill().finally(() => {
    backfillInFlight = null
  })
  return backfillInFlight
}

export default runPendingAccountInsightsBackfill
