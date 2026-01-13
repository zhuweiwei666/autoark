import axios from 'axios'
import logger from '../../utils/logger'
import FacebookApp from '../../models/FacebookApp'
import { FB_API_VERSION, FB_BASE_URL } from '../../config/facebook.config'

const FB_GRAPH_BASE_URL = FB_BASE_URL
const FB_OAUTH_BASE_URL = 'https://www.facebook.com'

// 从环境变量读取作为后备
const ENV_FB_APP_ID = process.env.FACEBOOK_APP_ID || ''
const ENV_FB_APP_SECRET = process.env.FACEBOOK_APP_SECRET || ''
const FB_REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI || 'http://localhost:3001/api/facebook/oauth/callback'

/**
 * 获取可用的 App 配置（优先从数据库，后备环境变量）
 */
export const getActiveAppConfig = async (appId?: string): Promise<{
  appId: string
  appSecret: string
  source: 'database' | 'env'
}> => {
  try {
    // 如果指定了 appId，直接查找
    if (appId) {
      const app = await FacebookApp.findOne({ appId, status: 'active' })
      if (app) {
        return {
          appId: app.appId,
          appSecret: app.appSecret,
          source: 'database',
        }
      }
    }

    // 1. 优先查找默认 App（且满足公开 OAuth 准入）
    let app = await FacebookApp.findOne({
      status: 'active',
      isDefault: true,
      'validation.isValid': true,
      'compliance.publicOauthReady': true,
    })
    
    // 2. 如果没有默认 App，查找负载最低的活跃 App（且满足公开 OAuth 准入）
    if (!app) {
      app = await FacebookApp.findOne({
        status: 'active',
        'validation.isValid': true,
        'compliance.publicOauthReady': true,
      }).sort({
        'currentLoad.activeTasks': 1,
        'config.priority': -1,
      })
    }

    // 3. 如果系统中暂时没有任何 publicOauthReady 的 App，降级为“任意可用 App”
    if (!app) {
      app = await FacebookApp.findOne({
        status: 'active',
        'validation.isValid': true,
      }).sort({
        'currentLoad.activeTasks': 1,
        'config.priority': -1,
      })
    }

    if (app) {
      return {
        appId: app.appId,
        appSecret: app.appSecret,
        source: 'database',
      }
    }

    // 后备：使用环境变量
    if (ENV_FB_APP_ID && ENV_FB_APP_SECRET) {
      logger.warn('[OAuth] Using fallback env variables for app credentials')
      return {
        appId: ENV_FB_APP_ID,
        appSecret: ENV_FB_APP_SECRET,
        source: 'env',
      }
    }

    throw new Error('No active Facebook App found. Please configure an App in the App Management page.')
  } catch (error: any) {
    logger.error('[OAuth] Failed to get app config:', error.message)
    throw error
  }
}

/**
 * 获取所有可用的 Apps（供前端选择）
 */
export const getAvailableApps = async (): Promise<Array<{
  appId: string
  appName: string
  healthScore: number
  isAvailable: boolean
}>> => {
  const apps: any[] = await FacebookApp.find({ status: 'active' }).lean()
  
  return apps.map(app => ({
    appId: String(app.appId),
    appName: String(app.appName),
    healthScore: app.stats?.totalRequests 
      ? Math.round((Number(app.stats.successRequests || 0) / Number(app.stats.totalRequests)) * 100)
      : 100,
    isAvailable: app.status === 'active' && 
      (!app.currentLoad?.activeTasks || Number(app.currentLoad.activeTasks) < Number(app.config?.maxConcurrentTasks || 5)),
  }))
}

/**
 * 生成 Facebook 登录 URL
 * @param state - 状态参数
 * @param appId - 可选，指定使用哪个 App
 */
export const getFacebookLoginUrl = async (state?: string, appId?: string): Promise<string> => {
  const config = await getActiveAppConfig(appId)
  
  const scopes = [
    'ads_management',
    'ads_read',
    'business_management',
    'pages_show_list',
    'pages_read_engagement',
  ].join(',')

  // 在 state 中编码 appId，以便回调时知道用哪个 app
  const stateData = {
    originalState: state || '',
    appId: config.appId,
  }

  const params = new URLSearchParams({
    client_id: config.appId,
    redirect_uri: FB_REDIRECT_URI,
    scope: scopes,
    response_type: 'code',
    state: Buffer.from(JSON.stringify(stateData)).toString('base64'),
    auth_type: 'rerequest',
  })

  return `${FB_OAUTH_BASE_URL}/${FB_API_VERSION}/dialog/oauth?${params.toString()}`
}

/**
 * 同步版本（用于兼容现有代码）
 */
