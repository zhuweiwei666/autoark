/**
 * A1 数据融合引擎 — 统一多源数据为单一可信快照
 *
 * 字段级融合策略（Facebook优先）：
 *   spend     → FB insights（实时最高）；FB 为 0 时用 Metabase
 *   status    → FB API（唯一来源）
 *   budget    → FB API（唯一来源）
 *   roas      → Metabase adjustedRoi 优先（后端归因更准）；MB 为 0 时用 FB purchase_roas
 *   installs  → FB actions[app_install] 优先（实时）；为 0 时用 MB 首日UV
 *   cpi       → spend / installs（融合后计算）
 *   revenue   → Metabase 调整收入优先；为 0 时用 FB action_values
 *   payRate   → Metabase（唯一来源）
 *   arpu      → Metabase（唯一来源）
 *
 * 所有融合结果附带 lineage（来源追踪）和 conflictFlags（冲突标记）
 */
import dayjs from 'dayjs'
import type { CampaignMetrics } from '../analyzer'

export interface FieldLineage {
  field: string
  value: number
  source: 'facebook' | 'metabase' | 'calculated' | 'none'
  alt?: { source: string; value: number }
}

export interface FusedCampaign {
  campaignId: string
  campaignName: string
  accountId: string
  platform: string
  optimizer: string
  pkgName: string

  spend: number
  roas: number
  installs: number
  cpi: number
  revenue: number
  firstDayRoi: number
  adjustedRoi: number
  day3Roi: number
  payRate: number
  arpu: number

  status?: string
  dailyBudget?: number
  impressions?: number
  clicks?: number
  ctr?: number

  lineage: FieldLineage[]
  conflicts: string[]
  fusionSource: 'facebook_only' | 'metabase_only' | 'merged'
}

export interface SourceFreshness {
  source: 'facebook' | 'metabase' | 'toptou'
  freshnessSec: number
  status: 'fresh' | 'stale'
  recordCount: number
}

export interface FusionDiagnostics {
  totalCampaigns: number
  roasCoverage: number
  installCoverage: number
  spendConflicts: number
  roasConflicts: number
  fbOnlyCount: number
  mbOnlyCount: number
  mergedCount: number
}

export interface UnifiedCampaignSnapshot {
  snapshotId: string
  asOf: string
  sourcePriority: 'facebook_first'
  qualityScore: number
  dataRisk: boolean
  conflictFlags: string[]
  freshness: SourceFreshness[]
  campaigns: CampaignMetrics[]
  fusedCampaigns: FusedCampaign[]
  diagnostics: FusionDiagnostics
}

export interface FBSourceRecord {
  campaignId: string
  campaignName: string
  accountId: string
  accountName?: string
  status?: string
  dailyBudget?: number
  spend: number
  impressions: number
  clicks: number
  conversions: number
  roas: number
  revenue: number
  cpi: number
  ctr: number
  optimizer: string
  pkgName: string
  platform?: string
}

export interface MBSourceRecord {
  campaignId: string
  campaignName: string
  accountId: string
  platform: string
  optimizer: string
  pkgName: string
  spend: number
  installs: number
  cpi: number
  revenue: number
  firstDayRoi: number
  adjustedRoi: number
  day3Roi: number
  payRate: number
  arpu: number
  ctr: number
}

/**
 * 字段级融合：合并 FB + MB 数据为统一记录
 */
