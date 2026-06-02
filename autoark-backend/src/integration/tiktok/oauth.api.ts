import axios from 'axios'
import logger from '../../utils/logger'

const TIKTOK_AUTH_BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3'

const summarizeTiktokOAuthError = (error: any) => ({
  status: error.response?.status,
  code: error.response?.data?.code,
  message: error.response?.data?.message || error.message,
  requestId: error.response?.data?.request_id,
})

/**
 * TikTok OAuth API
 */
export const exchangeTiktokCodeForToken = async (
  appId: string,
  secret: string,
  authCode: string
) => {
  try {
    const response = await axios.post(`${TIKTOK_AUTH_BASE_URL}/oauth2/access_token/`, {
      app_id: appId,
      secret,
      auth_code: authCode,
    })

    if (response.data.code !== 0) {
      throw new Error(`TikTok OAuth Error: ${response.data.message} (code: ${response.data.code})`)
    }

    return response.data.data
  } catch (error: any) {
    logger.error('[TikTokOAuth] exchange token failed:', JSON.stringify(summarizeTiktokOAuthError(error)))
    throw error
  }
}

export const refreshTiktokToken = async (
  appId: string,
  secret: string,
  refreshToken: string
) => {
  try {
    const response = await axios.post(`${TIKTOK_AUTH_BASE_URL}/oauth2/refresh_token/`, {
      app_id: appId,
      secret,
      refresh_token: refreshToken,
    })

    if (response.data.code !== 0) {
      throw new Error(`TikTok OAuth Error: ${response.data.message} (code: ${response.data.code})`)
    }

    return response.data.data
  } catch (error: any) {
    logger.error('[TikTokOAuth] refresh token failed:', JSON.stringify(summarizeTiktokOAuthError(error)))
    throw error
  }
}
