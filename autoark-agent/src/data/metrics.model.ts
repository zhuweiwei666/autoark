import mongoose from 'mongoose'

/**
 * 极简指标模型 - 只存 Agent 做趋势分析需要的字段
 */
const metricsSchema = new mongoose.Schema({
  date: { type: String, required: true },     // YYYY-MM-DD
  platform: { type: String, enum: ['facebook', 'tiktok'], default: 'facebook' },
  accountId: { type: String, required: true },
  campaignId: String,
  campaignName: String,
  adsetId: String,
  adId: String,
  country: String,
  // 核心指标
  spend: { type: Number, default: 0 },
  revenue: { type: Number, default: 0 },       // purchase_value
  impressions: { type: Number, default: 0 },
  clicks: { type: Number, default: 0 },
  conversions: { type: Number, default: 0 },
  installs: { type: Number, default: 0 },
  // 派生指标（同步时计算好，避免查询时算）
  roas: Number,
  ctr: Number,
  cpm: Number,
  cpc: Number,
  cpa: Number,
}, { timestamps: true })

metricsSchema.index({ date: 1, accountId: 1, campaignId: 1 }, { unique: true, partialFilterExpression: { campaignId: { $exists: true } } })
metricsSchema.index({ date: 1, accountId: 1 })
metricsSchema.index({ campaignId: 1, date: 1 })

export const Metrics = mongoose.model('Metrics', metricsSchema)
