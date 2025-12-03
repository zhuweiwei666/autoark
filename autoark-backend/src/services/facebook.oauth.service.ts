import logger from '../utils/logger'
import FbToken from '../models/FbToken'
import { tokenPool } from './facebook.token.pool'
import { fbClient } from './facebook.api'
import * as facebookPermissionsService from './facebook.permissions.service'
import * as oauthApi from '../integration/facebook/oauth.api'

/**
 * Facebook OAuth 服务
 * 处理 Facebook 登录、授权码交换、Token 存储
 */

/**
 * 生成 Facebook 登录 URL
 */
export const getFacebookLoginUrl = (state?: string): string => {
  return oauthApi.getFacebookLoginUrl(state)
}

/**
 * 验证 OAuth 配置
 */
export const validateOAuthConfig = (): { valid: boolean; missing: string[] } => {
  return oauthApi.validateOAuthConfig()
}

/**
 * 处理 OAuth 回调：获取 code → 交换 token → 存储 → 检查权限
 */
export const handleOAuthCallback = async (code: string): Promise<{
  tokenId: string
  fbUserId: string
  fbUserName: string
  userDetails?: any
  permissions?: any
}> => {
  try {
    logger.info('[OAuth] Handling OAuth callback')

    // 1. 将 code 交换为 Short-Lived Token
    const shortLivedTokenData = await oauthApi.exchangeCodeForToken(code)
    const shortLivedToken = shortLivedTokenData.access_token

    // 2. 获取用户信息
    const userInfo = await oauthApi.getUserInfo(shortLivedToken)

    // 3. 将 Short-Lived Token 交换为 Long-Lived Token
    const longLivedTokenData = await oauthApi.exchangeForLongLivedToken(shortLivedToken)
    const longLivedToken = longLivedTokenData.access_token

    // 计算过期时间
    const expiresIn = longLivedTokenData.expires_in || 5184000 // 默认 60 天
    const expiresAt = new Date(Date.now() + expiresIn * 1000)

    // 4. 存储或更新 Token
    const tokenDoc = await FbToken.findOneAndUpdate(
      { fbUserId: userInfo.id },
      {
        token: longLivedToken,
        fbUserId: userInfo.id,
        fbUserName: userInfo.name,
        status: 'active',
        expiresAt,
        lastCheckedAt: new Date(),
      },
      {
        upsert: true,
        new: true,
      }
    )

    logger.info(`[OAuth] Token saved/updated for user ${userInfo.id} (${userInfo.name})`)

    // 5. 重新初始化 Token Pool（包含新 token）
    await tokenPool.initialize()

    // 6. 获取用户详细信息（包括邮箱等）
    let userDetails: any = {
      id: userInfo.id,
      name: userInfo.name,
      email: userInfo.email,
    }

    try {
      // 尝试获取更多用户信息
      const userData = await fbClient.get('/me', {
        access_token: longLivedToken,
        fields: 'id,name,email,picture',
      })
      userDetails = {
        ...userDetails,
        ...userData,
      }
    } catch (error: any) {
      logger.warn(`[OAuth] Failed to get additional user info:`, error)
      // 获取额外信息失败不影响主要流程
    }

    // 7. 检查权限（可选，不阻塞）
    let permissions = null
    try {
      const diagnosis = await facebookPermissionsService.diagnoseToken(tokenDoc._id.toString())
      permissions = diagnosis
    } catch (error: any) {
      logger.warn(`[OAuth] Failed to diagnose permissions for token ${tokenDoc._id}:`, error)
      // 权限检查失败不影响 token 存储
    }

    return {
      tokenId: tokenDoc._id.toString(),
      fbUserId: userInfo.id,
      fbUserName: userInfo.name,
      userDetails,
      permissions,
    }
  } catch (error: any) {
    logger.error('[OAuth] Failed to handle OAuth callback:', error)
    throw error
  }
}
