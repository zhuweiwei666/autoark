import { tiktokClient } from './tiktokClient'

/**
 * TikTok Campaign API
 */
export const updateTiktokCampaign = async (
  advertiserId: string,
  campaignId: string,
  data: {
    campaign_name?: string
    operation_status?: 'ENABLE' | 'DISABLE' | 'DELETE'
    budget_type?: 'BUDGET_MODE_INFINITE' | 'BUDGET_MODE_DAY' | 'BUDGET_MODE_TOTAL'
    budget?: number
  },
  accessToken: string
) => {
  return tiktokClient.post('/campaign/update/', {
    advertiser_id: advertiserId,
    campaign_id: campaignId,
    ...data
  }, accessToken)
}

/**
 * TikTok AdGroup API
 */
export const updateTiktokAdGroup = async (
  advertiserId: string,
  adgroupId: string,
  data: {
    adgroup_name?: string
    operation_status?: 'ENABLE' | 'DISABLE' | 'DELETE'
    budget_type?: 'BUDGET_MODE_DAY' | 'BUDGET_MODE_TOTAL'
    budget?: number
  },
  accessToken: string
) => {
  return tiktokClient.post('/adgroup/update/', {
    advertiser_id: advertiserId,
    adgroup_id: adgroupId,
    ...data
  }, accessToken)
}

/**
 * TikTok Ad API
 */
export const updateTiktokAd = async (
  advertiserId: string,
  adId: string,
  data: {
    ad_name?: string
    operation_status?: 'ENABLE' | 'DISABLE' | 'DELETE'
  },
  accessToken: string
) => {
  return tiktokClient.post('/ad/update/', {
    advertiser_id: advertiserId,
    ad_id: adId,
    ...data
  }, accessToken)
}
