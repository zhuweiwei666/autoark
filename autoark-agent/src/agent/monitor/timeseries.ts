/**
 * 时序数据管理 — 存储全维度指标快照，供趋势分析使用
 */
import dayjs from 'dayjs'
import { TimeSeries } from './timeseries.model'
import { RawCampaign } from './data-collector'
import { QualityResult } from './types'
import { log } from '../../platform/logger'

/**
 * 存储一批采样数据（全维度）
 */
export async function storeSamples(
  campaigns: RawCampaign[],
  qualities: Map<string, QualityResult>,
): Promise<void> {
  const now = new Date()
  const hour = dayjs().hour() + dayjs().minute() / 60

  const docs = campaigns.map(c => {
    const q = qualities.get(c.campaignId)
    const roi = c.adjustedRoi || c.firstDayRoi || 0
    return {
      campaignId: c.campaignId,
      sampledAt: now,
      // 花费
      spend: c.spend,
      spendRate: hour > 0.5 ? Math.round(c.spend / hour * 100) / 100 : 0,
      // 转化
      installs: c.installs,
      revenue: c.revenue,
      // ROI
      roi,
      firstDayRoi: c.firstDayRoi,
      adjustedRoi: c.adjustedRoi,
      // 效率指标
      cpi: c.cpi,
      cpa: c.cpa,
      payRate: c.payRate,
      arpu: c.arpu,
      ctr: c.ctr,
      // 质量
      confidence: q?.confidence || 1,
      dataNote: q?.notes?.join('; ') || '',
    }
  })

  try {
    await TimeSeries.insertMany(docs, { ordered: false })
    log.info(`[TimeSeries] Stored ${docs.length} samples`)
  } catch (e: any) {
    log.warn(`[TimeSeries] Store failed: ${e.message}`)
  }
}

/**
 * 获取某个 campaign 最近 N 条采样（按时间倒序）
 */
export async function getRecentSamples(campaignId: string, limit = 12): Promise<any[]> {
  return TimeSeries.find({ campaignId })
    .sort({ sampledAt: -1 })
    .limit(limit)
    .lean()
}

/**
 * 获取某个 campaign 过去 N 小时的采样
 */
export async function getSamplesInWindow(campaignId: string, hours = 24): Promise<any[]> {
  const since = dayjs().subtract(hours, 'hour').toDate()
  return TimeSeries.find({ campaignId, sampledAt: { $gte: since } })
    .sort({ sampledAt: 1 })
    .lean()
}

/**
 * 获取全局上一次采样的时间戳
 */
export async function getLastSampleTime(): Promise<Date | null> {
  const last = await TimeSeries.findOne().sort({ sampledAt: -1 }).lean() as any
  return last?.sampledAt || null
}
