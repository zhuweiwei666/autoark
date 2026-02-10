import axios from 'axios'

const BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3'

export async function exchangeTiktokCode(appId: string, appSecret: string, code: string) {
  const res = await axios.post(`${BASE_URL}/oauth2/access_token/`, {
    app_id: appId, secret: appSecret, auth_code: code,
  })
  return res.data.data // { access_token, advertiser_ids, ... }
}

export async function refreshTiktokToken(appId: string, appSecret: string, refreshToken: string) {
  const res = await axios.post(`${BASE_URL}/oauth2/refresh_token/`, {
    app_id: appId, secret: appSecret, refresh_token: refreshToken,
  })
  return res.data.data
}
