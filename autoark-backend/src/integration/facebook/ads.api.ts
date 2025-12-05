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
    // 增强 creative 字段，获取 image_hash, video_id 等素材标识
    fields:
      'id,name,status,adset_id,campaign_id,creative{id,name,image_hash,image_url,thumbnail_url,video_id,object_story_spec},created_time,updated_time',
    limit: 1000,
  }
  if (token) {
    params.access_token = token
  }
  const res = await facebookClient.get(`/${accountId}/ads`, params)
  return res.data || []
}

export const fetchCreatives = async (accountId: string, token?: string) => {
  const params: any = {
    // 增强字段，获取 image_hash, video_id 等素材标识
    fields: 'id,name,status,image_hash,image_url,thumbnail_url,video_id,object_story_spec,asset_feed_spec,effective_object_story_id',
    limit: 500,
  }
  if (token) {
    params.access_token = token
  }
  const res = await facebookClient.get(`/${accountId}/adcreatives`, params)
  return res.data || []
}

