import axios from 'axios'
import FbToken, { IFbToken } from '../models/FbToken'
import logger from '../utils/logger'
import { FB_API_VERSION, FB_BASE_URL } from '../config/facebook.config'

const TOKEN_VALIDATION_BATCH_LIMIT = 100
const TOKEN_VALIDATION_MAX_BATCH_LIMIT = 500
const TOKEN_VALIDATION_CONCURRENCY = 5
const TOKEN_VALIDATION_MAX_CONCURRENCY = 10

type SettledResult<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: unknown }

export type TokenValidationBatchSummary = {
  totalFound: number
  checked: number
  succeeded: number
  failed: number
  valid: number
  invalid: number
  transient: number
  limit: number
  concurrency: number
}

export type TokenValidationResult = {
  isValid: boolean
  fbUser?: any
  expiresAt?: Date
  error?: string
  errorCode?: number
  failureKind?: 'invalid' | 'transient'
}

export type TokenStatusCheckResult = {
  status: 'active' | 'expired' | 'invalid'
  outcome: 'valid' | 'invalid' | 'transient'
}

const parseBoundedPositiveInt = (value: any, fallback: number, max: number): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(max, Math.floor(parsed))
}

const runWithConcurrency = async <Input, Output>(
  items: Input[],
  concurrency: number,
  worker: (item: Input) => Promise<Output>,
): Promise<Array<SettledResult<Output>>> => {
  const results: Array<SettledResult<Output>> = []
  let nextIndex = 0

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      try {
        results[currentIndex] = {
          status: 'fulfilled',
          value: await worker(items[currentIndex]),
        }
      } catch (error) {
        results[currentIndex] = {
          status: 'rejected',
          reason: error,
        }
      }
    }
  })

  await Promise.all(workers)
  return results
}

/**
 * 验证单个 token 是否有效
 * @param token Facebook access token
 * @returns { isValid: boolean, fbUser?: any, expiresAt?: Date }
 */
export async function validateToken(
  token: string,
): Promise<TokenValidationResult> {
  try {
    // 检查 token 基本信息
    const userResponse = await axios.get(
      `${FB_BASE_URL}/${FB_API_VERSION}/me`,
      {
        params: {
          access_token: token,
          fields: 'id,name,email',
        },
        timeout: 10000, // 10 秒超时
      },
    )

    if (!userResponse.data || !userResponse.data.id) {
      return {
        isValid: false,
        error: 'Invalid token response',
        failureKind: 'transient',
      }
    }

    // 检查 token 的权限和过期时间
    let expiresAt: Date | undefined
    try {
      const debugResponse = await axios.get(
        `${FB_BASE_URL}/${FB_API_VERSION}/debug_token`,
        {
          params: {
            input_token: token,
            access_token: token, // 需要 app access token，这里用 user token 也可以
          },
          timeout: 10000,
        },
      )

      if (debugResponse.data?.data) {
        const data = debugResponse.data.data
        // expires_at 是 Unix 时间戳（秒）
        if (data.expires_at && data.expires_at > 0) {
          expiresAt = new Date(data.expires_at * 1000)
        }
      }
    } catch (debugErr: any) {
      // debug_token 可能失败，但不影响基本验证
      const debugCode = debugErr.response?.data?.error?.code ?? 'unknown'
      const debugStatus = debugErr.response?.status ?? 'unknown'
      const debugMessage =
        debugErr.response?.data?.error?.message || debugErr.message || 'Unknown error'
      logger.warn(
        `[Token Validation] Token debug info unavailable: code=${debugCode}, status=${debugStatus}, message=${debugMessage}`,
      )
    }

    return {
      isValid: true,
      fbUser: userResponse.data,
      expiresAt,
    }
  } catch (error: any) {
    const errorMessage =
      error.response?.data?.error?.message || error.message || 'Unknown error'
    const rawErrorCode = error.response?.data?.error?.code
    const errorCode = Number.isFinite(Number(rawErrorCode))
      ? Number(rawErrorCode)
      : undefined

    // Facebook API 错误码：
    // 190: Invalid OAuth 2.0 Access Token
    // 102: Session key invalid or no longer valid
    if (errorCode === 190 || errorCode === 102) {
      return {
        isValid: false,
        error: errorMessage,
        errorCode,
        failureKind: 'invalid',
      }
    }

    // 限流、超时、网络或 Meta 服务异常都不能证明 token 已失效。
    // 保留原状态，避免一次瞬时故障污染授权池。
    logger.warn(
      `[Token Validation] Transient validation failure: code=${errorCode ?? 'unknown'}, status=${error.response?.status ?? 'unknown'}, message=${errorMessage}`,
    )
    return {
      isValid: false,
      error: errorMessage,
      errorCode,
      failureKind: 'transient',
    }
  }
}

/**
 * 检查并更新 token 状态
 * @param tokenDoc FbToken 文档
 * @returns 更新后的状态
 */
export async function checkAndUpdateTokenStatus(
  tokenDoc: IFbToken,
): Promise<'active' | 'expired' | 'invalid'> {
  const result = await checkAndUpdateTokenStatusDetailed(tokenDoc)
  return result.status
}

