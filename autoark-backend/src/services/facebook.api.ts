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
      'id,name,objective,status,created_time,updated_time,buying_type,daily_budget,budget_remaining',
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
) => {
  const fields = [
    'campaign_id',
    'adset_id',
    'ad_id',
    'impressions',
    'clicks',
    'spend',
    'cpc',
    'ctr',
    'cpm',
    'actions', // for conversions
    'action_values', // for conversion values
    'purchase_roas', // Return on Ad Spend
    'conversions', // For generic conversions
    'mobile_app_install', // For specific event count
    'date_start',
    'date_stop',
  ].join(',')

  const params: any = {
    level: level,
    date_preset: datePreset,
    fields,
    limit: 1000,
  }
  if (token) {
    params.access_token = token
  }

  const res = await fbClient.get(`/${entityId}/insights`, params)
  return res.data || []
}
