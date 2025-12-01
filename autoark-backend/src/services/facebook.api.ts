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
      const token = await getFacebookAccessToken()
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

export const fetchUserAdAccounts = async () => {
  const res = await fbClient.get('/me/adaccounts', {
    fields: 'id,account_status,name',
    limit: 500,
  })
  return res.data || []
}

export const fetchCampaigns = async (accountId: string) => {
  const res = await fbClient.get(`/${accountId}/campaigns`, {
    fields: 'id,name,objective,status,created_time,updated_time',
    limit: 1000,
  })
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
  accountId: string,
  datePreset = 'today',
) => {
  // Level = ad to get granular data
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
    'action_values',
    'date_start',
    'date_stop',
  ].join(',')

  const res = await fbClient.get(`/${accountId}/insights`, {
    level: 'ad',
    date_preset: datePreset,
    fields,
    limit: 1000,
  })
  return res.data || []
}
