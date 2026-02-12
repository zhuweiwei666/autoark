/**
 * 监控 Agent 输出类型 — 给决策 Agent 的"决策依据"
 */

export type TrendLabel = 'rising' | 'stable' | 'declining' | 'crashing' | 'recovering' | 'insufficient_data'

export interface AnomalyResult {
  type: 'spend_spike' | 'roas_crash' | 'zero_conversion' | 'underperforming_vs_peers' | 'account_wide_decline' | 'budget_exhausting'
  severity: number    // 1-5, 5=最严重
  message: string
}

export interface TrendResult {
  trend: TrendLabel
  slope: number             // 每小时变化率（正=上升）
  acceleration: number      // 加速度（正=变化在加快）
  volatility: number        // 波动性（标准差）
  confidence: number        // 趋势判断的置信度 0-1
  dataPoints: number        // 用了多少个数据点
}

export interface QualityResult {
  confidence: number        // 0-1 数据可信度
  notes: string[]           // 质量问题说明
  reliable: boolean         // confidence > 0.5
}

export interface CampaignDecisionData {
  id: string
  name: string
  platform: string
  optimizer: string
  pkgName: string

  // 当前数据
  spend: number
  roi: number               // 优先用 adjustedRoi, 没有用 firstDayRoi
  installs: number
  cpi: number
  revenue: number

  // 数据质量
  confidence: number
  dataNote: string
  reliable: boolean

  // 趋势
  trend: TrendLabel
  trendSlope: number
  trendAcceleration: number
  volatility: number

  // 历史对比
  vsYesterday: string       // "+20%" / "-30%" / "N/A"
  vs3dayAvg: string

  // 异常
  anomalies: AnomalyResult[]

  // 预测
  estimatedDailySpend: number
  estimatedDailyRoi: number

  // 原始转化指标
  firstDayRoi: number
  adjustedRoi: number
  day3Roi: number
  payRate: number
  arpu: number
}

export interface DataQualitySummary {
  overallConfidence: number
  reliableCount: number
  unreliableCount: number
  totalCount: number
  note: string
}

export interface DecisionReadyData {
  campaigns: CampaignDecisionData[]
  environment: string
  dataQuality: DataQualitySummary
  sampledAt: Date
}
