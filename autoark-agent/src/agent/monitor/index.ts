/**
 * 监控 Agent 主入口
 * 
 * 采集 → 质量评估 → 存时序 → 算趋势 → 检测异常 → 构建环境 → 输出 DecisionReadyData
 */
import dayjs from 'dayjs'
import { log } from '../../platform/logger'
import { collectData, RawCampaign } from './data-collector'
import { assessQuality, summarizeQuality } from './quality'
import { storeSamples } from './timeseries'
import { TimeSeries } from './timeseries.model'
import { calculateTrend, calculateSpendTrend } from './trend'
import { detectAnomalies, detectAccountAnomalies } from './anomaly'
import { buildEnvironment } from './environment'
import { DecisionReadyData, CampaignDecisionData, QualityResult } from './types'

/**
 * 运行完整的监控流程，输出决策就绪数据
 */
export async function monitor(): Promise<DecisionReadyData> {
  const today = dayjs().format('YYYY-MM-DD')
  const dayBefore = dayjs().subtract(2, 'day').format('YYYY-MM-DD')
  const utcHour = dayjs().hour() + dayjs().minute() / 60
  const hour = (utcHour + 8) % 24  // UTC → 北京时间

  log.info('[Monitor] Starting perception cycle...')

  // Step 1: 采集数据
  const raw = await collectData(dayBefore, today)
  log.info(`[Monitor] Collected ${raw.length} raw campaigns`)

  // 按 campaignId 聚合（可能多天数据）
  const latestBycamp = new Map<string, RawCampaign>()
  for (const r of raw) {
    const existing = latestBycamp.get(r.campaignId)
    if (!existing || r.date > existing.date) latestBycamp.set(r.campaignId, r)
  }
  const campaigns = [...latestBycamp.values()]

  // Step 2: 质量评估（纯计算，不查 DB，快）
  const qualities = new Map<string, QualityResult>()
  for (const c of campaigns) {
    qualities.set(c.campaignId, assessQuality(c, hour))
  }
  const qualitySummary = summarizeQuality(qualities, campaigns.length)
  log.info(`[Monitor] Quality: ${qualitySummary.reliableCount} reliable, ${qualitySummary.unreliableCount} unreliable (${qualitySummary.overallConfidence})`)

  // Step 3: 存时序
  await storeSamples(campaigns, qualities)

  // Step 4: 趋势 + 异常 + 预测
  // 用优化师分组做 peer 对比（同优化师的 campaign 互为参照）
  const peerGroups = new Map<string, RawCampaign[]>()
  for (const c of campaigns) {
    const key = c.optimizer || 'unknown'
    const group = peerGroups.get(key) || []
    group.push(c)
    peerGroups.set(key, group)
  }

  // 批量查时序（一次 DB 查询，不是每个 campaign 查一次）
  const allCampaignIds = campaigns.map(c => c.campaignId)
  const since2h = dayjs().subtract(2, 'hour').toDate()
  let historyMap = new Map<string, any[]>()
  try {
    const allHistory = await TimeSeries.find({
      campaignId: { $in: allCampaignIds },
      sampledAt: { $gte: dayjs().subtract(24, 'hour').toDate() },
    }).sort({ sampledAt: -1 }).limit(allCampaignIds.length * 12).lean()
    for (const h of allHistory as any[]) {
      const arr = historyMap.get(h.campaignId) || []
      if (arr.length < 12) arr.push(h)
      historyMap.set(h.campaignId, arr)
    }
  } catch { /* 首次运行 */ }

  const results: CampaignDecisionData[] = []

  for (const c of campaigns) {
    const q = qualities.get(c.campaignId)!
    const history = historyMap.get(c.campaignId) || []
    const roi = c.adjustedRoi || c.firstDayRoi || 0

    // 趋势
    const trend = calculateTrend(history as any)
    const spendTrend = calculateSpendTrend(history as any)

    // 异常
    const peers = peerGroups.get(c.optimizer || 'unknown') || []
    const anomalies = detectAnomalies(c, history as any, peers, hour)

    // 历史对比（用时序数据）
    let vsYesterday = 'N/A'
    const yData = history.filter((h: any) => dayjs(h.sampledAt).isBefore(dayjs().subtract(20, 'hour')))
    if (yData.length > 0) {
      const yRoi = (yData[0] as any).roi || 0
      if (yRoi > 0) vsYesterday = `${((roi / yRoi - 1) * 100).toFixed(0)}%`
    }

    results.push({
      id: c.campaignId,
      name: c.campaignName,
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
      trend: trend.trend,
      trendSlope: trend.slope,
      trendAcceleration: trend.acceleration,
      volatility: trend.volatility,
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

  // 优化师级异常（附加到该优化师下的所有 campaign 上）
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
