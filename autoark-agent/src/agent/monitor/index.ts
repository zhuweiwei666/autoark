/**
 * 监控 Agent 主入口
 * 
 * 采集 → 质量评估 → 存时序 → 多维趋势分析 → 检测异常 → 构建环境 → 输出 DecisionReadyData
 */
import dayjs from 'dayjs'
import { log } from '../../platform/logger'
import { collectData, RawCampaign } from './data-collector'
import { assessQuality, summarizeQuality } from './quality'
import { storeSamples } from './timeseries'
import { TimeSeries } from './timeseries.model'
import { buildCampaignTrends, describeTrends, calculateTrend, calculateSpendTrend } from './trend'
import { detectAnomalies, detectAccountAnomalies } from './anomaly'
import { buildEnvironment } from './environment'
import { DecisionReadyData, CampaignDecisionData, QualityResult } from './types'

/**
 * 运行完整的监控流程，输出决策就绪数据
 */
export async function monitor(): Promise<DecisionReadyData> {
  const today = dayjs().format('YYYY-MM-DD')
  const hour = dayjs().hour() + dayjs().minute() / 60  // UTC hour

  log.info('[Monitor] Starting perception cycle...')

  // Step 1: 只采集今天的数据（UTC+0），避免多天数据混淆
  const raw = await collectData(today, today)
  log.info(`[Monitor] Collected ${raw.length} raw campaigns`)

  // 按 campaignId 去重（同一 campaign 可能在 Metabase 和 FB 各有一条）
  const latestBycamp = new Map<string, RawCampaign>()
  for (const r of raw) {
    const existing = latestBycamp.get(r.campaignId)
    if (!existing || r.spend > existing.spend) latestBycamp.set(r.campaignId, r)
  }

  const campaigns = [...latestBycamp.values()]
  log.info(`[Monitor] Active: ${campaigns.length} campaigns (today ${today} UTC)`)

  // Step 2: 质量评估
  const qualities = new Map<string, QualityResult>()
  for (const c of campaigns) {
    qualities.set(c.campaignId, assessQuality(c, hour))
  }
  const qualitySummary = summarizeQuality(qualities, campaigns.length)
  log.info(`[Monitor] Quality: ${qualitySummary.reliableCount} reliable, ${qualitySummary.unreliableCount} unreliable (${qualitySummary.overallConfidence})`)

  // Step 3: 存时序
  await storeSamples(campaigns, qualities)

  // Step 4: 趋势 + 异常
  const peerGroups = new Map<string, RawCampaign[]>()
  for (const c of campaigns) {
    const key = c.optimizer || 'unknown'
    const group = peerGroups.get(key) || []
    group.push(c)
    peerGroups.set(key, group)
  }

  // 批量查时序：最近 24h + 昨天同时段（一次查询）
  const allCampaignIds = campaigns.map(c => c.campaignId)
  let historyMap = new Map<string, any[]>()
  let yesterdayMap = new Map<string, any>()

  try {
    // 查最近 24h 的时序数据（每个 campaign 最多 24 个点，即 4h 的 10min 间隔数据）
    const allHistory = await TimeSeries.find({
      campaignId: { $in: allCampaignIds },
      sampledAt: { $gte: dayjs().subtract(6, 'hour').toDate() },
    }).sort({ sampledAt: -1 }).limit(allCampaignIds.length * 36).lean()

    for (const h of allHistory as any[]) {
      const arr = historyMap.get(h.campaignId) || []
      if (arr.length < 36) arr.push(h)
      historyMap.set(h.campaignId, arr)
    }

    // 查昨天同时段（-24h ± 30min）的数据做日间对比
    const yStart = dayjs().subtract(24.5, 'hour').toDate()
    const yEnd = dayjs().subtract(23.5, 'hour').toDate()
    const yData = await TimeSeries.find({
      campaignId: { $in: allCampaignIds },
      sampledAt: { $gte: yStart, $lte: yEnd },
    }).sort({ sampledAt: -1 }).lean()

    for (const y of yData as any[]) {
      if (!yesterdayMap.has(y.campaignId)) {
        yesterdayMap.set(y.campaignId, y)
      }
    }
    log.info(`[Monitor] TimeSeries: ${historyMap.size} campaigns with history, ${yesterdayMap.size} with yesterday data`)
  } catch { /* 首次运行 */ }

  const results: CampaignDecisionData[] = []

  for (const c of campaigns) {
    const q = qualities.get(c.campaignId)!
    const history = historyMap.get(c.campaignId) || []
    const yesterday = yesterdayMap.get(c.campaignId) || null
    const roi = c.adjustedRoi || c.firstDayRoi || 0

    // 多维度趋势
    const trends = buildCampaignTrends(history, yesterday)
    const trendSummary = describeTrends(trends)

    // 兼容旧趋势接口
    const legacyTrend = calculateTrend(history as any)
    const spendTrend = calculateSpendTrend(history as any)

    // 异常检测
    const peers = peerGroups.get(c.optimizer || 'unknown') || []
    const anomalies = detectAnomalies(c, history as any, peers, hour)

    // vsYesterday（兼容旧字段）
    let vsYesterday = 'N/A'
    if (trends.roi.prevYesterday !== null && trends.roi.prevYesterday > 0) {
      const pct = trends.roi.changeRateVsYesterday
      vsYesterday = `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`
    }

    results.push({
      id: c.campaignId,
      name: c.campaignName,
      accountId: c.accountId || '',
      platform: c.platform,
      optimizer: c.optimizer,
      pkgName: c.pkgName,
      spend: c.spend,
      roi,
      installs: c.installs,
      cpi: c.cpi,
      revenue: c.revenue,
      confidence: q.confidence,
      dataNote: q.notes.join('; '),
      reliable: q.reliable,
      // 新：多维度趋势
      trends,
      trendSummary,
      // 兼容旧字段
      trend: legacyTrend.trend,
      trendSlope: legacyTrend.slope,
      trendAcceleration: legacyTrend.acceleration,
      volatility: legacyTrend.volatility,
      vsYesterday,
      vs3dayAvg: 'N/A',
      anomalies,
      estimatedDailySpend: spendTrend.predicted24h,
      estimatedDailyRoi: roi,
      firstDayRoi: c.firstDayRoi,
      adjustedRoi: c.adjustedRoi,
      day3Roi: c.day3Roi,
      payRate: c.payRate,
      arpu: c.arpu,
    })
  }

  // 优化师级异常
  for (const [optimizer, groupCampaigns] of peerGroups) {
    const groupAnomalies = detectAccountAnomalies(optimizer, groupCampaigns)
    if (groupAnomalies.length > 0) {
      for (const r of results.filter(r => r.optimizer === optimizer)) {
        r.anomalies.push(...groupAnomalies)
      }
    }
  }

  // Step 5: 环境上下文
  const environment = await buildEnvironment(campaigns)

  // 按花费排序（高花费优先）
  results.sort((a, b) => b.spend - a.spend)

  const data: DecisionReadyData = {
    campaigns: results,
    environment,
    dataQuality: qualitySummary,
    sampledAt: new Date(),
  }

  log.info(`[Monitor] Done: ${results.length} campaigns, ${results.reduce((s, r) => s + r.anomalies.length, 0)} anomalies`)
  return data
}

// Re-export types
export type { DecisionReadyData, CampaignDecisionData } from './types'
