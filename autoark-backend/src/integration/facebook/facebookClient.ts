import axios from 'axios'
import logger from '../../utils/logger'
import { getFacebookAccessToken } from '../../utils/fbToken'
import { tokenPool } from './tokenPool'

const FB_API_VERSION = 'v19.0'
const FB_BASE_URL = 'https://graph.facebook.com'

const handleApiError = (context: string, error: any, token?: string) => {
  const errMsg = error.response?.data?.error?.message || error.message
  const errorCode = error.response?.data?.error?.code
  
  // 限流错误：通知 Token Pool
  if (
    errorCode === 4 || // Application request limit reached
    errorCode === 17 || // User request limit reached
    errMsg.includes('rate limit') ||
    errMsg.includes('request limit')
  ) {
    if (token) {
      // 通知 Token Pool
      tokenPool.markTokenFailure(token, error)
    }
    
    logger.warn(`Facebook API Rate Limit [${context}]: ${errMsg}`)
    throw new Error(`RATE_LIMIT: ${errMsg}`)
  }
  
  logger.error(
    `Facebook API Error [${context}]: ${errMsg}`,
    error.response?.data,
  )
  throw new Error(`Facebook API [${context}] failed: ${errMsg}`)
}

export const facebookClient = {
  get: async (endpoint: string, params: any = {}) => {
    // ... (existing get logic implementation details omitted for brevity, but logically present)
    return request('GET', endpoint, params)
  },

  post: async (endpoint: string, data: any = {}, params: any = {}) => {
    return request('POST', endpoint, { ...params, ...data }) // FB API often takes data as params/query for POST too, but typically body. 
    // Graph API can take params in URL or body. Axios 'params' is URL query, 'data' is body.
    // For FB Graph API, simple fields can go in params or formData.
    // Let's refine the request helper.
  }
}

// 统一请求处理函数
const request = async (method: 'GET' | 'POST', endpoint: string, dataOrParams: any = {}) => {
  const startTime = Date.now()
  const url = `${FB_BASE_URL}/${FB_API_VERSION}${endpoint}`

  // 尝试使用 Token Pool（如果可用）
  let token = dataOrParams.access_token
  if (!token) {
    if (tokenPool && tokenPool.getNextToken) {
      token = tokenPool.getNextToken()
    }
    
    if (!token) {
      token = await getFacebookAccessToken()
    }
  }

  let retries = 0
  const maxRetries = 3
  
  while (retries < maxRetries) {
    try {
      const config: any = {
        method,
        url,
      }

      if (method === 'GET') {
        config.params = {
          access_token: token,
          ...dataOrParams,
        }
      } else {
        // POST - Facebook Graph API 接受 URL params 方式
        // 将所有参数放在 params 中（不使用 JSON body）
        config.params = {
          access_token: token,
          ...dataOrParams,
        }
      }

      const res = await axios(config)
      
      // 标记成功
      if (tokenPool && tokenPool.markTokenSuccess) {
        tokenPool.markTokenSuccess(token)
      }
      
      logger.timerLog(`[Facebook API] ${method} ${endpoint}`, startTime)
      return res.data
    } catch (error: any) {
      const errorCode = error.response?.data?.error?.code
      const errMsg = error.response?.data?.error?.message || error.message
      
      // 限流错误：尝试切换 token 或等待
      if (
        (errorCode === 4 || errorCode === 17 || errMsg.includes('rate limit')) &&
        retries < maxRetries - 1
      ) {
        // 标记当前 token 失败
        if (tokenPool && tokenPool.markTokenFailure) {
          tokenPool.markTokenFailure(token, error)
        }
        
        // 尝试获取新 token
        if (tokenPool && tokenPool.getNextToken) {
          const newToken = tokenPool.getNextToken()
          if (newToken && newToken !== token) {
            token = newToken
            logger.info(`[Facebook API] Switched to new token due to rate limit`)
            retries++
            continue
          }
        }
        
        // 随机退避
        const backoff = 2000 + Math.random() * 500
        logger.warn(`[Facebook API] Rate limited, backing off ${backoff}ms`)
        await new Promise((resolve) => setTimeout(resolve, backoff))
        retries++
        continue
      }
      
      // 其他错误：直接抛出
      handleApiError(`${method} ${endpoint}`, error, token)
    }
  }
  
  // 所有重试都失败
  throw new Error(`Facebook API [${method} ${endpoint}] failed after ${maxRetries} retries`)
}