export function fuseRecords(
  fbRecords: FBSourceRecord[],
  mbRecords: MBSourceRecord[],
): { fused: FusedCampaign[]; diagnostics: FusionDiagnostics } {
  const fbMap = new Map<string, FBSourceRecord>()
  for (const fb of fbRecords) fbMap.set(fb.campaignId, fb)

  const mbMap = new Map<string, MBSourceRecord>()
  for (const mb of mbRecords) mbMap.set(mb.campaignId, mb)

  const allIds = new Set([...fbMap.keys(), ...mbMap.keys()])
  const fused: FusedCampaign[] = []
  let spendConflicts = 0, roasConflicts = 0
  let fbOnlyCount = 0, mbOnlyCount = 0, mergedCount = 0
  let roasCovered = 0, installCovered = 0

  for (const id of allIds) {
    const fb = fbMap.get(id)
    const mb = mbMap.get(id)
    const lineage: FieldLineage[] = []
    const conflicts: string[] = []

    let fusionSource: FusedCampaign['fusionSource'] = 'merged'
    if (fb && !mb) { fusionSource = 'facebook_only'; fbOnlyCount++ }
    else if (!fb && mb) { fusionSource = 'metabase_only'; mbOnlyCount++ }
    else { mergedCount++ }

    // ── spend: FB优先（实时性最高），为0时用MB ──
    let spend = 0
    if (fb && fb.spend > 0) {
      spend = fb.spend
      lineage.push({ field: 'spend', value: spend, source: 'facebook', alt: mb ? { source: 'metabase', value: mb.spend } : undefined })
      if (mb && mb.spend > 0 && Math.abs(fb.spend - mb.spend) / Math.max(fb.spend, mb.spend) > 0.3) {
        conflicts.push(`spend偏差${((Math.abs(fb.spend - mb.spend) / Math.max(fb.spend, mb.spend)) * 100).toFixed(0)}%: FB=$${fb.spend.toFixed(2)} MB=$${mb.spend.toFixed(2)}`)
        spendConflicts++
      }
    } else if (mb && mb.spend > 0) {
      spend = mb.spend
      lineage.push({ field: 'spend', value: spend, source: 'metabase' })
    }

    // ── roas: 用 MB 收入 / 融合花费（FB优先）重算，不直接用 MB 的 adjustedRoi ──
    // MB 的 adjustedRoi 是用 MB 自己的滞后花费算的，花费偏低时 ROAS 虚高
    let roas = 0
    let adjustedRoi = 0
    let firstDayRoi = 0
    const mbRevenue = mb?.revenue || 0

    if (mbRevenue > 0 && spend > 0) {
      roas = mbRevenue / spend
      adjustedRoi = roas
      firstDayRoi = roas
      lineage.push({ field: 'roas', value: roas, source: 'calculated',
        alt: mb ? { source: 'metabase_raw_roi', value: mb.adjustedRoi || 0 } : undefined })
      if (mb && mb.adjustedRoi > 0 && Math.abs(roas - mb.adjustedRoi) / Math.max(roas, mb.adjustedRoi) > 0.5) {
        conflicts.push(`roas重算: MB原始ROI=${mb.adjustedRoi.toFixed(2)}(MB花费$${mb.spend.toFixed(2)}) → 重算=${roas.toFixed(2)}(融合花费$${spend.toFixed(2)})`)
        roasConflicts++
      }
    } else if (fb && fb.roas > 0) {
      roas = fb.roas
      adjustedRoi = roas
      lineage.push({ field: 'roas', value: roas, source: 'facebook' })
    } else if (mb && (mb.adjustedRoi > 0 || mb.firstDayRoi > 0)) {
      adjustedRoi = mb.adjustedRoi || 0
      firstDayRoi = mb.firstDayRoi || 0
      roas = adjustedRoi > 0 ? adjustedRoi : firstDayRoi
      lineage.push({ field: 'roas', value: roas, source: 'metabase' })
    }
    if (roas > 0) roasCovered++

    // ── installs: FB优先（实时），为0时用MB首日UV ──
    let installs = 0
    if (fb && fb.conversions > 0) {
      installs = fb.conversions
      lineage.push({ field: 'installs', value: installs, source: 'facebook', alt: mb ? { source: 'metabase', value: mb.installs } : undefined })
    } else if (mb && mb.installs > 0) {
      installs = mb.installs
      lineage.push({ field: 'installs', value: installs, source: 'metabase' })
    }
    if (installs > 0) installCovered++

    // ── revenue: MB优先（后端归因），为0时用FB ──
    let revenue = 0
    if (mb && mb.revenue > 0) {
      revenue = mb.revenue
      lineage.push({ field: 'revenue', value: revenue, source: 'metabase' })
    } else if (fb && fb.revenue > 0) {
      revenue = fb.revenue
      lineage.push({ field: 'revenue', value: revenue, source: 'facebook' })
    }

    // ── cpi: 融合后计算 ──
    const cpi = installs > 0 ? spend / installs : (mb?.cpi || 0)
    lineage.push({ field: 'cpi', value: cpi, source: 'calculated' })

    // ── 仅MB来源字段 ──
    const payRate = mb?.payRate || 0
    const arpu = mb?.arpu || 0
    const day3Roi = mb?.day3Roi || 0

    fused.push({
      campaignId: id,
      campaignName: fb?.campaignName || mb?.campaignName || '',
      accountId: fb?.accountId || mb?.accountId || '',
      platform: fb?.platform || mb?.platform || 'FB',
      optimizer: fb?.optimizer || mb?.optimizer || '',
      pkgName: fb?.pkgName || mb?.pkgName || '',
      spend,
      roas,
      installs,
      cpi,
      revenue,
      firstDayRoi,
      adjustedRoi,
      day3Roi,
      payRate,
      arpu,
      status: fb?.status,
      dailyBudget: fb?.dailyBudget,
      impressions: fb?.impressions,
      clicks: fb?.clicks,
      ctr: fb?.ctr || mb?.ctr || 0,
      lineage,
      conflicts,
      fusionSource,
    })
  }

  fused.sort((a, b) => b.spend - a.spend)

  return {
    fused,
    diagnostics: {
      totalCampaigns: fused.length,
      roasCoverage: fused.length > 0 ? Math.round((roasCovered / fused.length) * 100) : 0,
      installCoverage: fused.length > 0 ? Math.round((installCovered / fused.length) * 100) : 0,
      spendConflicts,
      roasConflicts,
      fbOnlyCount,
      mbOnlyCount,
      mergedCount,
    },
  }
}

