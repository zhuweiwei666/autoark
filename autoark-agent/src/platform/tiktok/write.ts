import { ttClient } from './client'

export async function updateTiktokCampaign(advertiserId: string, campaignId: string, data: any, token: string) {
  return ttClient.post('/campaign/update/', { advertiser_id: advertiserId, campaign_id: campaignId, ...data }, token)
}

export async function updateTiktokAdGroup(advertiserId: string, adGroupId: string, data: any, token: string) {
  return ttClient.post('/adgroup/update/', { advertiser_id: advertiserId, adgroup_id: adGroupId, ...data }, token)
}
