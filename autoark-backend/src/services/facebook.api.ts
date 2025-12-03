import axios from 'axios'
import logger from '../utils/logger'
import { getFacebookAccessToken } from '../utils/fbToken'

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
      // 通知 Token Pool（如果已初始化）
      try {
        const { tokenPool } = require('./facebook.token.pool')
        if (tokenPool && tokenPool.markTokenFailure) {
          tokenPool.markTokenFailure(token, error)
        }
      } catch {
        // Token Pool 未初始化，忽略
      }
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

export const fbClient = {
  get: async (endpoint: string, params: any = {}) => {
    const startTime = Date.now()
    const url = `${FB_BASE_URL}/${FB_API_VERSION}${endpoint}`

    // 尝试使用 Token Pool（如果可用）
    let token = params.access_token
    if (!token) {
      try {
        const { tokenPool } = require('./facebook.token.pool')
        if (tokenPool && tokenPool.getNextToken) {
          token = tokenPool.getNextToken()
        }
      } catch {
        // Token Pool 未初始化，使用默认方式
      }
      
      if (!token) {
        token = await getFacebookAccessToken()
      }
    }

    let retries = 0
    const maxRetries = 3
    
    while (retries < maxRetries) {
      try {
        const res = await axios.get(url, {
          params: {
            access_token: token,
            ...params,
          },
        })
        
        // 标记成功
        try {
          const { tokenPool } = require('./facebook.token.pool')
          if (tokenPool && tokenPool.markTokenSuccess) {
            tokenPool.markTokenSuccess(token)
          }
        } catch {
          // Token Pool 未初始化，忽略
        }
        
        logger.timerLog(`[Facebook API] GET ${endpoint}`, startTime)
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
          try {
            const { tokenPool } = require('./facebook.token.pool')
            if (tokenPool && tokenPool.markTokenFailure) {
              tokenPool.markTokenFailure(token, error)
            }
          } catch {
            // Token Pool 未初始化，忽略
          }
          
          // 尝试获取新 token
          try {
            const { tokenPool } = require('./facebook.token.pool')
            if (tokenPool && tokenPool.getNextToken) {
              const newToken = tokenPool.getNextToken()
              if (newToken && newToken !== token) {
                token = newToken
                logger.info(`[Facebook API] Switched to new token due to rate limit`)
                retries++
                continue
              }
            }
          } catch {
            // Token Pool 未初始化，忽略
          }
          
          // 随机退避
          const backoff = 2000 + Math.random() * 500
          logger.warn(`[Facebook API] Rate limited, backing off ${backoff}ms`)
          await new Promise((resolve) => setTimeout(resolve, backoff))
          retries++
          continue
        }
        
        // 其他错误：直接抛出
        handleApiError(`GET ${endpoint}`, error, token)
      }
    }
    
    // 所有重试都失败
    throw new Error(`Facebook API [GET ${endpoint}] failed after ${maxRetries} retries`)
  },
}

export const fetchUserAdAccounts = async (token?: string) => {
  const params: any = {
    fields:
      'id,account_status,name,currency,balance,spend_cap,amount_spent,disable_reason',
    limit: 500,
  }
  if (token) {
    params.access_token = token
  }
  const res = await fbClient.get('/me/adaccounts', params)
  return res.data || []
}

export const fetchCampaigns = async (accountId: string, token?: string) => {
  const params: any = {
    fields:
      'id,name,objective,status,created_time,updated_time,buying_type,daily_budget,budget_remaining,lifetime_budget,start_time,stop_time,bid_strategy,bid_amount,account_id,special_ad_categories,source_campaign_id,promoted_object',
    limit: 1000,
  }
  if (token) {
    params.access_token = token
  }
  const res = await fbClient.get(`/${accountId}/campaigns`, params)
  return res.data || []
}

export const fetchAdSets = async (accountId: string) => {
  const res = await fbClient.get(`/${accountId}/adsets`, {
    fields:
      'id,name,status,campaign_id,optimization_goal,billing_event,bid_amount,daily_budget,created_time,updated_time',
    limit: 1000,
  })
  return res.data || []
}

export const fetchAds = async (accountId: string, token?: string) => {
  const params: any = {
    fields:
      'id,name,status,adset_id,campaign_id,creative{id},created_time,updated_time',
    limit: 1000,
  }
  if (token) {
    params.access_token = token
  }
  const res = await fbClient.get(`/${accountId}/ads`, params)
  return res.data || []
}

export const fetchCreatives = async (accountId: string) => {
  const res = await fbClient.get(`/${accountId}/adcreatives`, {
    fields: 'id,name,object_story_spec,thumbnail_url,image_url,status', // simplified fields
    limit: 500,
  })
  return res.data || []
}

export const fetchInsights = async (
  entityId: string, // 可以是 accountId, campaignId, adsetId, adId
  level: 'account' | 'campaign' | 'adset' | 'ad',
  datePreset = 'today',
  token?: string,
  breakdowns?: string[], // 支持 breakdowns，如 ['country'] 来按国家分组
) => {
  // Facebook Insights API 有效字段列表
  // 注意：cpa, conversion_rate, value, mobile_app_install 不是有效字段
  // 这些数据应该从 actions 和 action_values 中获取
  const fields = [
    'campaign_id',
    'adset_id',
    'ad_id',
    'impressions',
    'clicks',
    'unique_clicks',
    'spend',
    'reach',
    'frequency',
    'cpc',
    'ctr',
    'cpm',
    'cpp',
    'cost_per_conversion', // 有效字段
    'conversions', // 有效字段
    'actions', // 用于获取转化数据（包括 mobile_app_install）
    'action_values', // 用于获取转化价值（包括 purchase value）
    'unique_actions',
    'purchase_roas', // Return on Ad Spend
    'cost_per_action_type', // 有效字段
    'video_play_actions',
    'video_30_sec_watched_actions',
    'video_avg_time_watched_actions',
    'video_p100_watched_actions',
    'video_p25_watched_actions',
    'video_p50_watched_actions',
    'video_p75_watched_actions',
    'video_p95_watched_actions',
    'video_thruplay_watched_actions',
    'video_time_watched_actions',
    'date_start',
    'date_stop',
  ].join(',')

  const params: any = {
    level: level,
    date_preset: datePreset,
    fields,
    limit: 1000,
  }
  
  // 如果指定了 breakdowns，添加到参数中
  if (breakdowns && breakdowns.length > 0) {
    params.breakdowns = breakdowns.join(',')
  }
  
  if (token) {
    params.access_token = token
  }

  const res = await fbClient.get(`/${entityId}/insights`, params)
  return res.data || []
}