export async function checkAndUpdateTokenStatusDetailed(
  tokenDoc: IFbToken,
): Promise<TokenStatusCheckResult> {
  const startTime = Date.now()
  logger.info(`[Token Validation] Checking token for user: ${tokenDoc.userId}`)

  try {
    const validation = await validateToken(tokenDoc.token)

    let newStatus: 'active' | 'expired' | 'invalid' = tokenDoc.status || 'active'
    let outcome: TokenStatusCheckResult['outcome'] = 'transient'
    const checkedAt = new Date()
    const updateData: any = {
      lastValidationAttemptAt: checkedAt,
    }

    if (validation.isValid) {
      outcome = 'valid'
      newStatus = 'active'
      updateData.lastCheckedAt = checkedAt
      if (validation.fbUser) {
        updateData.fbUserId = validation.fbUser.id
        updateData.fbUserName = validation.fbUser.name
      }
      if (validation.expiresAt) {
        updateData.expiresAt = validation.expiresAt
        // 如果过期时间已过，标记为 expired
        if (validation.expiresAt < new Date()) {
          newStatus = 'expired'
        }
      }
      logger.info(
        `[Token Validation] Token is valid for user: ${tokenDoc.userId}`,
      )
      updateData.status = newStatus
      updateData.$unset = {
        lastValidationError: 1,
        lastValidationErrorCode: 1,
      }
    } else if (validation.failureKind === 'invalid') {
      outcome = 'invalid'
      newStatus = 'invalid'
      updateData.status = newStatus
      updateData.lastCheckedAt = checkedAt
      updateData.lastValidationError = validation.error
      if (validation.errorCode !== undefined) {
        updateData.lastValidationErrorCode = validation.errorCode
      }
      logger.warn(
        `[Token Validation] Token is invalid for user: ${tokenDoc.userId}, error: ${validation.error}`,
      )
    } else {
      updateData.lastValidationError = validation.error || 'Transient validation failure'
      if (validation.errorCode !== undefined) {
        updateData.lastValidationErrorCode = validation.errorCode
      } else {
        updateData.$unset = { lastValidationErrorCode: 1 }
      }
      logger.warn(
        `[Token Validation] Preserving ${newStatus} status after transient validation failure for user: ${tokenDoc.userId}, code=${validation.errorCode ?? 'unknown'}, error=${validation.error}`,
      )
    }

    // 更新数据库
    await FbToken.findByIdAndUpdate(tokenDoc._id, updateData)

    logger.timerLog(
      `[Token Validation] Check completed for user: ${tokenDoc.userId}`,
      startTime,
    )

    return { status: newStatus, outcome }
  } catch (error: any) {
    logger.error(
      `[Token Validation] Failed to check token for user: ${tokenDoc.userId}`,
      error,
    )
    // 本地异常同样不能证明 Meta token 已失效，只记录尝试并保留原状态。
    try {
      await FbToken.findByIdAndUpdate(tokenDoc._id, {
        lastValidationAttemptAt: new Date(),
        lastValidationError: error.message || 'Unexpected validation failure',
        $unset: { lastValidationErrorCode: 1 },
      })
    } catch (updateError) {
      logger.error(
        `[Token Validation] Failed to record validation attempt for user: ${tokenDoc.userId}`,
        updateError,
      )
    }
    return {
      status: tokenDoc.status || 'active',
      outcome: 'transient',
    }
  }
}

/**
 * 检查所有 token 的状态
 */
export async function checkAllTokensStatus(options: {
  limit?: number
  concurrency?: number
} = {}): Promise<TokenValidationBatchSummary> {
  logger.info('[Token Validation] Starting batch token validation')

  const limit = parseBoundedPositiveInt(
    options.limit ?? process.env.FB_TOKEN_VALIDATION_BATCH_LIMIT,
    TOKEN_VALIDATION_BATCH_LIMIT,
    TOKEN_VALIDATION_MAX_BATCH_LIMIT,
  )
  const concurrency = parseBoundedPositiveInt(
    options.concurrency ?? process.env.FB_TOKEN_VALIDATION_CONCURRENCY,
    TOKEN_VALIDATION_CONCURRENCY,
    TOKEN_VALIDATION_MAX_CONCURRENCY,
  )

  try {
    const [totalFound, tokens] = await Promise.all([
      FbToken.countDocuments({}),
      FbToken.find({})
        .sort({ lastValidationAttemptAt: 1, lastCheckedAt: 1, updatedAt: 1, _id: 1 })
        .limit(limit),
    ])
    logger.info(`[Token Validation] Checking ${tokens.length}/${totalFound} tokens with concurrency=${concurrency}`)

    const results = await runWithConcurrency(
      tokens,
      concurrency,
      (token) => checkAndUpdateTokenStatusDetailed(token),
    )

    const fulfilledResults = results
      .filter((result): result is { status: 'fulfilled'; value: TokenStatusCheckResult } => (
        result.status === 'fulfilled'
      ))
      .map((result) => result.value)
    const validCount = fulfilledResults.filter((result) => result.outcome === 'valid').length
    const invalidCount = fulfilledResults.filter((result) => result.outcome === 'invalid').length
    const transientCount = fulfilledResults.filter((result) => result.outcome === 'transient').length
    const rejectedCount = results.filter((result) => result.status === 'rejected').length
    const successCount = validCount + invalidCount
    const failedCount = transientCount + rejectedCount

    logger.info(
      `[Token Validation] Batch validation completed: checked=${tokens.length}, total=${totalFound}, ${successCount} succeeded, ${failedCount} failed`,
    )

    return {
      totalFound,
      checked: tokens.length,
      succeeded: successCount,
      failed: failedCount,
      valid: validCount,
      invalid: invalidCount,
      transient: transientCount + rejectedCount,
      limit,
      concurrency,
    }
  } catch (error: any) {
    logger.error('[Token Validation] Batch validation failed:', error)
    return {
      totalFound: 0,
      checked: 0,
      succeeded: 0,
      failed: 1,
      valid: 0,
      invalid: 0,
      transient: 1,
      limit,
      concurrency,
    }
  }
}
