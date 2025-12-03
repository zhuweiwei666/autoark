import mongoose from 'mongoose'

/**
 * Raw Insights 模型
 * 存储从 Facebook API 获取的原始 Insights 数据（Ad 级别）
 * 用于：
 * - 数据回溯和修正
 * - 聚合逻辑变更时重新计算
 * - AI 学习和策略生成
 * - Facebook API bug 回溯
 */
const rawInsightsSchema = new mongoose.Schema(
  {
    // 标识字段
    date: { type: String, required: true }, // YYYY-MM-DD
    datePreset: { type: String }, // 'today', 'yesterday', 'last_3d', 'last_7d'
    channel: { type: String, default: 'facebook' },
    accountId: String,
    campaignId: String,
    adsetId: String,
    adId: { type: String, required: true }, // Ad 级别数据，必须有 adId
    country: String, // 国家代码（从 breakdowns 获取）

    // 原始 Facebook API 响应数据（完整保存）
    raw: { type: mongoose.Schema.Types.Mixed, required: true },

    // 提取的基础字段（便于查询和索引）
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    spend: { type: Number, default: 0 },
    reach: { type: Number, default: 0 },
    frequency: { type: Number, default: 0 },

    // 成本指标
    cpc: Number,
    ctr: Number,
    cpm: Number,
    cpp: Number,

    // 转化数据（原始数组）
    actions: mongoose.Schema.Types.Mixed, // Array of {action_type, value}
    action_values: mongoose.Schema.Types.Mixed, // Array of {action_type, value}
    purchase_roas: mongoose.Schema.Types.Mixed, // Array or single value

    // 提取的 purchase 相关数据
    purchase_value: Number,
    purchase_count: Number,
    mobile_app_install_count: Number,

    // 元数据
    tokenId: String, // 使用的 token ID
    syncedAt: { type: Date, default: Date.now }, // 同步时间
  },
  { timestamps: true }
)

// 唯一索引：adId + date + country + datePreset
rawInsightsSchema.index(
  { adId: 1, date: 1, country: 1, datePreset: 1 },
  { unique: true }
)

// 查询索引
rawInsightsSchema.index({ date: 1, adId: 1 })
rawInsightsSchema.index({ date: 1, campaignId: 1 })
rawInsightsSchema.index({ date: 1, accountId: 1 })
rawInsightsSchema.index({ datePreset: 1, date: 1 })

export default mongoose.model('RawInsights', rawInsightsSchema)

