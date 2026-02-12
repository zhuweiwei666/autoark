/**
 * 多维度趋势引擎
 *
 * 从时序数据中，对 spend / roi / installs / cpi / revenue 五个维度
 * 分别计算：当前值、1h/3h/昨天 对比、线性回归斜率、趋势分类
 * 并生成自然语言趋势摘要（直接注入 LLM prompt）
 */
import dayjs from 'dayjs'
import { TrendLabel, MetricTrend, CampaignTrends } from './types'

/** 时序数据点（从 MongoDB 查出来的） */
interface Sample {
  sampledAt: Date
  spend: number
  spendRate: number
  installs: number
  revenue: number
  roi: number
  cpi: number
  cpa: number
  confidence: number
}

// ==================== 核心 API ====================

/**
 * 构建一个 campaign 的完整多维度趋势
 * @param history     最近 24h 采样（时间倒序，最新在前）
 * @param yesterday   昨天同时段附近的采样（用于 vsYesterday 对比）
 */
export function buildCampaignTrends(
  history: Sample[],
  yesterday: Sample | null,
): CampaignTrends {
  const latest = history[0] || null
  const dataPoints = history.length

  // 对每个维度分别算趋势
  const spend = calcMetricTrend(history, 'spend', latest?.spend ?? 0, yesterday?.spend ?? null)
  const roi = calcMetricTrend(history, 'roi', latest?.roi ?? 0, yesterday?.roi ?? null)
  const installs = calcMetricTrend(history, 'installs', latest?.installs ?? 0, yesterday?.installs ?? null)
  const cpi = calcMetricTrend(history, 'cpi', latest?.cpi ?? 0, yesterday?.cpi ?? null)
  const revenue = calcMetricTrend(history, 'revenue', latest?.revenue ?? 0, yesterday?.revenue ?? null)

  return {
    spend,
    roi,
    installs,
    cpi,
    revenue,
    dataPoints,
    dataQuality: latest?.confidence ?? 0,
  }
}

/**
 * 生成自然语言趋势摘要（给 LLM 看）
 */
export function describeTrends(t: CampaignTrends): string {
  if (t.dataPoints < 2) return '数据不足，暂无趋势'

  const lines: string[] = []

  lines.push(describeMetric('花费', t.spend, '$'))
  lines.push(describeMetric('ROI', t.roi, '', 2))
  lines.push(describeMetric('安装', t.installs, '', 0))
  lines.push(describeMetric('CPI', t.cpi, '$'))
  lines.push(describeMetric('收入', t.revenue, '$'))

  // 综合信号
  const signal = diagnoseSignal(t)
  if (signal) lines.push(`信号: ${signal}`)

  return lines.join('\n')
}

/**
 * 兼容旧接口：calculateTrend / calculateSpendTrend
 */
export function calculateTrend(samples: Sample[]) {
  const roi = calcMetricTrend(samples, 'roi', samples[0]?.roi ?? 0, null)
  const values = samples.filter(s => s.spend > 0).map(s => s.roi)
  return {
    trend: roi.label,
    slope: roi.slope,
    acceleration: values.length >= 4 ? calcAcceleration(values) : 0,
    volatility: values.length >= 2 ? stdDev(values) : 0,
    confidence: Math.min(1, values.length / 8),
    dataPoints: values.length,
  }
}

export function calculateSpendTrend(samples: Sample[]) {
  const valid = samples.filter(s => s.spendRate > 0)
  if (valid.length < 2) return { rate: 0, predicted24h: 0 }
  const recent = valid.slice(0, 3)
  const avgRate = recent.reduce((s, p) => s + p.spendRate, 0) / recent.length
  return { rate: round(avgRate), predicted24h: round(avgRate * 24) }
}

// ==================== 单指标趋势计算 ====================

function calcMetricTrend(
  history: Sample[],
  key: keyof Sample,
  currentValue: number,
  yesterdayValue: number | null,
): MetricTrend {
  const now = dayjs()

  // 找 1h 前、3h 前的采样
  const prev1h = findSampleNear(history, now.subtract(1, 'hour').toDate())
  const prev3h = findSampleNear(history, now.subtract(3, 'hour').toDate())

  const prev1hVal = prev1h ? Number(prev1h[key]) || 0 : null
  const prev3hVal = prev3h ? Number(prev3h[key]) || 0 : null

  // 变化率
  const changeRate1h = calcChangeRate(currentValue, prev1hVal)
  const changeRate3h = calcChangeRate(currentValue, prev3hVal)
  const changeRateVsYesterday = calcChangeRate(currentValue, yesterdayValue)

  // 线性回归斜率（用最近有效数据点）
  const values = history.filter(s => s.spend > 0).map(s => Number(s[key]) || 0)
  const slope = values.length >= 3 ? linearRegression(values) : 0

  // 分类
  const label = classifyTrend(slope, currentValue, prev3hVal, yesterdayValue, values)

  return {
    current: round(currentValue),
    prev1h: prev1hVal !== null ? round(prev1hVal) : null,
    prev3h: prev3hVal !== null ? round(prev3hVal) : null,
    prevYesterday: yesterdayValue !== null ? round(yesterdayValue) : null,
    changeRate1h: round(changeRate1h),
    changeRate3h: round(changeRate3h),
    changeRateVsYesterday: round(changeRateVsYesterday),
    slope: round(slope),
    label,
  }
}

