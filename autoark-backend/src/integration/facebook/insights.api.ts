import { facebookClient } from './facebookClient'

const MAX_INSIGHTS_PAGES = 100

export const fetchInsights = async (
  entityId: string, // 可以是 accountId, campaignId, adsetId, adId
  level: 'account' | 'campaign' | 'adset' | 'ad',
  datePreset?: string,
  token?: string,
  breakdowns?: string[], // 支持 breakdowns，如 ['country'] 来按国家分组
  timeRange?: { since: string; until: string }, // 支持自定义日期范围
) => {
  // Facebook Insights API 有效字段列表
  // 注意：cpa, conversion_rate, value, mobile_app_install 不是有效字段
  // 这些数据应该从 actions 和 action_values 中获取
  const fields = [
    'campaign_id',
    ...(level === 'campaign' ? ['campaign_name'] : []),
    'adset_id',
    'ad_id',
    'impressions',
    'clicks',
    'unique_clicks',
    'spend',
    'reach',
    'frequency',
    'cpc',
    'ctr',
    'cpm',
    'cpp',
    'cost_per_conversion', // 有效字段
    'conversions', // 有效字段
    'actions', // 用于获取转化数据（包括 mobile_app_install）
    'action_values', // 用于获取转化价值（包括 purchase value）
    'unique_actions',
    'purchase_roas', // Return on Ad Spend
    'cost_per_action_type', // 有效字段
    'video_play_actions',
    'video_30_sec_watched_actions',
    'video_avg_time_watched_actions',
    'video_p100_watched_actions',
    'video_p25_watched_actions',
    'video_p50_watched_actions',
    'video_p75_watched_actions',
    'video_p95_watched_actions',
    'video_thruplay_watched_actions',
    'video_time_watched_actions',
    'date_start',
    'date_stop',
  ].join(',')

  const params: any = {
    level: level,
    fields,
    limit: 1000,
  }
  
  // 优先使用 timeRange，否则使用 datePreset
  if (timeRange) {
    params.time_range = JSON.stringify(timeRange)
  } else if (datePreset) {
    params.date_preset = datePreset
  } else {
    params.date_preset = 'today'
  }
  
  // 如果指定了 breakdowns，添加到参数中
  if (breakdowns && breakdowns.length > 0) {
    params.breakdowns = breakdowns.join(',')
  }
  
  if (token) {
    params.access_token = token
  }

  const insights: any[] = []
  let after: string | undefined
  const seenCursors = new Set<string>()

  for (let page = 0; page < MAX_INSIGHTS_PAGES; page += 1) {
    const res = await facebookClient.get(`/${entityId}/insights`, {
      ...params,
      ...(after ? { after } : {}),
    })
    if (!Array.isArray(res?.data)) {
      throw new Error('Facebook Insights response data is not an array')
    }
    insights.push(...res.data)

    const nextAfter = res?.paging?.cursors?.after
    if (!res?.paging?.next) return insights
    if (!nextAfter || seenCursors.has(nextAfter)) {
      throw new Error('Facebook Insights pagination cursor is missing or repeated')
    }
    seenCursors.add(nextAfter)
    after = nextAfter
  }

  // Never persist a silently truncated snapshot. The next retry can resume with
  // a larger scoped query instead of treating partial Meta data as complete.
  throw new Error(`Facebook Insights exceeded ${MAX_INSIGHTS_PAGES} pages`)
}
