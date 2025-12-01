import mongoose from 'mongoose'

const campaignSchema = new mongoose.Schema(
  {
    campaignId: { type: String, required: true, unique: true },
    accountId: String,
    channel: { type: String, default: 'facebook' },
    name: String,
    status: String,
    objective: String,
    created_time: Date,
    updated_time: Date,
    raw: Object,
  },
  { timestamps: true },
)

export default mongoose.model('Campaign', campaignSchema)
