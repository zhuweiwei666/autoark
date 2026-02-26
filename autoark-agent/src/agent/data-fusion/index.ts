import dayjs from 'dayjs'
import type { CampaignMetrics } from '../analyzer'

export interface SourceFreshness {
  source: 'facebook' | 'metabase' | 'toptou'
  freshnessSec: number
  status: 'fresh' | 'stale'
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
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function buildUnifiedCampaignSnapshot(
  campaigns: CampaignMetrics[],
  snapshotId: string,
): UnifiedCampaignSnapshot {
  const now = dayjs()
  const freshness: SourceFreshness[] = [
    { source: 'facebook', freshnessSec: 90, status: 'fresh' },
    { source: 'metabase', freshnessSec: 600, status: 'fresh' },
    { source: 'toptou', freshnessSec: 300, status: 'fresh' },
  ]

  const conflictFlags: string[] = []
  let suspiciousCount = 0
  for (const c of campaigns) {
    const roi = c.adjustedRoi || c.firstDayRoi || c.todayRoas || 0
    if (c.todaySpend > 30 && roi <= 0 && c.installs > 10) {
      suspiciousCount++
    }
    if (c.todaySpend > 1000 && c.todayRoas > 5) {
      suspiciousCount++
    }
  }
  if (suspiciousCount > 0) {
    conflictFlags.push(`检测到 ${suspiciousCount} 条潜在跨源口径冲突记录`)
  }
  const dataRisk = suspiciousCount >= 3

  const staleCount = freshness.filter(f => f.status === 'stale').length
  const coverage = campaigns.length > 0 ? 1 : 0
  const qualityScore = clamp(
    Number((0.5 * coverage + 0.3 * (1 - staleCount / freshness.length) + 0.2 * (1 - suspiciousCount / Math.max(campaigns.length, 1))).toFixed(2)),
    0,
    1,
  )

  return {
    snapshotId,
    asOf: now.toISOString(),
    sourcePriority: 'facebook_first',
    qualityScore,
    dataRisk,
    conflictFlags,
    freshness,
    campaigns,
  }
}
