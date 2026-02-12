/**
 * 监控 Agent 输出类型 — 给决策 Agent 的"决策依据"
 */

export type TrendLabel = 'rising' | 'stable' | 'declining' | 'crashing' | 'recovering' | 'insufficient_data'

export interface AnomalyResult {
  type: 'spend_spike' | 'roas_crash' | 'zero_conversion' | 'underperforming_vs_peers' | 'account_wide_decline' | 'budget_exhausting'
  severity: number    // 1-5, 5=最严重
  message: string
}

// ==================== 多维度趋势类型 ====================

/** 单指标趋势 */
export interface MetricTrend {
  current: number                  // 当前值
  prev1h: number | null            // 1 小时前的值
  prev3h: number | null            // 3 小时前的值
  prevYesterday: number | null     // 昨天同时段的值
  changeRate1h: number             // 1h 变化率 (%, +20 = 涨了 20%)
  changeRate3h: number             // 3h 变化率
  changeRateVsYesterday: number    // vs 昨天变化率
  slope: number                    // 线性回归斜率（每采样周期变化量）
  label: TrendLabel                // 趋势分类
}

/** Campaign 完整趋势（多维度） */
export interface CampaignTrends {
  spend: MetricTrend       // 花费趋势
  roi: MetricTrend         // ROI 趋势
  installs: MetricTrend    // 安装趋势
  cpi: MetricTrend         // CPI 趋势
  revenue: MetricTrend     // 收入趋势
  dataPoints: number       // 时序数据点数
  dataQuality: number      // 数据可信度 0-1
}

// ==================== 兼容旧接口 ====================

export interface TrendResult {
  trend: TrendLabel
  slope: number
  acceleration: number
  volatility: number
  confidence: number
  dataPoints: number
}

export interface QualityResult {
  confidence: number
  notes: string[]
  reliable: boolean
}

// ==================== 决策就绪数据 ====================

export interface CampaignDecisionData {
  id: string
  name: string
  platform: string
  optimizer: string
  pkgName: string

  // 当前数据
  spend: number
  roi: number
  installs: number
  cpi: number
  revenue: number

  // 数据质量
  confidence: number
  dataNote: string
  reliable: boolean

  // 多维度趋势（新）
  trends: CampaignTrends
  trendSummary: string          // 自然语言趋势摘要（直接给 LLM）

  // 兼容旧字段
  trend: TrendLabel
  trendSlope: number
  trendAcceleration: number
  volatility: number

  // 历史对比
  vsYesterday: string
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
