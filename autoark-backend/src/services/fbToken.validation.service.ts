import axios from 'axios'
import FbToken, { IFbToken } from '../models/FbToken'
import logger from '../utils/logger'

const FB_API_VERSION = 'v19.0'
const FB_BASE_URL = 'https://graph.facebook.com'

/**
 * 验证单个 token 是否有效
 * @param token Facebook access token
 * @returns { isValid: boolean, fbUser?: any, expiresAt?: Date }
 */
export async function validateToken(
  token: string,
): Promise<{
  isValid: boolean
  fbUser?: any
  expiresAt?: Date
  error?: string
}> {
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
      return { isValid: false, error: 'Invalid token response' }
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
    } catch (debugErr) {
      // debug_token 可能失败，但不影响基本验证
      logger.warn('Failed to get token debug info:', debugErr)
    }

    return {
      isValid: true,
      fbUser: userResponse.data,
      expiresAt,
    }
  } catch (error: any) {
    const errorMessage =
      error.response?.data?.error?.message || error.message || 'Unknown error'
    const errorCode = error.response?.data?.error?.code

    // Facebook API 错误码：
    // 190: Invalid OAuth 2.0 Access Token
    // 102: Session key invalid or no longer valid
    if (errorCode === 190 || errorCode === 102) {
      return { isValid: false, error: errorMessage }
    }

    // 网络错误或其他错误
    logger.error('Token validation error:', error)
    return { isValid: false, error: errorMessage }
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
  const startTime = Date.now()
  logger.info(`[Token Validation] Checking token for user: ${tokenDoc.userId}`)

  try {
    const validation = await validateToken(tokenDoc.token)

    let newStatus: 'active' | 'expired' | 'invalid' = 'active'
    const updateData: any = {
      lastCheckedAt: new Date(),
    }

    if (validation.isValid) {
      newStatus = 'active'
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
    } else {
      newStatus = 'invalid'
      logger.warn(
        `[Token Validation] Token is invalid for user: ${tokenDoc.userId}, error: ${validation.error}`,
      )
    }

    updateData.status = newStatus

    // 更新数据库
    await FbToken.findByIdAndUpdate(tokenDoc._id, updateData)

    logger.timerLog(
      `[Token Validation] Check completed for user: ${tokenDoc.userId}`,
      startTime,
    )

    return newStatus
  } catch (error: any) {
    logger.error(
      `[Token Validation] Failed to check token for user: ${tokenDoc.userId}`,
      error,
    )
    // 标记为 invalid
    await FbToken.findByIdAndUpdate(tokenDoc._id, {
      status: 'invalid',
      lastCheckedAt: new Date(),
    })
    return 'invalid'
  }
}

/**
 * 检查所有 token 的状态
 */
export async function checkAllTokensStatus(): Promise<void> {
  logger.info('[Token Validation] Starting batch token validation')

  try {
    const tokens = await FbToken.find({})
    logger.info(`[Token Validation] Found ${tokens.length} tokens to check`)

    const results = await Promise.allSettled(
      tokens.map((token) => checkAndUpdateTokenStatus(token)),
    )

    const successCount = results.filter((r) => r.status === 'fulfilled').length
    const failedCount = results.filter((r) => r.status === 'rejected').length

    logger.info(
      `[Token Validation] Batch validation completed: ${successCount} succeeded, ${failedCount} failed`,
    )
  } catch (error: any) {
    logger.error('[Token Validation] Batch validation failed:', error)
  }
}

