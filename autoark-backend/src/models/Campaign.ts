import mongoose from 'mongoose'

const campaignSchema = new mongoose.Schema(
  {
    campaignId: { type: String, required: true, unique: true },
    accountId: String,
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },
    tokenId: { type: mongoose.Schema.Types.ObjectId, ref: 'FbToken', index: true },
    optimizer: { type: String, index: true },
    sourceSyncedAt: { type: Date, index: true },
    channel: { type: String, default: 'facebook' },
    platform: { type: String, enum: ['facebook', 'tiktok'], default: 'facebook', index: true },
    name: String,
    status: String,
    objective: String,
    buying_type: String, // 购买类型，如 AUCTION
    daily_budget: String, // 日预算
    budget_remaining: String, // 剩余预算
    created_time: Date,
    updated_time: Date,
    raw: Object,
  },
  { timestamps: true },
)

campaignSchema.index({ organizationId: 1, optimizer: 1, accountId: 1 })

export default mongoose.model('Campaign', campaignSchema)
