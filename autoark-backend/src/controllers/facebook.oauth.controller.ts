import { Request, Response, NextFunction } from 'express'
import * as oauthService from '../services/facebook.oauth.service'
import logger from '../utils/logger'

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

    const { state, appId } = req.query
    const loginUrl = await oauthService.getFacebookLoginUrl(state as string | undefined, appId as string | undefined)

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
    const { code, error, error_reason, error_description, state } = req.query
    
    // 根据 state 参数决定重定向目标
    // bulk-ad 来源使用专门的弹窗回调页面
    const isBulkAd = state === 'bulk-ad'
    const redirectBase = isBulkAd ? '/oauth/callback' : '/fb-token'

    // 检查是否有错误
    if (error) {
      logger.error('[OAuth] Facebook returned error:', { error, error_reason, error_description })
      return res.redirect(
        `${redirectBase}?oauth_error=${encodeURIComponent(error_description as string || error as string)}`
      )
    }

    if (!code) {
      return res.redirect(`${redirectBase}?oauth_error=No authorization code received`)
    }

    // 处理 OAuth 回调
    const result = await oauthService.handleOAuthCallback(code as string)

    // 重定向到目标页面，显示成功消息和用户信息
    const params = new URLSearchParams({
      oauth_success: 'true',
      token_id: result.tokenId,
      fb_user_id: result.fbUserId,
      fb_user_name: encodeURIComponent(result.fbUserName || ''),
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
    const isBulkAd = req.query.state === 'bulk-ad'
    const redirectBase = isBulkAd ? '/oauth/callback' : '/fb-token'
    res.redirect(`${redirectBase}?oauth_error=${encodeURIComponent(error.message || 'OAuth callback failed')}`)
  }
}

/**
 * 验证 OAuth 配置状态
 */
export const getOAuthConfig = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = oauthService.validateOAuthConfigSync()

    res.json({
      success: true,
      data: {
        configured: config.valid,
        missing: config.missing,
        redirectUri: process.env.FACEBOOK_REDIRECT_URI || '',
      },
    })
  } catch (error: any) {
    next(error)
  }
}

