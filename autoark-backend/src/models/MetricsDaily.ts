import mongoose from 'mongoose'

const metricsDailySchema = new mongoose.Schema(
  {
    date: String, // YYYY-MM-DD
    channel: String,
    accountId: String,
    campaignId: String,
    adsetId: String,
    adId: String,
    country: String,
    platform: String,
    impressions: Number,
    clicks: Number,
    installs: Number,
    spendUsd: Number,
    revenueD0: Number,
    revenueD1: Number,
    cpiUsd: Number,
    roiD0: Number,
    raw: Object,
  },
  { timestamps: true },
)

export default mongoose.model('MetricsDaily', metricsDailySchema)
