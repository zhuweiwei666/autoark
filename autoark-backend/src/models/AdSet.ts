import mongoose from 'mongoose'

const adSetSchema = new mongoose.Schema(
  {
    adsetId: { type: String, required: true, unique: true },
    accountId: String,
    campaignId: String,
    channel: { type: String, default: 'facebook' },
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

export default mongoose.model('AdSet', adSetSchema)
