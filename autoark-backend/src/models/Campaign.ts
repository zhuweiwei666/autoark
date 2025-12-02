import mongoose from 'mongoose'

const campaignSchema = new mongoose.Schema(
  {
    campaignId: { type: String, required: true, unique: true },
    accountId: String,
    channel: { type: String, default: 'facebook' },
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

export default mongoose.model('Campaign', campaignSchema)
