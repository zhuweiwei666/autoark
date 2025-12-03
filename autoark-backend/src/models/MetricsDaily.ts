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
    mobile_app_install_count: Number, // Example for specific event count

    raw: Object,
  },
  { timestamps: true },
)

// Compound unique index for upsert (ad level with country)
// 使用部分索引：只在 adId 存在时才应用唯一约束，避免 campaign 级别指标冲突
metricsDailySchema.index(
  { adId: 1, date: 1, country: 1 }, 
  { 
    unique: true,
    partialFilterExpression: { adId: { $exists: true } } // 只在 adId 存在时唯一
  }
)
// New compound unique index for campaign level insights (with country)
// 使用部分索引：只在 campaignId 存在时才应用唯一约束
// 注意：country 字段可能为 null（如果没有 breakdowns），所以需要包含在索引中
metricsDailySchema.index(
  { campaignId: 1, date: 1, country: 1 }, 
  { 
    unique: true,
    partialFilterExpression: { campaignId: { $exists: true } } // 只在 campaignId 存在时唯一
  }
)
// 性能优化：为日期范围查询添加索引
metricsDailySchema.index({ date: 1 })
metricsDailySchema.index({ date: 1, campaignId: 1 })
metricsDailySchema.index({ date: 1, accountId: 1 })
// 为国家维度查询添加索引
metricsDailySchema.index({ country: 1, date: 1 })
metricsDailySchema.index({ country: 1, campaignId: 1, date: 1 })

export default mongoose.model('MetricsDaily', metricsDailySchema)
