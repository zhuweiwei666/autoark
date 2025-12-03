import { facebookClient } from './facebookClient'

export const fetchAdSets = async (accountId: string) => {
  const res = await facebookClient.get(`/${accountId}/adsets`, {
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
  const res = await facebookClient.get(`/${accountId}/ads`, params)
  return res.data || []
}

export const fetchCreatives = async (accountId: string) => {
  const res = await facebookClient.get(`/${accountId}/adcreatives`, {
    fields: 'id,name,object_story_spec,thumbnail_url,image_url,status', // simplified fields
    limit: 500,
  })
  return res.data || []
}

