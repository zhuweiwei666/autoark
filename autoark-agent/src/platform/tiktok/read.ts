import { ttClient } from './client'

export async function fetchTiktokCampaigns(advertiserId: string, token: string) {
  return ttClient.get('/campaign/get/', { advertiser_id: advertiserId, page_size: 1000 }, token)
}

export async function fetchTiktokAdGroups(advertiserId: string, token: string) {
  return ttClient.get('/adgroup/get/', { advertiser_id: advertiserId, page_size: 1000 }, token)
}

export async function fetchTiktokAds(advertiserId: string, token: string) {
  return ttClient.get('/ad/get/', { advertiser_id: advertiserId, page_size: 1000 }, token)
}

export async function fetchTiktokInsights(
  advertiserId: string,
  level: 'AUCTION_CAMPAIGN' | 'AUCTION_ADGROUP' | 'AUCTION_AD',
  startDate: string, endDate: string, token: string,
) {
  const metrics = ['spend', 'impressions', 'clicks', 'conversions', 'cpc', 'cpm', 'ctr', 'conversion_rate']
  return ttClient.get('/report/integrated/get/', {
    advertiser_id: advertiserId,
    report_type: 'BASIC',
    data_level: level,
    dimensions: JSON.stringify(['stat_time_day']),
    metrics: JSON.stringify(metrics),
    start_date: startDate,
    end_date: endDate,
    page_size: 1000,
  }, token)
}
