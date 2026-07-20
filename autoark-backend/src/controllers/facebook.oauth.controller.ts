import { Request, Response, NextFunction } from 'express'
import * as oauthService from '../services/facebook.oauth.service'
import logger from '../utils/logger'
import { pickSafeQueryString } from '../utils/pagination'
import { UserRole } from '../models/User'

const OAUTH_STATE_MAX_LENGTH = 4096
const OAUTH_CODE_MAX_LENGTH = 4096
const OAUTH_APP_ID_MAX_LENGTH = 80
const OAUTH_ERROR_MAX_LENGTH = 500

const redirectWithOauthError = (res: Response, redirectBase: string, message: string) => {
  const params = new URLSearchParams({
    oauth_error: message.slice(0, OAUTH_ERROR_MAX_LENGTH),
  })
  return res.redirect(`${redirectBase}?${params.toString()}`)
}

const isBulkAdState = (state: unknown): boolean => {
  if (typeof state !== 'string') return false
  if (state.startsWith('bulk-ad|')) return true

  try {
    const decoded = Buffer.from(state, 'base64').toString('utf-8')
    const parsed = JSON.parse(decoded)
    return typeof parsed?.originalState === 'string' && parsed.originalState.startsWith('bulk-ad|')
  } catch {
    return false
  }
}

/**
 * 获取 Facebook 登录 URL
 */
export const getLoginUrl = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // 验证配置（异步版本，支持从数据库读取 App 配置）
    const config = await oauthService.validateOAuthConfig()
    if (!config.valid) {
      return res.status(500).json({
        success: false,
        message: config.hasDbApps 
          ? `OAuth 配置不完整，缺少: ${config.missing.join(', ')}`
          : `未配置 Facebook App，请在 App 管理页面添加 App，或设置环境变量: ${config.missing.join(', ')}`,
        missing: config.missing,
        hasDbApps: config.hasDbApps,
      })
    }

    const state = pickSafeQueryString(req.query.state, OAUTH_STATE_MAX_LENGTH)
    const appId = pickSafeQueryString(req.query.appId, OAUTH_APP_ID_MAX_LENGTH)
    const adminTest = pickSafeQueryString(req.query.adminTest, 10) === 'true'
    const businessLogin = pickSafeQueryString(req.query.businessLogin, 10) === 'true'

    if (adminTest && req.user?.role !== UserRole.SUPER_ADMIN) {
      return res.status(403).json({
        success: false,
        message: '仅超级管理员可绕过公开 OAuth 准入进行 App 验证',
      })
    }

    if (adminTest && !appId) {
      return res.status(400).json({
        success: false,
        message: '管理员 OAuth 验证必须指定 appId',
      })
    }

    const loginUrl = adminTest
      ? await oauthService.getFacebookLoginUrl(state, appId, {
          businessLogin,
          requirePublicOauthReady: false,
        })
      : await oauthService.getFacebookLoginUrl(state, appId)

    res.json({
      success: true,
      data: {
        loginUrl,
      },
    })
  } catch (error: any) {
    next(error)
  }
}

/**
 * OAuth 回调处理
 */
export const handleCallback = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = pickSafeQueryString(req.query.code, OAUTH_CODE_MAX_LENGTH)
    const error = pickSafeQueryString(req.query.error, OAUTH_ERROR_MAX_LENGTH)
    const errorReason = pickSafeQueryString(req.query.error_reason, OAUTH_ERROR_MAX_LENGTH)
    const errorDescription = pickSafeQueryString(req.query.error_description, OAUTH_ERROR_MAX_LENGTH)
    const state = pickSafeQueryString(req.query.state, OAUTH_STATE_MAX_LENGTH)
    
    // 根据 state 参数决定重定向目标
    // bulk-ad 来源使用专门的弹窗回调页面
    const isBulkAd = isBulkAdState(state)
    const redirectBase = isBulkAd ? '/oauth/callback' : '/fb-token'

    // 检查是否有错误
    if (error) {
      logger.error('[OAuth] Facebook returned error:', { error, error_reason: errorReason, error_description: errorDescription })
      return redirectWithOauthError(res, redirectBase, errorDescription || error)
    }

    if (!code) {
      return redirectWithOauthError(res, redirectBase, 'No authorization code received')
    }

    // 处理 OAuth 回调
    const result = await oauthService.handleOAuthCallback(code, state)

    // 重定向到目标页面，显示成功消息和用户信息
    const params = new URLSearchParams({
      oauth_success: 'true',
      token_id: result.tokenId,
      fb_user_id: result.fbUserId,
      fb_user_name: result.fbUserName || '',
    })

    // 如果有用户详细信息，也传递过去
    if (result.userDetails) {
      if (result.userDetails.email) {
        params.append('fb_user_email', result.userDetails.email)
      }
    }

    res.redirect(`${redirectBase}?${params.toString()}`)
  } catch (error: any) {
    logger.error('[OAuth] Callback handler failed:', error)
    const state = pickSafeQueryString(req.query.state, OAUTH_STATE_MAX_LENGTH)
    const isBulkAd = isBulkAdState(state)
    const redirectBase = isBulkAd ? '/oauth/callback' : '/fb-token'
    redirectWithOauthError(res, redirectBase, pickSafeQueryString(error.message, OAUTH_ERROR_MAX_LENGTH) || 'OAuth callback failed')
  }
}

/**
 * 验证 OAuth 配置状态
 */
export const getOAuthConfig = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await oauthService.validateOAuthConfig()
    const businessLoginConfig = await oauthService.getBusinessLoginConfigStatus()

    res.json({
      success: true,
      data: {
        configured: config.valid,
        missing: config.missing,
        hasDbApps: config.hasDbApps,
        redirectUri: process.env.FACEBOOK_REDIRECT_URI || '',
        businessLoginConfigIdConfigured: businessLoginConfig.configured,
        businessLoginConfigIdSource: businessLoginConfig.source,
        businessLoginEnvConfigured: businessLoginConfig.envConfigured,
        activeDbBusinessLoginConfigAppCount: businessLoginConfig.activeDbConfiguredAppCount,
        oauthStateSecretConfigured: Boolean(process.env.OAUTH_STATE_SECRET),
      },
    })
  } catch (error: any) {
    next(error)
  }
}
