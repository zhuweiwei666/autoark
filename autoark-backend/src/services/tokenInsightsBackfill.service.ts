import Account from '../models/Account'
import FbToken from '../models/FbToken'
import { isFacebookAggregationEnabled } from '../config/facebookSync'
import logger from '../utils/logger'
import { normalizeForStorage } from '../utils/accountId'
import { refreshAggregation } from './aggregation.service'

const DAY_MS = 24 * 60 * 60 * 1000
const RETRY_INTERVAL_MS = 60 * 60 * 1000
const MAX_TOKEN_BATCH_SIZE = 5

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

const formatShanghaiDate = (timestamp: number) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp))

const getRecoveryDates = (now: Date) => [
  formatShanghaiDate(now.getTime()),
  formatShanghaiDate(now.getTime() - DAY_MS),
  formatShanghaiDate(now.getTime() - 2 * DAY_MS),
]

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
  const dates = getRecoveryDates(now)
  if (!isFacebookAggregationEnabled()) {
    logger.info(
      '[TokenInsightsBackfill] Aggregation disabled; leaving recovery pending',
    )
    return {
      attemptedTokens: 0,
      completedTokens: 0,
      pendingTokens: 0,
      attemptedAccounts: 0,
      dates,
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
    .select('_id')
    .sort({
      insightsBackfillLastAttemptAt: 1,
      insightsBackfillPendingSince: 1,
    })
    .limit(MAX_TOKEN_BATCH_SIZE)
    .lean()

  let completedTokens = 0
  let attemptedAccounts = 0

  for (const token of tokens) {
    const tokenId = String(token._id)
    await FbToken.findByIdAndUpdate(tokenId, {
      $set: { insightsBackfillLastAttemptAt: now },
    })

    const accounts = await Account.find({
      channel: 'facebook',
      tokenId,
      $or: [{ status: 'active' }, { insightsFinalizationUntil: { $gte: now } }],
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
    attemptedAccounts += accountIds.length

    let resolvedAccountIds = new Set(accountIds)
    for (const date of dates) {
      if (resolvedAccountIds.size === 0) break
      const result = await refreshAggregation(date, true, { accountIds })
      // 授权恢复必须拿到新的 Meta 响应才算完成；旧缓存只用于页面保底，
      // 不能清掉持久化重试任务。
      const resolvedForDate = new Set(result.processedAccountIds)
      resolvedAccountIds = new Set(
        [...resolvedAccountIds].filter((accountId) =>
          resolvedForDate.has(accountId),
        ),
      )
    }

    if (resolvedAccountIds.size === accountIds.length) {
      await FbToken.findByIdAndUpdate(tokenId, {
        $set: { insightsBackfillCompletedAt: now },
        $unset: {
          insightsBackfillPendingSince: 1,
          insightsBackfillLastAttemptAt: 1,
        },
      })
      completedTokens++
    }
  }

  const result = {
    attemptedTokens: tokens.length,
    completedTokens,
    pendingTokens: tokens.length - completedTokens,
    attemptedAccounts,
    dates,
  }
  logger.info(
    `[TokenInsightsBackfill] Attempted ${result.attemptedTokens} tokens / ` +
      `${result.attemptedAccounts} accounts; completed ${result.completedTokens}, ` +
      `pending ${result.pendingTokens} for ${dates.join(', ')}`,
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
