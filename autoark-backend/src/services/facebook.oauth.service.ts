import axios from 'axios'
import logger from '../utils/logger'
import FbToken from '../models/FbToken'
import { tokenPool } from './facebook.token.pool'
import * as facebookPermissionsService from './facebook.permissions.service'

/**
 * Facebook OAuth 服务
 * 处理 Facebook 登录、授权码交换、Token 存储
 */

const FB_APP_ID = process.env.FACEBOOK_APP_ID || ''
const FB_APP_SECRET = process.env.FACEBOOK_APP_SECRET || ''
const FB_REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI || 'http://localhost:3001/api/facebook/oauth/callback'
const FB_API_VERSION = 'v19.0'
const FB_OAUTH_BASE_URL = 'https://www.facebook.com'
const FB_GRAPH_BASE_URL = 'https://graph.facebook.com'

/**
 * 生成 Facebook 登录 URL
 */
export const getFacebookLoginUrl = (state?: string): string => {
  const scopes = [
    'ads_read',
    'ads_management',
    'business_management',
    'pages_read_engagement',
    'pages_manage_metadata',
    'pixel_read',
    'pixel_write',
    'offline_access', // 重要：获取长期 token
  ].join(',')

  const params = new URLSearchParams({
    client_id: FB_APP_ID,
    redirect_uri: FB_REDIRECT_URI,
    scope: scopes,
    response_type: 'code',
    state: state || '',
    auth_type: 'rerequest', // 重新请求权限（如果之前拒绝过）
  })

  return `${FB_OAUTH_BASE_URL}/${FB_API_VERSION}/dialog/oauth?${params.toString()}`
}

/**
 * 将授权码（code）交换为 Access Token
 */
export const exchangeCodeForToken = async (code: string): Promise<{
  access_token: string
  token_type: string
  expires_in?: number
}> => {
  try {
    logger.info('[OAuth] Exchanging code for access token')

    const response = await axios.get(`${FB_GRAPH_BASE_URL}/${FB_API_VERSION}/oauth/access_token`, {
      params: {
        client_id: FB_APP_ID,
        client_secret: FB_APP_SECRET,
        redirect_uri: FB_REDIRECT_URI,
        code,
      },
    })

    if (!response.data.access_token) {
      throw new Error('Failed to get access token from Facebook')
    }

    logger.info('[OAuth] Successfully exchanged code for access token')
    return response.data
  } catch (error: any) {
    logger.error('[OAuth] Failed to exchange code for token:', error.response?.data || error.message)
    throw new Error(`Failed to exchange code: ${error.response?.data?.error?.message || error.message}`)
  }
}

/**
 * 将 Short-Lived Token 交换为 Long-Lived Token
 */
export const exchangeForLongLivedToken = async (shortLivedToken: string): Promise<{
  access_token: string
  token_type: string
  expires_in: number
}> => {
  try {
    logger.info('[OAuth] Exchanging short-lived token for long-lived token')

    const response = await axios.get(`${FB_GRAPH_BASE_URL}/${FB_API_VERSION}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: FB_APP_ID,
        client_secret: FB_APP_SECRET,
        fb_exchange_token: shortLivedToken,
      },
    })

    if (!response.data.access_token) {
      throw new Error('Failed to get long-lived token from Facebook')
    }

    logger.info(`[OAuth] Successfully exchanged for long-lived token, expires in ${response.data.expires_in} seconds`)
    return response.data
  } catch (error: any) {
    logger.error('[OAuth] Failed to exchange for long-lived token:', error.response?.data || error.message)
    throw new Error(
      `Failed to exchange for long-lived token: ${error.response?.data?.error?.message || error.message}`
    )
  }
}

/**
 * 获取用户信息
 */
export const getUserInfo = async (accessToken: string): Promise<{
  id: string
  name: string
  email?: string
}> => {
  try {
    const response = await axios.get(`${FB_GRAPH_BASE_URL}/${FB_API_VERSION}/me`, {
      params: {
        access_token: accessToken,
        fields: 'id,name,email',
      },
    })

    return {
      id: response.data.id,
      name: response.data.name || 'Unknown User',
      email: response.data.email,
    }
  } catch (error: any) {
    logger.error('[OAuth] Failed to get user info:', error.response?.data || error.message)
    throw new Error(`Failed to get user info: ${error.response?.data?.error?.message || error.message}`)
  }
}

/**
 * 处理 OAuth 回调：获取 code → 交换 token → 存储 → 检查权限
 */
export const handleOAuthCallback = async (code: string): Promise<{
  tokenId: string
  fbUserId: string
  fbUserName: string
  permissions: any
}> => {
  try {
    logger.info('[OAuth] Handling OAuth callback')

    // 1. 将 code 交换为 Short-Lived Token
    const shortLivedTokenData = await exchangeCodeForToken(code)
    const shortLivedToken = shortLivedTokenData.access_token

    // 2. 获取用户信息
    const userInfo = await getUserInfo(shortLivedToken)

    // 3. 将 Short-Lived Token 交换为 Long-Lived Token
    const longLivedTokenData = await exchangeForLongLivedToken(shortLivedToken)
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

    // 6. 检查权限
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
      permissions,
    }
  } catch (error: any) {
    logger.error('[OAuth] Failed to handle OAuth callback:', error)
    throw error
  }
}

/**
 * 验证 OAuth 配置
 */
export const validateOAuthConfig = (): { valid: boolean; missing: string[] } => {
  const missing: string[] = []

  if (!FB_APP_ID) {
    missing.push('FACEBOOK_APP_ID')
  }
  if (!FB_APP_SECRET) {
    missing.push('FACEBOOK_APP_SECRET')
  }
  if (!FB_REDIRECT_URI) {
    missing.push('FACEBOOK_REDIRECT_URI')
  }

  return {
    valid: missing.length === 0,
    missing,
  }
}

