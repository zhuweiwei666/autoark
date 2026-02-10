/**
 * Facebook Read APIs - 读取账户、广告系列、广告组、广告、数据
 */
import { fbClient } from './client'
import { normalizeForApi } from '../utils'

// ==================== 账户 ====================

export async function fetchAdAccounts(token: string) {
  const res = await fbClient.get('/me/adaccounts', {
    access_token: token,
    fields: 'id,name,account_id,account_status,currency,timezone_name,balance,amount_spent',
    limit: 200,
  })
  return res.data || []
}

// ==================== 广告系列 ====================

export async function fetchCampaigns(accountId: string, token?: string) {
  const params: any = {
    fields: 'id,name,objective,status,created_time,updated_time,buying_type,daily_budget,budget_remaining,lifetime_budget,start_time,stop_time,bid_strategy,account_id',
    limit: 500,
  }
  if (token) params.access_token = token
  const res = await fbClient.get(`/${normalizeForApi(accountId)}/campaigns`, params)
  return res.data || []
}

// ==================== 广告组 ====================

export async function fetchAdSets(accountId: string, token?: string) {
  const params: any = {
    fields: 'id,name,campaign_id,status,optimization_goal,billing_event,daily_budget,lifetime_budget,targeting,start_time,end_time',
    limit: 500,
  }
  if (token) params.access_token = token
  const res = await fbClient.get(`/${normalizeForApi(accountId)}/adsets`, params)
  return res.data || []
}

// ==================== 广告 ====================

export async function fetchAds(accountId: string, token?: string) {
  const params: any = {
    fields: 'id,name,adset_id,campaign_id,status,effective_status,creative{id,name,object_story_spec,image_hash,video_id,thumbnail_url}',
    limit: 500,
  }
  if (token) params.access_token = token
  const res = await fbClient.get(`/${normalizeForApi(accountId)}/ads`, params)
  return res.data || []
}

// ==================== 数据 (Insights) ====================

export async function fetchInsights(
  entityId: string,
  level: 'account' | 'campaign' | 'adset' | 'ad',
  opts: {
    datePreset?: string
    timeRange?: { since: string; until: string }
    breakdowns?: string[]
    token?: string
  } = {}
) {
  const fields = [
    'campaign_id', 'adset_id', 'ad_id',
    'impressions', 'clicks', 'spend', 'reach', 'frequency',
    'cpc', 'ctr', 'cpm', 'actions', 'action_values',
    'purchase_roas', 'conversions', 'cost_per_action_type',
    'date_start', 'date_stop',
  ].join(',')

  const params: any = { level, fields, limit: 1000 }
  if (opts.timeRange) {
    params.time_range = JSON.stringify(opts.timeRange)
  } else {
    params.date_preset = opts.datePreset || 'last_7d'
  }
  if (opts.breakdowns?.length) params.breakdowns = opts.breakdowns.join(',')
  if (opts.token) params.access_token = opts.token

  const res = await fbClient.get(`/${entityId}/insights`, params)
  return res.data || []
}

// ==================== Pages & Pixels ====================

export async function fetchPages(accountId: string, token: string) {
  try {
    const res = await fbClient.get(`/${normalizeForApi(accountId)}/promote_pages`, {
      access_token: token, fields: 'id,name,picture', limit: 100,
    })
    return res.data || []
  } catch { return [] }
}

export async function fetchPixels(accountId: string, token: string) {
  try {
    const res = await fbClient.get(`/${normalizeForApi(accountId)}/adspixels`, {
      access_token: token, fields: 'id,name,last_fired_time', limit: 100,
    })
    return res.data || []
  } catch { return [] }
}

// ==================== 搜索 ====================

export async function searchInterests(token: string, query: string) {
  const res = await fbClient.get('/search', { access_token: token, type: 'adinterest', q: query, limit: 50 })
  return res.data || []
}

export async function searchLocations(token: string, query: string) {
  const res = await fbClient.get('/search', {
    access_token: token, type: 'adgeolocation', q: query,
    location_types: JSON.stringify(['country', 'region', 'city']), limit: 50,
  })
  return res.data || []
}