/**
 * 从融合结果构建统一快照（供 Brain / AutoPilot 共用）
 */
export function buildUnifiedSnapshot(
  fused: FusedCampaign[],
  diagnostics: FusionDiagnostics,
  snapshotId: string,
  fbFreshnessSec = 90,
  mbFreshnessSec = 600,
): UnifiedCampaignSnapshot {
  const now = dayjs()

  const totalConflicts = fused.reduce((s, c) => s + c.conflicts.length, 0)
  const globalConflictFlags: string[] = []
  if (diagnostics.spendConflicts > 0) globalConflictFlags.push(`${diagnostics.spendConflicts} 条花费跨源偏差>30%`)
  if (diagnostics.roasConflicts > 0) globalConflictFlags.push(`${diagnostics.roasConflicts} 条ROAS跨源偏差>0.5`)
  if (diagnostics.roasCoverage < 30) globalConflictFlags.push(`ROAS覆盖率仅${diagnostics.roasCoverage}%，后端归因可能延迟`)

  const dataRisk = totalConflicts >= 3 || diagnostics.roasCoverage < 20

  const coverage = fused.length > 0 ? 1 : 0
  const staleCount = mbFreshnessSec > 1800 ? 1 : 0
  const qualityScore = Number(Math.max(0, Math.min(1,
    0.3 * coverage
    + 0.3 * (1 - staleCount / 3)
    + 0.2 * (diagnostics.roasCoverage / 100)
    + 0.2 * (1 - Math.min(totalConflicts, 10) / 10)
  )).toFixed(2))

  const campaigns: CampaignMetrics[] = fused.map(f => ({
    campaignId: f.campaignId,
    campaignName: f.campaignName,
    accountId: f.accountId,
    accountName: '',
    platform: f.platform,
    optimizer: f.optimizer,
    pkgName: f.pkgName,
    todaySpend: f.spend,
    todayRevenue: f.revenue,
    todayRoas: f.roas,
    todayImpressions: f.impressions || 0,
    todayClicks: f.clicks || 0,
    todayConversions: f.installs,
    yesterdaySpend: 0,
    yesterdayRoas: 0,
    dayBeforeSpend: 0,
    dayBeforeRoas: 0,
    spendTrend: 0,
    roasTrend: 0,
    totalSpend3d: f.spend,
    totalRevenue3d: f.revenue,
    avgRoas3d: f.roas,
    estimatedDailySpend: f.spend,
    spendPerHour: 0,
    installs: f.installs,
    cpi: f.cpi,
    cpa: 0,
    firstDayRoi: f.firstDayRoi,
    adjustedRoi: f.adjustedRoi,
    day3Roi: f.day3Roi,
    day7Roi: 0,
    payRate: f.payRate,
    arpu: f.arpu,
    trendSummary: '',
    dailyData: [],
  }))

  return {
    snapshotId,
    asOf: now.toISOString(),
    sourcePriority: 'facebook_first',
    qualityScore,
    dataRisk,
    conflictFlags: globalConflictFlags,
    freshness: [
      { source: 'facebook', freshnessSec: fbFreshnessSec, status: fbFreshnessSec < 300 ? 'fresh' : 'stale', recordCount: diagnostics.fbOnlyCount + diagnostics.mergedCount },
      { source: 'metabase', freshnessSec: mbFreshnessSec, status: mbFreshnessSec < 1800 ? 'fresh' : 'stale', recordCount: diagnostics.mbOnlyCount + diagnostics.mergedCount },
      { source: 'toptou', freshnessSec: 0, status: 'stale', recordCount: 0 },
    ],
    campaigns,
    fusedCampaigns: fused,
    diagnostics,
  }
}

// Re-export old API name for backward compatibility
export function buildUnifiedCampaignSnapshot(campaigns: CampaignMetrics[], snapshotId: string): UnifiedCampaignSnapshot {
  const fused: FusedCampaign[] = campaigns.map(c => ({
    campaignId: c.campaignId,
    campaignName: c.campaignName,
    accountId: c.accountId,
    platform: c.platform,
    optimizer: c.optimizer,
    pkgName: c.pkgName,
    spend: c.todaySpend,
    roas: c.adjustedRoi || c.todayRoas || 0,
    installs: c.installs,
    cpi: c.cpi,
    revenue: c.todayRevenue,
    firstDayRoi: c.firstDayRoi,
    adjustedRoi: c.adjustedRoi,
    day3Roi: c.day3Roi,
    payRate: c.payRate,
    arpu: c.arpu,
    lineage: [],
    conflicts: [],
    fusionSource: 'merged',
  }))
  const diag: FusionDiagnostics = {
    totalCampaigns: fused.length, roasCoverage: 0, installCoverage: 0,
    spendConflicts: 0, roasConflicts: 0, fbOnlyCount: 0, mbOnlyCount: 0, mergedCount: fused.length,
  }
  return buildUnifiedSnapshot(fused, diag, snapshotId)
}
