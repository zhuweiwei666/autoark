import mongoose from 'mongoose'

const adPerformanceBreakdownSchema = new mongoose.Schema(
  {
    date: { type: String, required: true },
    kind: {
      type: String,
      required: true,
      enum: ['country', 'placement', 'hourly'],
      index: true,
    },
    dimensionKey: { type: String, required: true },
    dimension: {
      country: String,
      publisherPlatform: String,
      platformPosition: String,
      impressionDevice: String,
      hour: String,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
    },
    tokenId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FbToken',
      index: true,
    },
    optimizer: { type: String, index: true },
    accountId: { type: String, required: true, index: true },
    currency: String,
    campaignId: String,
    adsetId: String,
    adId: { type: String, required: true, index: true },
    spend: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    purchases: { type: Number, default: 0 },
    purchaseValue: { type: Number, default: 0 },
    roas: { type: Number, default: 0 },
    sourceSyncedAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true },
)

adPerformanceBreakdownSchema.index(
  { date: 1, adId: 1, kind: 1, dimensionKey: 1 },
  { unique: true },
)
adPerformanceBreakdownSchema.index({
  organizationId: 1,
  optimizer: 1,
  date: 1,
  kind: 1,
})
adPerformanceBreakdownSchema.index({ accountId: 1, date: 1, kind: 1 })

export default mongoose.model(
  'AdPerformanceBreakdown',
  adPerformanceBreakdownSchema,
)
