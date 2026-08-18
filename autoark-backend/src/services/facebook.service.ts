import axios from 'axios'
import dotenv from 'dotenv'
import logger from '../utils/logger'
import { getEffectiveAdAccounts } from './facebook.sync.service' // Import from sync service
import { getFacebookAccessToken } from '../utils/fbToken'
import { FB_API_VERSION, FB_BASE_URL } from '../config/facebook.config'
import { normalizeForApi, normalizeForStorage } from '../utils/accountId'
import MetaInsightsCoverage from '../models/MetaInsightsCoverage'
import MetaInsightsFact from '../models/MetaInsightsFact'
import { addDateDays, formatShanghaiDate } from '../utils/shanghaiDate'

dotenv.config()

// Generic error handler helper
const handleApiError = (context: string, error: any) => {
  const errMsg = error.response?.data?.error?.message || error.message
  logger.error(
    `Facebook API Error [${context}]: ${errMsg}`,
    error.response?.data,
  )
  throw new Error(`Facebook API [${context}] failed: ${errMsg}`)
}

export const getAccountInfo = async (accountId: string, accessToken?: string) => {
  const startTime = Date.now()
  logger.info(`[Facebook API] getAccountInfo started for ${accountId}`)
  try {
    const token = accessToken || await getFacebookAccessToken()
    const url = `${FB_BASE_URL}/${FB_API_VERSION}/${normalizeForApi(accountId)}`
    const res = await axios.get(url, {
      params: {
        access_token: token,
        fields: 'id,name,currency,timezone_name',
      },
    })
    logger.timerLog(`[Facebook API] getAccountInfo for ${accountId}`, startTime)
    return res.data
  } catch (error) {
    handleApiError('getAccountInfo', error)
  }
}

export const getCampaigns = async (accountId: string, accessToken?: string) => {
  const startTime = Date.now()
  logger.info(`[Facebook API] getCampaigns started for ${accountId}`)
  try {
    const token = accessToken || await getFacebookAccessToken()
    const url = `${FB_BASE_URL}/${FB_API_VERSION}/${normalizeForApi(accountId)}/campaigns`
    const res = await axios.get(url, {
      params: {
        access_token: token,
        fields: 'id,name,objective,status,start_time,stop_time',
        limit: 1000, // Handle pagination in real prod
      },
    })
    logger.timerLog(`[Facebook API] getCampaigns for ${accountId}`, startTime)
    return res.data // Usually { data: [...] }
  } catch (error) {
    handleApiError('getCampaigns', error)
  }
}

export const getAdSets = async (accountId: string, accessToken?: string) => {
  const startTime = Date.now()
  logger.info(`[Facebook API] getAdSets started for ${accountId}`)
  try {
    const token = accessToken || await getFacebookAccessToken()
    const url = `${FB_BASE_URL}/${FB_API_VERSION}/${normalizeForApi(accountId)}/adsets`
    const res = await axios.get(url, {
      params: {
        access_token: token,
        fields:
          'id,name,optimization_goal,billing_event,bid_amount,daily_budget,campaign_id,status,targeting',
        limit: 1000,
      },
    })
    logger.timerLog(`[Facebook API] getAdSets for ${accountId}`, startTime)
    return res.data
  } catch (error) {
    handleApiError('getAdSets', error)
  }
}

export const getAds = async (accountId: string, accessToken?: string) => {
  const startTime = Date.now()
  logger.info(`[Facebook API] getAds started for ${accountId}`)
  try {
    const token = accessToken || await getFacebookAccessToken()
    const url = `${FB_BASE_URL}/${FB_API_VERSION}/${normalizeForApi(accountId)}/ads`
    const res = await axios.get(url, {
      params: {
        access_token: token,
        fields: 'id,name,status,creative{id},adset_id,campaign_id',
        limit: 1000,
      },
    })
    logger.timerLog(`[Facebook API] getAds for ${accountId}`, startTime)
    return res.data
  } catch (error) {
    handleApiError('getAds', error)
  }
}

/**
 * Read daily insights from the permanent normalized fact store. Query handlers
 * must never depend on a currently valid Meta token to access history.
 */
export const getInsightsDaily = async (
  accountId: string,
  dateRange?: { since: string; until: string },
  _accessToken?: string,
) => {
  const accountIdForStorage = normalizeForStorage(accountId)
  const yesterday = addDateDays(formatShanghaiDate(), -1)
  const since = dateRange?.since || yesterday
  const until = dateRange?.until || yesterday
  const [facts, coverage] = await Promise.all([
    MetaInsightsFact.find({
      provider: 'facebook',
      accountId: accountIdForStorage,
      date: { $gte: since, $lte: until },
    })
      .select('date accountId accountName campaignId campaignName optimizer country spend revenue impressions clicks installs fetchedAt')
      .sort({ date: 1, campaignId: 1, country: 1 })
      .lean(),
    MetaInsightsCoverage.find({
      provider: 'facebook',
      accountId: accountIdForStorage,
      date: { $gte: since, $lte: until },
    })
      .select('date status hasSnapshot factRows lastSuccessAt lastFailureAt frozenAt')
      .sort({ date: 1 })
      .lean(),
  ])

  return {
    data: facts.map((fact: any) => ({
      date: fact.date,
      channel: 'facebook',
      accountId: fact.accountId,
      accountName: fact.accountName,
      campaignId: fact.campaignId,
      campaignName: fact.campaignName,
      optimizer: fact.optimizer,
      country: fact.country,
      impressions: fact.impressions,
      clicks: fact.clicks,
      installs: fact.installs,
      spendUsd: fact.spend,
      revenueD0: fact.revenue,
      cpiUsd: fact.installs > 0 ? fact.spend / fact.installs : 0,
      roiD0: fact.spend > 0 ? fact.revenue / fact.spend : 0,
      fetchedAt: fact.fetchedAt,
    })),
    coverage,
    cached: true,
    meta: { startDate: since, endDate: until, grain: 'campaign-country-day' },
  }
}

// Re-export getEffectiveAdAccounts for convenience
export { getEffectiveAdAccounts }
