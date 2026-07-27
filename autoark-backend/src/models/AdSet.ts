import mongoose from 'mongoose'

const adSetSchema = new mongoose.Schema(
  {
    adsetId: { type: String, required: true, unique: true },
    accountId: String,
    campaignId: String,
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },
    tokenId: { type: mongoose.Schema.Types.ObjectId, ref: 'FbToken', index: true },
    optimizer: { type: String, index: true },
    sourceSyncedAt: { type: Date, index: true },
    channel: { type: String, default: 'facebook' },
    platform: { type: String, enum: ['facebook', 'tiktok'], default: 'facebook', index: true },
    name: String,
    status: String,
    optimizationGoal: String,
    budget: Number,
    created_time: Date,
    updated_time: Date,
    raw: Object,
  },
  { timestamps: true },
)

adSetSchema.index({ organizationId: 1, optimizer: 1, campaignId: 1 })

export default mongoose.model('AdSet', adSetSchema)
