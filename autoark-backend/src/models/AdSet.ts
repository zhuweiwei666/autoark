import mongoose from 'mongoose'

const adsetSchema = new mongoose.Schema(
  {
    channel: String,
    accountId: String,
    campaignId: String,
    adsetId: String,
    name: String,
    optimizationGoal: String,
    budget: Number,
    raw: Object,
  },
  { timestamps: true },
)

export default mongoose.model('AdSet', adsetSchema)
