import mongoose from 'mongoose'

const metricsDailySchema = new mongoose.Schema(
  {
    date: { type: String, required: true }, // YYYY-MM-DD
    channel: { type: String, default: 'facebook' },
    accountId: String,
    campaignId: String,
    adsetId: String,
    adId: String,
    country: String, // 国家代码（从 Facebook API breakdowns 获取）
    
    // 统一 Key 字段
    level: { type: String, enum: ['account', 'campaign', 'adset', 'ad'], index: true },
    entityId: { type: String, index: true }, // accountId/campaignId/adsetId/adId 的值

    // Metrics
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    spendUsd: { type: Number, default: 0 },
    cpc: Number,
    ctr: Number,
    cpm: Number,
    installs: { type: Number, default: 0 },
    conversions: { type: Number, default: 0 }, // Generic conversions if installs not specific

    // New fields for detailed insights
    actions: mongoose.Schema.Types.Mixed, // Array of {action_type, value}
    action_values: mongoose.Schema.Types.Mixed, // Array of {action_type, value}
    purchase_roas: Number,
    purchase_value: Number,
    // Purchase 值修正相关字段
    purchase_value_corrected: Number, // 修正后的值（推荐使用）
    purchase_value_last7d: Number, // last_7d 的值
    purchase_correction_applied: Boolean, // 是否已应用修正
    purchase_correction_date: Date, // 修正时间
    mobile_app_install_count: Number, // Example for specific event count

    raw: Object,
  },
  { timestamps: true },
)

// 复合索引：确保唯一性 (date + level + entityId + country)
metricsDailySchema.index(
  { date: 1, level: 1, entityId: 1, country: 1 },
  { unique: true }
)

// 兼容旧索引 (虽然新写入会用上面的索引，但查询可能还会用到这些)
// 性能优化：为日期范围查询添加索引
metricsDailySchema.index({ date: 1 })
metricsDailySchema.index({ date: 1, campaignId: 1 })
metricsDailySchema.index({ date: 1, accountId: 1 })
// 为国家维度查询添加索引
metricsDailySchema.index({ country: 1, date: 1 })
metricsDailySchema.index({ country: 1, campaignId: 1, date: 1 })

export default mongoose.model('MetricsDaily', metricsDailySchema)
