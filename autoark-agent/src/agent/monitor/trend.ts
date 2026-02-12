/**
 * 趋势计算引擎 — 从时序数据中提取趋势、加速度、波动
 */
import { TrendResult, TrendLabel } from './types'

interface Point { sampledAt: Date; roi: number; spend: number; spendRate: number }

/**
 * 计算一个 campaign 的趋势
 */
export function calculateTrend(samples: Point[]): TrendResult {
  // 过滤掉无效数据
  const valid = samples.filter(s => s.spend > 0)

  if (valid.length < 3) {
    return { trend: 'insufficient_data', slope: 0, acceleration: 0, volatility: 0, confidence: 0, dataPoints: valid.length }
  }

  const values = valid.map(s => s.roi)

  // 线性回归求斜率（ROI 随时间的变化率）
  const slope = linearRegression(values)

  // 加速度（斜率的变化率）
  const acceleration = calcAcceleration(values)

  // 波动性（标准差）
  const volatility = stdDev(values)

  // 分类
  const trend = classifyTrend(slope, volatility, values)

  // 置信度（数据点越多、波动越小越可信）
  let confidence = Math.min(1, valid.length / 8)
  if (volatility > 0.5) confidence *= 0.7  // 高波动降低置信度

  return {
    trend,
    slope: round(slope),
    acceleration: round(acceleration),
    volatility: round(volatility),
    confidence: round(confidence),
    dataPoints: valid.length,
  }
}

/**
 * 计算花费趋势（用于预测日花费）
 */
export function calculateSpendTrend(samples: Point[]): { rate: number; predicted24h: number } {
  const valid = samples.filter(s => s.spendRate > 0)
  if (valid.length < 2) return { rate: 0, predicted24h: 0 }

  // 最近 3 个采样的平均花费速率
  const recent = valid.slice(0, 3)
  const avgRate = recent.reduce((s, p) => s + p.spendRate, 0) / recent.length

  return {
    rate: round(avgRate),
    predicted24h: round(avgRate * 24),
  }
}

// ==================== 数学工具 ====================

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
  // 前半段斜率 vs 后半段斜率
  const mid = Math.floor(values.length / 2)
  const firstHalf = linearRegression(values.slice(0, mid))
  const secondHalf = linearRegression(values.slice(mid))
  return secondHalf - firstHalf
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function classifyTrend(slope: number, volatility: number, values: number[]): TrendLabel {
  const recent = values.slice(0, 3)
  const older = values.slice(-3)
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length
  const olderAvg = older.length > 0 ? older.reduce((a, b) => a + b, 0) / older.length : recentAvg

  // 暴跌：最近值比历史值低很多 + 下降斜率大
  if (slope < -0.1 && recentAvg < olderAvg * 0.5) return 'crashing'

  // 恢复：之前低现在高
  if (olderAvg > 0 && recentAvg > olderAvg * 1.5 && slope > 0.05) return 'recovering'

  // 正常趋势判断
  if (slope > 0.05) return 'rising'
  if (slope < -0.05) return 'declining'
  return 'stable'
}

function round(n: number, d = 3): number {
  return Number(n.toFixed(d))
}
