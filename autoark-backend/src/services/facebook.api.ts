import axios from 'axios'
import logger from '../utils/logger'
import { getFacebookAccessToken } from '../utils/fbToken'

const FB_API_VERSION = 'v19.0'
const FB_BASE_URL = 'https://graph.facebook.com'

const handleApiError = (context: string, error: any) => {
  const errMsg = error.response?.data?.error?.message || error.message
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

    try {
      const token = params.access_token || (await getFacebookAccessToken())
      const res = await axios.get(url, {
        params: {
          access_token: token,
          ...params,
        },
      })
      logger.timerLog(`[Facebook API] GET ${endpoint}`, startTime)
      return res.data
    } catch (error) {
      handleApiError(`GET ${endpoint}`, error)
    }
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

export const fetchAds = async (accountId: string) => {
  const res = await fbClient.get(`/${accountId}/ads`, {
    fields:
      'id,name,status,adset_id,campaign_id,creative{id},created_time,updated_time',
    limit: 1000,
  })
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
