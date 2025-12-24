import { tiktokClient } from './tiktokClient'

/**
 * TikTok Insights API
 */
export const fetchTiktokInsights = async (
  advertiserId: string,
  level: 'AUCTION_ADVERTISER' | 'AUCTION_CAMPAIGN' | 'AUCTION_ADGROUP' | 'AUCTION_AD',
  reportType: 'BASIC' | 'AUDIENCE' | 'VIDEO',
  params: {
    start_date: string
    end_date: string
    time_granularity?: 'STAT_TIME_GRANULARITY_DAILY' | 'STAT_TIME_GRANULARITY_HOURLY'
    dimensions?: string[]
    metrics?: string[]
    page?: number
    page_size?: number
  },
  accessToken: string
) => {
  const defaultMetrics = [
    'spend',
    'impressions',
    'clicks',
    'conversions',
    'conversion_rate',
    'cpc',
    'cpm',
    'ctr',
    'video_play_actions',
    'video_watched_2s',
    'video_watched_6s',
    'video_views_p25',
    'video_views_p50',
    'video_views_p75',
    'video_views_p100',
    'average_video_play',
    'add_to_cart',
    'initiate_checkout',
    'purchase'
  ]

  const requestParams = {
    advertiser_id: advertiserId,
    report_type: reportType,
    data_level: level,
    start_date: params.start_date,
    end_date: params.end_date,
    time_granularity: params.time_granularity || 'STAT_TIME_GRANULARITY_DAILY',
    metrics: JSON.stringify(params.metrics || defaultMetrics),
    dimensions: JSON.stringify(params.dimensions || ['stat_time_day']),
    page: params.page || 1,
    page_size: params.page_size || 1000,
  }

  return tiktokClient.get('/report/integrated/get/', requestParams, accessToken)
}
