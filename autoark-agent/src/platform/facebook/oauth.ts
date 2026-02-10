/**
 * Facebook OAuth - 登录 URL 生成、Token 交换
 */
import axios from 'axios'
import { FB_OAUTH_URL, FB_API_VERSION, FB_BASE_URL } from './config'
import { env } from '../../config/env'
import { log } from '../logger'

export function getLoginUrl() {
  const scopes = ['ads_management', 'ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement']
  const params = new URLSearchParams({
    client_id: env.FACEBOOK_APP_ID,
    redirect_uri: env.FACEBOOK_REDIRECT_URI,
    scope: scopes.join(','),
    response_type: 'code',
    auth_type: 'rerequest',
  })
  return `${FB_OAUTH_URL}/authorize?${params.toString()}`
}

export async function exchangeCodeForToken(code: string): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await axios.get(`${FB_OAUTH_URL}/access_token`, {
    params: {
      client_id: env.FACEBOOK_APP_ID,
      client_secret: env.FACEBOOK_APP_SECRET,
      redirect_uri: env.FACEBOOK_REDIRECT_URI,
      code,
    },
  })
  return { accessToken: res.data.access_token, expiresIn: res.data.expires_in }
}

export async function exchangeForLongLivedToken(shortToken: string): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await axios.get(`${FB_OAUTH_URL}/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: env.FACEBOOK_APP_ID,
      client_secret: env.FACEBOOK_APP_SECRET,
      fb_exchange_token: shortToken,
    },
  })
  return { accessToken: res.data.access_token, expiresIn: res.data.expires_in }
}

export async function getUserInfo(token: string): Promise<{ id: string; name: string; email?: string }> {
  const res = await axios.get(`${FB_BASE_URL}/${FB_API_VERSION}/me`, {
    params: { access_token: token, fields: 'id,name,email' },
  })
  return res.data
}
