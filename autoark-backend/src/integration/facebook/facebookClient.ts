import axios from 'axios'
import logger from '../../utils/logger'
import { getFacebookAccessToken } from '../../utils/fbToken'
import { tokenPool } from './tokenPool'
import { FB_API_VERSION, FB_BASE_URL } from '../../config/facebook.config'

class FacebookApiError extends Error {
  response?: any
  code?: number
  subcode?: number
  userMessage?: string
  
  constructor(message: string, responseData?: any) {
    super(message)
    this.name = 'FacebookApiError'
    this.response = responseData
    if (responseData?.error) {
      this.code = responseData.error.code
      this.subcode = responseData.error.error_subcode
      this.userMessage = responseData.error.error_user_msg || responseData.error.error_user_title
    }
  }
}

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
    const rateLimitError = new FacebookApiError(`RATE_LIMIT: ${errMsg}`, error.response?.data)
    throw rateLimitError
  }
  
  logger.error(
    `Facebook API Error [${context}]: ${errMsg}`,
  )
  logger.error(`Facebook API Full Response: ${JSON.stringify(error.response?.data, null, 2)}`)
  const apiError = new FacebookApiError(`Facebook API [${context}] failed: ${errMsg}`, error.response?.data)
  throw apiError
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
        timeout: 60000, // 60s timeout
      }

      if (method === 'GET') {
        // GET 请求：所有参数都放在 URL query string 中
        const allParams: any = {
          access_token: token,
        }
        
        // 处理参数，确保不重复添加 access_token
        for (const [key, value] of Object.entries(dataOrParams)) {
          if (key !== 'access_token' && value !== undefined) {
            allParams[key] = value
          }
        }
        
        // 使用自定义序列化器确保 JSON 字符串正确编码
        config.params = allParams
        config.paramsSerializer = (params: any) => {
          const parts: string[] = []
          for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null) {
              parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
            }
          }
          return parts.join('&')
        }
      } else {
        // POST 请求：access_token 放在 URL 参数中，其他数据放在请求体中
        // Facebook Graph API 要求 POST 请求使用 application/x-www-form-urlencoded 格式
        // 这样可以避免 URL 长度限制，并符合 Facebook API 的标准要求
        config.params = {
          access_token: token,
        }
        
        // 构建请求体数据（排除 access_token）
        const bodyParts: string[] = []
        for (const [key, value] of Object.entries(dataOrParams)) {
          if (key !== 'access_token' && value !== undefined && value !== null) {
            bodyParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
          }
        }
        
        // 使用 application/x-www-form-urlencoded 格式发送数据
        config.data = bodyParts.join('&')
        config.headers = {
          'Content-Type': 'application/x-www-form-urlencoded',
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