// ==================== 自然语言生成 ====================

function describeMetric(name: string, m: MetricTrend, prefix = '', decimals = 1): string {
  const arrow = m.label === 'rising' || m.label === 'recovering' ? '↑'
    : m.label === 'declining' || m.label === 'crashing' ? '↓'
    : '→'

  const fmt = (v: number | null) => v === null ? '?' : `${prefix}${v.toFixed(decimals)}`

  // 主变化（优先用 3h，没有用 1h）
  const refVal = m.prev3h ?? m.prev1h
  const refRate = m.prev3h !== null ? m.changeRate3h : m.changeRate1h
  const refWindow = m.prev3h !== null ? '3h' : '1h'

  let main = `${arrow} ${fmt(m.current)}`
  if (refVal !== null && refVal !== 0) {
    const sign = refRate >= 0 ? '+' : ''
    main += ` (${fmt(refVal)}→${fmt(m.current)}, ${sign}${refRate.toFixed(0)}%/${refWindow})`
  }

  // vs 昨天
  if (m.prevYesterday !== null && m.prevYesterday !== 0) {
    const sign = m.changeRateVsYesterday >= 0 ? '+' : ''
    main += `, vs昨天 ${sign}${m.changeRateVsYesterday.toFixed(0)}%`
  }

  return `${name}: ${main}`
}

function diagnoseSignal(t: CampaignTrends): string {
  const signals: string[] = []

  // 花费升 + ROI 降 = 效果衰退
  if (t.spend.label === 'rising' && (t.roi.label === 'declining' || t.roi.label === 'crashing')) {
    signals.push('花费加速但效果衰退，建议降预算')
  }

  // ROI 暴跌
  if (t.roi.label === 'crashing') {
    signals.push('ROI 暴跌，建议立即关注')
  }

  // ROI 上升 + 花费稳定 = 效果回暖
  if ((t.roi.label === 'rising' || t.roi.label === 'recovering') && t.spend.label !== 'declining') {
    signals.push('效果回暖，可观察或加量')
  }

  // CPI 飙升 = 获客成本失控
  if (t.cpi.changeRate3h > 30) {
    signals.push(`CPI 3h 涨 ${t.cpi.changeRate3h.toFixed(0)}%，获客成本上升`)
  }

  // 安装量骤降但花费没降 = 可能广告疲劳
  if (t.installs.changeRate3h < -30 && t.spend.changeRate3h > -10) {
    signals.push('安装骤降但花费未减，可能广告疲劳或受众饱和')
  }

  // vs 昨天大幅恶化
  if (t.roi.changeRateVsYesterday < -30 && t.roi.prevYesterday !== null) {
    signals.push(`ROI 比昨天同时段低 ${Math.abs(t.roi.changeRateVsYesterday).toFixed(0)}%`)
  }

  return signals.join('；')
}

// ==================== 工具函数 ====================

/** 在时序数据中找最接近目标时间的采样（15 分钟容差） */
function findSampleNear(history: Sample[], target: Date): Sample | null {
  const targetMs = target.getTime()
  const tolerance = 15 * 60 * 1000  // 15 分钟
  let best: Sample | null = null
  let bestDist = Infinity

  for (const s of history) {
    const dist = Math.abs(s.sampledAt.getTime() - targetMs)
    if (dist < bestDist && dist < tolerance) {
      best = s
      bestDist = dist
    }
  }
  return best
}

/** 计算变化率 (%) */
function calcChangeRate(current: number, prev: number | null): number {
  if (prev === null || prev === 0) return 0
  return (current - prev) / Math.abs(prev) * 100
}

/** 线性回归求斜率（数据从新到旧排列，index 越大越老） */
function linearRegression(values: number[]): number {
  const n = values.length
  if (n < 2) return 0
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += values[i]; sumXY += i * values[i]; sumX2 += i * i
  }
  const denom = n * sumX2 - sumX * sumX
  return denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0
}

function calcAcceleration(values: number[]): number {
  if (values.length < 4) return 0
  const mid = Math.floor(values.length / 2)
  return linearRegression(values.slice(mid)) - linearRegression(values.slice(0, mid))
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function classifyTrend(
  slope: number,
  current: number,
  prev3h: number | null,
  yesterday: number | null,
  values: number[],
): TrendLabel {
  if (values.length < 3) return 'insufficient_data'

  const recent = values.slice(0, 3)
  const older = values.slice(-3)
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length
  const olderAvg = older.length > 0 ? older.reduce((a, b) => a + b, 0) / older.length : recentAvg

  // 暴跌：最近值比历史值低很多 + 下降斜率大
  if (slope < -0.1 && olderAvg > 0 && recentAvg < olderAvg * 0.5) return 'crashing'

  // 恢复：之前低现在高
  if (olderAvg > 0 && recentAvg > olderAvg * 1.5 && slope > 0.05) return 'recovering'

  if (slope > 0.05) return 'rising'
  if (slope < -0.05) return 'declining'
  return 'stable'
}

function round(n: number, d = 2): number {
  return Number(n.toFixed(d))
}