export const getFacebookLoginUrlSync = (state?: string): string => {
  if (!ENV_FB_APP_ID) {
    throw new Error('FACEBOOK_APP_ID not configured. Please add an App in App Management.')
  }
  
  const scopes = [
    'ads_management',
    'ads_read',
    'business_management',
    'pages_show_list',
    'pages_read_engagement',
  ].join(',')

  const params = new URLSearchParams({
    client_id: ENV_FB_APP_ID,
    redirect_uri: FB_REDIRECT_URI,
    scope: scopes,
    response_type: 'code',
    state: state || '',
    auth_type: 'rerequest',
  })

  return `${FB_OAUTH_BASE_URL}/${FB_API_VERSION}/dialog/oauth?${params.toString()}`
}

/**
 * 解析 state 参数
 */
export const parseStateParam = (state: string): {
  originalState: string
  appId?: string
} => {
  try {
    const decoded = Buffer.from(state, 'base64').toString('utf-8')
    return JSON.parse(decoded)
  } catch {
    // 旧格式，直接返回
    return { originalState: state }
  }
}

/**
 * 将授权码（code）交换为 Access Token
 * @param code - 授权码
 * @param appId - 可选，指定使用哪个 App（通常从 state 中解析）
 */
export const exchangeCodeForToken = async (code: string, appId?: string): Promise<{
  access_token: string
  token_type: string
  expires_in?: number
}> => {
  try {
    const config = await getActiveAppConfig(appId)
    logger.info(`[OAuth] Exchanging code for access token using App ${config.appId} (${config.source})`)

    const response = await axios.get(`${FB_GRAPH_BASE_URL}/${FB_API_VERSION}/oauth/access_token`, {
      params: {
        client_id: config.appId,
        client_secret: config.appSecret,
        redirect_uri: FB_REDIRECT_URI,
        code,
      },
    })

    if (!response.data.access_token) {
      throw new Error('Failed to get access token from Facebook')
    }

    // 记录请求成功
    if (config.source === 'database') {
      await FacebookApp.updateOne(
        { appId: config.appId },
        { 
          $inc: { 'stats.totalRequests': 1, 'stats.successRequests': 1 },
          $set: { 'stats.lastUsedAt': new Date() }
        }
      )
    }

    logger.info('[OAuth] Successfully exchanged code for access token')
    return response.data
  } catch (error: any) {
    logger.error('[OAuth] Failed to exchange code for token:', error.response?.data || error.message)
    
    // 记录请求失败
    if (appId) {
      await FacebookApp.updateOne(
        { appId },
        { 
          $inc: { 'stats.totalRequests': 1, 'stats.failedRequests': 1 },
          $set: { 
            'stats.lastErrorAt': new Date(),
            'stats.lastError': error.response?.data?.error?.message || error.message
          }
        }
      )
    }
    
    throw new Error(`Failed to exchange code: ${error.response?.data?.error?.message || error.message}`)
  }
}

/**
 * 将 Short-Lived Token 交换为 Long-Lived Token
 */
export const exchangeForLongLivedToken = async (shortLivedToken: string, appId?: string): Promise<{
  access_token: string
  token_type: string
  expires_in: number
}> => {
  try {
    const config = await getActiveAppConfig(appId)
    logger.info(`[OAuth] Exchanging short-lived token for long-lived token using App ${config.appId}`)

    const response = await axios.get(`${FB_GRAPH_BASE_URL}/${FB_API_VERSION}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: config.appId,
        client_secret: config.appSecret,
        fb_exchange_token: shortLivedToken,
      },
    })

    if (!response.data.access_token) {
      throw new Error('Failed to get long-lived token from Facebook')
    }

    // 记录请求成功
    if (config.source === 'database') {
      await FacebookApp.updateOne(
        { appId: config.appId },
        { 
          $inc: { 'stats.totalRequests': 1, 'stats.successRequests': 1 },
          $set: { 'stats.lastUsedAt': new Date() }
        }
      )
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
 * 验证 OAuth 配置（检查是否有可用的 App）
 */
export const validateOAuthConfig = async (): Promise<{ valid: boolean; missing: string[]; hasDbApps: boolean }> => {
  const missing: string[] = []
  
  // 检查数据库中是否有活跃的 App
  const dbAppsCount = await FacebookApp.countDocuments({ status: 'active' })
  const hasDbApps = dbAppsCount > 0

  // 如果没有数据库 App，检查环境变量
  if (!hasDbApps) {
    if (!ENV_FB_APP_ID) {
      missing.push('FACEBOOK_APP_ID')
    }
    if (!ENV_FB_APP_SECRET) {
      missing.push('FACEBOOK_APP_SECRET')
    }
  }

  if (!FB_REDIRECT_URI) {
    missing.push('FACEBOOK_REDIRECT_URI')
  }

  return {
    valid: (hasDbApps || (ENV_FB_APP_ID && ENV_FB_APP_SECRET)) && FB_REDIRECT_URI !== '',
    missing,
    hasDbApps,
  }
}

/**
 * 同步版本的配置验证（兼容现有代码）
 */
export const validateOAuthConfigSync = (): { valid: boolean; missing: string[] } => {
  const missing: string[] = []

  if (!ENV_FB_APP_ID) {
    missing.push('FACEBOOK_APP_ID')
  }
  if (!ENV_FB_APP_SECRET) {
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
