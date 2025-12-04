import axios from 'axios'
import logger from '../../utils/logger'

const FB_API_VERSION = 'v19.0'
const FB_GRAPH_BASE_URL = 'https://graph.facebook.com'
const FB_OAUTH_BASE_URL = 'https://www.facebook.com'

const FB_APP_ID = process.env.FACEBOOK_APP_ID || ''
const FB_APP_SECRET = process.env.FACEBOOK_APP_SECRET || ''
const FB_REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI || 'http://localhost:3001/api/facebook/oauth/callback'

/**
 * 生成 Facebook 登录 URL
 * 权限列表参考 TopTou 的实现
 */
export const getFacebookLoginUrl = (state?: string): string => {
  const scopes = [
    'public_profile',
    'ads_management',
    'ads_read',
    'read_insights',
    'pages_show_list',
    'pages_read_engagement',
    'business_management',
    'pages_manage_metadata',
    'catalog_management',
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

