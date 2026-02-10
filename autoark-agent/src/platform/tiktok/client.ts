import axios from 'axios'
import { log } from '../logger'

const BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3'

export const ttClient = {
  async get(endpoint: string, params: any, accessToken: string) {
    const res = await axios.get(`${BASE_URL}${endpoint}`, {
      params, headers: { 'Access-Token': accessToken },
    })
    if (res.data.code !== 0) throw new Error(`TikTok API error: ${res.data.message}`)
    return res.data.data
  },
  async post(endpoint: string, data: any, accessToken: string) {
    const res = await axios.post(`${BASE_URL}${endpoint}`, data, {
      headers: { 'Access-Token': accessToken, 'Content-Type': 'application/json' },
    })
    if (res.data.code !== 0) throw new Error(`TikTok API error: ${res.data.message}`)
    return res.data.data
  },
}
