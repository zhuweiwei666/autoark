import Account from '../models/Account'
import FbToken from '../models/FbToken'
import { isFacebookAggregationEnabled } from '../config/facebookSync'
import logger from '../utils/logger'
import { normalizeForStorage } from '../utils/accountId'
import {
  addDateDays,
  enumerateDateRange,
  formatShanghaiDate,
  getMutableInsightsDates,
} from '../utils/shanghaiDate'
import { refreshAggregation } from './aggregation.service'
import { getFreshCoverageAccountIds } from './metaInsightsPersistence.service'

const RETRY_INTERVAL_MS = 60 * 60 * 1000
const MAX_TOKEN_BATCH_SIZE = 5
const MAX_DATES_PER_TOKEN_RUN = 7
const MAX_ACCOUNT_DATE_PAIRS_PER_TOKEN_RUN = 100

export interface TokenInsightsBackfillOptions {
  tokenIds?: string[]
}

export interface TokenInsightsBackfillResult {
  attemptedTokens: number
  completedTokens: number
  pendingTokens: number
  attemptedAccounts: number
  dates: string[]
}

export const markTokenInsightsBackfillPending = async (tokenId: string) => {
  const now = new Date()
  return FbToken.findByIdAndUpdate(tokenId, {
    $set: { insightsBackfillPendingSince: now },
    $unset: {
      insightsBackfillLastAttemptAt: 1,
      insightsBackfillCompletedAt: 1,
    },
  })
}

