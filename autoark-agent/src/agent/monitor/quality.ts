/**
 * 数据质量评估器 — 给每个 campaign 一个可信度评分
 */
import dayjs from 'dayjs'
import { RawCampaign } from './data-collector'
import { QualityResult, DataQualitySummary } from './types'
import { TimeSeries } from './timeseries.model'

/**
 * 评估单个 campaign 的数据质量
 */
export async function assessQuality(
  campaign: RawCampaign,
  hour: number,
): Promise<QualityResult> {
  let confidence = 1.0
  const notes: string[] = []

  // 1. 花费太少 → 指标波动大
  if (campaign.spend < 5) {
    confidence *= 0.2
    notes.push('花费<$5，数据极不可靠')
  } else if (campaign.spend < 10) {
    confidence *= 0.4
    notes.push('花费<$10，指标波动大')
  } else if (campaign.spend < 30) {
    confidence *= 0.7
    notes.push('花费<$30，数据量有限')
  }

  // 2. 时间因素
  if (hour < 4) {
    confidence *= 0.15
    notes.push('凌晨0-4点，数据覆盖<17%')
  } else if (hour < 8) {
    confidence *= 0.4
    notes.push('早间数据，覆盖<33%')
  } else if (hour < 12) {
    confidence *= 0.7
    notes.push('上午数据，覆盖约50%')
  }
  // 12点后 confidence 不衰减

  // 3. 花费有但转化为零 → 可能归因延迟
  if (campaign.spend > 30 && campaign.installs === 0 && campaign.revenue === 0 && campaign.firstDayRoi === 0) {
    confidence *= 0.5
    notes.push('有花费无转化，可能归因延迟2-4h')
  }

  // 4. 和上次采样对比跳变
  try {
    const lastSample = await TimeSeries.findOne({ campaignId: campaign.campaignId })
      .sort({ sampledAt: -1 }).lean() as any
    if (lastSample && lastSample.spend > 10) {
      const spendJump = Math.abs(campaign.spend - lastSample.spend) / lastSample.spend
      if (spendJump > 3) {
        confidence *= 0.6
        notes.push(`花费跳变 ${(spendJump * 100).toFixed(0)}%，可能是数据刷新`)
      }
    }
  } catch { /* 首次运行没有历史数据 */ }

  // 5. ROI 异常高（可能是小样本偶然）
  const roi = campaign.adjustedRoi || campaign.firstDayRoi
  if (roi > 10 && campaign.spend < 50) {
    confidence *= 0.5
    notes.push(`ROI ${roi} 异常高但花费仅 $${campaign.spend}，小样本偶然`)
  }

  if (notes.length === 0) notes.push('数据正常')

  return {
    confidence: Math.max(0.05, Math.round(confidence * 100) / 100),
    notes,
    reliable: confidence > 0.5,
  }
}

/**
 * 汇总所有 campaign 的数据质量
 */
export function summarizeQuality(qualities: Map<string, QualityResult>, total: number): DataQualitySummary {
  let sumConf = 0, reliable = 0, unreliable = 0
  for (const q of qualities.values()) {
    sumConf += q.confidence
    if (q.reliable) reliable++; else unreliable++
  }

  const avg = qualities.size > 0 ? sumConf / qualities.size : 0
  const hour = dayjs().hour()
  let note = '数据质量正常'
  if (avg < 0.3) note = '当前时段数据覆盖率低，建议等数据更完整后再做决策'
  else if (avg < 0.6) note = '部分 campaign 数据量不足，决策需谨慎'
  else if (unreliable > reliable) note = `${unreliable} 个 campaign 数据不可靠，仅 ${reliable} 个可靠`

  return {
    overallConfidence: Math.round(avg * 100) / 100,
    reliableCount: reliable,
    unreliableCount: unreliable,
    totalCount: total,
    note,
  }
}
