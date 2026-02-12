/**
 * Step 2: 数据加工 - 纯计算，不调 LLM
 * 输入：Metabase 原始行数据（3 天）
 * 输出：每个 campaign 的加工后指标
 */
import dayjs from 'dayjs'

export interface RawRow {
  id: number
  to_date: string
  pkg_name: string | null
  optimizer: string | null
  optimizer_id: string | null
  platform: string | null
  ad_account_name: string | null
  ad_account_id: string | null
  campaign_name: string | null
  campaign_id: string | null
  ad_set_name: string | null
  ad_set_id: string | null
  ad_name: string | null
  ad_id: string | null
  original_ad_spend: number | null
  [key: string]: any // 其他字段
}

export interface CampaignMetrics {
  campaignId: string
  campaignName: string
  accountId: string
  accountName: string
  platform: string
  optimizer: string
  pkgName: string

  // 今日指标
  todaySpend: number
  todayRevenue: number
  todayRoas: number
  todayImpressions: number
  todayClicks: number
  todayConversions: number

  // 昨日指标
  yesterdaySpend: number
  yesterdayRoas: number

  // 前天指标
  dayBeforeSpend: number
  dayBeforeRoas: number

  // 趋势
  spendTrend: number   // 今日 vs 昨日花费变化% (+20 = 增长20%)
  roasTrend: number    // 今日 vs 昨日 ROAS 变化%

  // 累计
  totalSpend3d: number
  totalRevenue3d: number
  avgRoas3d: number

  // 效率
  estimatedDailySpend: number
  spendPerHour: number

  // 转化指标（来自 4002）
  installs: number
  cpi: number
  cpa: number
  firstDayRoi: number
  adjustedRoi: number
  day3Roi: number
  day7Roi: number
  payRate: number
  arpu: number

  // 趋势摘要（自然语言，来自监控 Agent 的多维趋势分析）
  trendSummary: string

  // 原始天数据
  dailyData: Array<{ date: string; spend: number; revenue: number; roas: number }>
}

/**
 * 把 Metabase 原始数据加工成 campaign 维度指标
 */
export function analyzeData(
  rows: any[][],
  columns: string[],
  today: string,
  yesterday: string,
  dayBefore: string,
): CampaignMetrics[] {
  // 列名到索引的映射
  const colIdx = new Map<string, number>()
  columns.forEach((name, i) => colIdx.set(name.toLowerCase(), i))

  const get = (row: any[], col: string): any => {
    const i = colIdx.get(col.toLowerCase())
    return i !== undefined ? row[i] : null
  }

  // 按 campaign_id + date 聚合
  const campaignDays = new Map<string, Map<string, {
    spend: number; revenue: number; impressions: number; clicks: number; conversions: number
    campaignName: string; accountId: string; accountName: string; platform: string; optimizer: string; pkgName: string
  }>>()

  for (const row of rows) {
    const campaignId = get(row, 'campaign_id')
    const date = get(row, 'to_date')
    if (!campaignId || !date) continue

    if (!campaignDays.has(campaignId)) campaignDays.set(campaignId, new Map())
    const dayMap = campaignDays.get(campaignId)!

    if (!dayMap.has(date)) {
      dayMap.set(date, {
        spend: 0, revenue: 0, impressions: 0, clicks: 0, conversions: 0,
        campaignName: get(row, 'campaign_name') || '',
        accountId: get(row, 'ad_account_id') || '',
        accountName: get(row, 'ad_account_name') || '',
        platform: get(row, 'platform') || 'Facebook',
        optimizer: get(row, 'optimizer') || '',
        pkgName: get(row, 'pkg_name') || '',
      })
    }

    const d = dayMap.get(date)!
    d.spend += Number(get(row, 'original_ad_spend') || get(row, 'spend') || 0)
    d.revenue += Number(get(row, 'revenue') || get(row, 'purchase_value') || 0)
    d.impressions += Number(get(row, 'impressions') || 0)
    d.clicks += Number(get(row, 'clicks') || 0)
    d.conversions += Number(get(row, 'conversions') || get(row, 'installs') || 0)
  }

  // 计算每个 campaign 的加工指标
  const now = dayjs()
  const hoursPassed = now.hour() + now.minute() / 60 || 1

  const results: CampaignMetrics[] = []

  for (const [campaignId, dayMap] of campaignDays) {
    const todayData = dayMap.get(today)
    const yesterdayData = dayMap.get(yesterday)
    const dayBeforeData = dayMap.get(dayBefore)

    // 至少要有一天有数据
    if (!todayData && !yesterdayData) continue

    const meta = todayData || yesterdayData || dayBeforeData!
    const tSpend = todayData?.spend || 0
    const tRevenue = todayData?.revenue || 0
    const ySpend = yesterdayData?.spend || 0
    const yRevenue = yesterdayData?.revenue || 0
    const dbSpend = dayBeforeData?.spend || 0
    const dbRevenue = dayBeforeData?.revenue || 0

    const tRoas = tSpend > 0 ? tRevenue / tSpend : 0
    const yRoas = ySpend > 0 ? yRevenue / ySpend : 0
    const dbRoas = dbSpend > 0 ? dbRevenue / dbSpend : 0

    const totalSpend = tSpend + ySpend + dbSpend
    const totalRevenue = tRevenue + yRevenue + dbRevenue

    results.push({
      campaignId,
      campaignName: meta.campaignName,
      accountId: meta.accountId,
      accountName: meta.accountName,
      platform: meta.platform,
      optimizer: meta.optimizer,
      pkgName: meta.pkgName,

      todaySpend: round(tSpend),
      todayRevenue: round(tRevenue),
      todayRoas: round(tRoas),
      todayImpressions: todayData?.impressions || 0,
      todayClicks: todayData?.clicks || 0,
      todayConversions: todayData?.conversions || 0,

      yesterdaySpend: round(ySpend),
      yesterdayRoas: round(yRoas),

      dayBeforeSpend: round(dbSpend),
      dayBeforeRoas: round(dbRoas),

      spendTrend: ySpend > 0 ? round(((tSpend - ySpend) / ySpend) * 100) : 0,
      roasTrend: yRoas > 0 ? round(((tRoas - yRoas) / yRoas) * 100) : 0,

      totalSpend3d: round(totalSpend),
      totalRevenue3d: round(totalRevenue),
      avgRoas3d: totalSpend > 0 ? round(totalRevenue / totalSpend) : 0,

      estimatedDailySpend: round(tSpend / hoursPassed * 24),
      spendPerHour: round(tSpend / hoursPassed),

      // 转化指标（默认 0，后续由 data-fetcher 合并覆盖）
      installs: 0, cpi: 0, cpa: 0, firstDayRoi: 0, adjustedRoi: 0, day3Roi: 0, day7Roi: 0, payRate: 0, arpu: 0,

      trendSummary: '',  // 由 brain.ts 从监控 Agent 传入

      dailyData: [
        { date: dayBefore, spend: round(dbSpend), revenue: round(dbRevenue), roas: round(dbRoas) },
        { date: yesterday, spend: round(ySpend), revenue: round(yRevenue), roas: round(yRoas) },
        { date: today, spend: round(tSpend), revenue: round(tRevenue), roas: round(tRoas) },
      ],
    })
  }

  // 按花费排序（高花费优先处理）
  results.sort((a, b) => b.totalSpend3d - a.totalSpend3d)
  return results
}

function round(n: number, d = 2): number {
  return Number(n.toFixed(d))
}