const runBackfill = async (
  options: TokenInsightsBackfillOptions,
): Promise<TokenInsightsBackfillResult> => {
  const now = new Date()
  const fallbackDates = getMutableInsightsDates(now)
  if (!isFacebookAggregationEnabled()) {
    logger.info(
      '[TokenInsightsBackfill] Aggregation disabled; leaving recovery pending',
    )
    return {
      attemptedTokens: 0,
      completedTokens: 0,
      pendingTokens: 0,
      attemptedAccounts: 0,
      dates: fallbackDates,
    }
  }

  const requestedTokenIds = Array.from(
    new Set((options.tokenIds || []).map(String).filter(Boolean)),
  )
  const tokenFilter: Record<string, unknown> = {
    status: 'active',
    insightsBackfillPendingSince: { $exists: true },
  }
  if (requestedTokenIds.length > 0) {
    tokenFilter._id = { $in: requestedTokenIds }
  } else {
    tokenFilter.$or = [
      { insightsBackfillLastAttemptAt: { $exists: false } },
      {
        insightsBackfillLastAttemptAt: {
          $lte: new Date(now.getTime() - RETRY_INTERVAL_MS),
        },
      },
    ]
  }

  const tokens = await FbToken.find(tokenFilter)
    .select(
      '_id insightsGapStartedAt insightsBackfillCursorDate '
      + 'insightsBackfillPendingSince',
    )
    .sort({
      insightsBackfillLastAttemptAt: 1,
      insightsBackfillPendingSince: 1,
    })
    .limit(MAX_TOKEN_BATCH_SIZE)
    .lean()

  let completedTokens = 0
  const attemptedAccountKeys = new Set<string>()
  const attemptedDates = new Set<string>()

  for (const token of tokens as any[]) {
    const tokenId = String(token._id)
    await FbToken.findByIdAndUpdate(tokenId, {
      $set: { insightsBackfillLastAttemptAt: now },
    })

    const today = formatShanghaiDate(now)
    const fallbackStartDate = fallbackDates[fallbackDates.length - 1]
    const gapStartDate = token.insightsBackfillCursorDate
      || (token.insightsGapStartedAt
        ? formatShanghaiDate(new Date(token.insightsGapStartedAt))
        : fallbackStartDate)
    const gapStartAt = new Date(`${gapStartDate}T00:00:00+08:00`)
    const accounts = await Account.find({
      channel: 'facebook',
      tokenId,
      $or: [
        { status: 'active' },
        { insightsFinalizationUntil: { $gte: now } },
        { insightsBackfillPendingSince: { $exists: true } },
        { statusChangedAt: { $gte: gapStartAt } },
        { lastActiveAt: { $gte: gapStartAt } },
      ],
    })
      .select('accountId')
      .lean()
    const accountIds = Array.from(
      new Set(
        accounts
          .map((account) => normalizeForStorage(account.accountId || ''))
          .filter(Boolean),
      ),
    )
    let nextCursorDate = gapStartDate > today ? today : gapStartDate
    let remainingPairBudget = MAX_ACCOUNT_DATE_PAIRS_PER_TOKEN_RUN
    let tokenComplete = accountIds.length === 0
    const dates = enumerateDateRange(
      nextCursorDate,
      today,
      MAX_DATES_PER_TOKEN_RUN,
    )

    for (const date of dates) {
      attemptedDates.add(date)
      const alreadyFresh = await getFreshCoverageAccountIds(date, accountIds)
      const missingAccountIds = accountIds.filter((accountId) =>
        !alreadyFresh.has(accountId),
      )

      if (missingAccountIds.length === 0) {
        nextCursorDate = addDateDays(date, 1)
        tokenComplete = nextCursorDate > today
        continue
      }

      const accountIdsForAttempt = missingAccountIds.slice(0, remainingPairBudget)
      if (accountIdsForAttempt.length === 0) {
        tokenComplete = false
        nextCursorDate = date
        break
      }
      accountIdsForAttempt.forEach((accountId) =>
        attemptedAccountKeys.add(`${tokenId}:${accountId}`),
      )
      remainingPairBudget -= accountIdsForAttempt.length

      const result = await refreshAggregation(date, true, {
        accountIds: accountIdsForAttempt,
        ignoreRetryBackoff: true,
      })
      // 授权恢复必须拿到新的 Meta 响应才算完成；旧缓存只用于页面保底，
      // 不能清掉持久化重试任务。
      const resolvedForAttempt = new Set(result.processedAccountIds)
      const attemptedResolved = accountIdsForAttempt.every((accountId) =>
        resolvedForAttempt.has(accountId),
      )
      const allAccountsWereAttempted = accountIdsForAttempt.length === missingAccountIds.length

      if (!attemptedResolved || !allAccountsWereAttempted) {
        tokenComplete = false
        nextCursorDate = date
        break
      }

      nextCursorDate = addDateDays(date, 1)
      tokenComplete = nextCursorDate > today
      if (remainingPairBudget <= 0 && !tokenComplete) break
    }

    if (dates.length === MAX_DATES_PER_TOKEN_RUN && nextCursorDate <= today) {
      tokenComplete = false
    }

    if (tokenComplete) {
      await FbToken.findByIdAndUpdate(tokenId, {
        $set: { insightsBackfillCompletedAt: now },
        $unset: {
          insightsBackfillPendingSince: 1,
          insightsBackfillLastAttemptAt: 1,
          insightsGapStartedAt: 1,
          insightsBackfillCursorDate: 1,
        },
      })
      completedTokens++
    } else {
      await FbToken.findByIdAndUpdate(tokenId, {
        $set: { insightsBackfillCursorDate: nextCursorDate },
      })
    }
  }

  const result = {
    attemptedTokens: tokens.length,
    completedTokens,
    pendingTokens: tokens.length - completedTokens,
    attemptedAccounts: attemptedAccountKeys.size,
    dates: [...attemptedDates],
  }
  logger.info(
    `[TokenInsightsBackfill] Attempted ${result.attemptedTokens} tokens / ` +
      `${result.attemptedAccounts} accounts; completed ${result.completedTokens}, ` +
      `pending ${result.pendingTokens} for ${result.dates.join(', ')}`,
  )
  return result
}

let backfillQueue: Promise<unknown> = Promise.resolve()

export const runPendingTokenInsightsBackfill = (
  options: TokenInsightsBackfillOptions = {},
): Promise<TokenInsightsBackfillResult> => {
  const request = backfillQueue.then(() => runBackfill(options))
  backfillQueue = request.catch(() => undefined)
  return request
}

export default runPendingTokenInsightsBackfill
