import mongoose from 'mongoose'

const adSchema = new mongoose.Schema(
  {
    adId: { type: String, required: true, unique: true },
    adsetId: String,
    campaignId: String,
    accountId: String,
    channel: { type: String, default: 'facebook' },
    name: String,
    status: String,
    creativeId: String,
    created_time: Date,
    updated_time: Date,
    raw: Object,
  },
  { timestamps: true },
)

export default mongoose.model('Ad', adSchema)
