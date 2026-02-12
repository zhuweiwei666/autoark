/**
 * 时序数据模型 — 每次采样存一条，保留 7 天
 */
import mongoose from 'mongoose'

const timeseriesSchema = new mongoose.Schema({
  campaignId: { type: String, required: true, index: true },
  sampledAt: { type: Date, required: true, index: true },
  // 花费
  spend: { type: Number, default: 0 },
  spendRate: { type: Number, default: 0 },  // $/hour
  // 转化
  installs: { type: Number, default: 0 },
  revenue: { type: Number, default: 0 },
  roi: { type: Number, default: 0 },       // 最佳可用 ROI
  firstDayRoi: { type: Number, default: 0 },
  adjustedRoi: { type: Number, default: 0 },
  // 质量
  confidence: { type: Number, default: 1 },
  dataNote: { type: String, default: '' },
}, { timestamps: false })

// 复合索引 + TTL（7 天自动删除）
timeseriesSchema.index({ campaignId: 1, sampledAt: -1 })
timeseriesSchema.index({ sampledAt: 1 }, { expireAfterSeconds: 7 * 86400 })

export const TimeSeries = mongoose.model('MonitorTimeSeries', timeseriesSchema)
