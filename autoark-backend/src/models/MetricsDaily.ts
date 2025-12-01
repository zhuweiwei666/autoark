import mongoose from 'mongoose'

const metricsDailySchema = new mongoose.Schema(
  {
    date: { type: String, required: true }, // YYYY-MM-DD
    channel: { type: String, default: 'facebook' },
    accountId: String,
    campaignId: String,
    adsetId: String,
    adId: String,

    // Metrics
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    spendUsd: { type: Number, default: 0 },
    cpc: Number,
    ctr: Number,
    cpm: Number,
    installs: { type: Number, default: 0 },
    conversions: { type: Number, default: 0 }, // Generic conversions if installs not specific

    raw: Object,
  },
  { timestamps: true },
)

// Compound unique index for upsert
metricsDailySchema.index({ adId: 1, date: 1 }, { unique: true })

export default mongoose.model('MetricsDaily', metricsDailySchema)
