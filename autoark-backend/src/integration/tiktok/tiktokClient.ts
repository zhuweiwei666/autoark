import axios from 'axios'
import logger from '../../utils/logger'

const TIKTOK_BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3'

export const tiktokClient = {
  async get(path: string, params: any = {}, accessToken?: string) {
    try {
      const response = await axios.get(`${TIKTOK_BASE_URL}${path}`, {
        params,
        headers: accessToken ? { 'Access-Token': accessToken } : {},
      })
      
      if (response.data.code !== 0) {
        throw new Error(`TikTok API Error: ${response.data.message} (code: ${response.data.code})`)
      }
      
      return response.data.data
    } catch (error: any) {
      logger.error(`[TikTokClient] GET ${path} failed:`, error.response?.data || error.message)
      throw error
    }
  },

  async post(path: string, data: any = {}, accessToken?: string) {
    try {
      const response = await axios.post(`${TIKTOK_BASE_URL}${path}`, data, {
        headers: accessToken ? { 'Access-Token': accessToken } : {},
      })
      
      if (response.data.code !== 0) {
        throw new Error(`TikTok API Error: ${response.data.message} (code: ${response.data.code})`)
      }
      
      return response.data.data
    } catch (error: any) {
      logger.error(`[TikTokClient] POST ${path} failed:`, error.response?.data || error.message)
      throw error
    }
  }
}
