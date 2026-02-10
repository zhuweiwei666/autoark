import axios from 'axios'
import { log } from '../logger'
import { tokenPool } from './token'
import { FB_API_VERSION, FB_BASE_URL } from './config'

class FacebookApiError extends Error {
  response?: any
  code?: number
  subcode?: number
  constructor(message: string, responseData?: any) {
    super(message)
    this.name = 'FacebookApiError'
    this.response = responseData
    if (responseData?.error) {
      this.code = responseData.error.code
      this.subcode = responseData.error.error_subcode
    }
  }
}

const handleApiError = (context: string, error: any, token?: string) => {
  const errMsg = error.response?.data?.error?.message || error.message
  const errorCode = error.response?.data?.error?.code
  if (errorCode === 4 || errorCode === 17 || errMsg.includes('rate limit')) {
    if (token) tokenPool.markTokenFailure(token, error)
    throw new FacebookApiError(`RATE_LIMIT: ${errMsg}`, error.response?.data)
  }
  log.error(`Facebook API Error [${context}]: ${errMsg}`)
  throw new FacebookApiError(`Facebook API [${context}] failed: ${errMsg}`, error.response?.data)
}

const request = async (method: 'GET' | 'POST', endpoint: string, dataOrParams: any = {}) => {
  const url = `${FB_BASE_URL}/${FB_API_VERSION}${endpoint}`
  let token = dataOrParams.access_token || tokenPool.getNextToken()
  let retries = 0

  while (retries < 3) {
    try {
      const config: any = { method, url, timeout: 60000 }
      if (method === 'GET') {
        const params: any = { access_token: token }
        for (const [k, v] of Object.entries(dataOrParams)) {
          if (k !== 'access_token' && v !== undefined) params[k] = v
        }
        config.params = params
        config.paramsSerializer = (p: any) =>
          Object.entries(p).filter(([, v]) => v != null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')
      } else {
        config.params = { access_token: token }
        const body: string[] = []
        for (const [k, v] of Object.entries(dataOrParams)) {
          if (k !== 'access_token' && v != null) body.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        }
        config.data = body.join('&')
        config.headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
      const res = await axios(config)
      tokenPool.markTokenSuccess(token!)
      return res.data
    } catch (error: any) {
      const code = error.response?.data?.error?.code
      if ((code === 4 || code === 17) && retries < 2) {
        if (token) tokenPool.markTokenFailure(token, error)
        const next = tokenPool.getNextToken()
        if (next && next !== token) { token = next; retries++; continue }
        await new Promise((r) => setTimeout(r, 2000 + Math.random() * 500))
        retries++; continue
      }
      handleApiError(`${method} ${endpoint}`, error, token!)
    }
  }
  throw new Error(`Facebook API failed after 3 retries`)
}

export const fbClient = {
  get: (endpoint: string, params: any = {}) => request('GET', endpoint, params),
  post: (endpoint: string, data: any = {}) => request('POST', endpoint, data),
}
