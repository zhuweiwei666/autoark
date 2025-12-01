import mongoose from 'mongoose'

const adSchema = new mongoose.Schema(
  {
    channel: String,
    accountId: String,
    adsetId: String,
    adId: String,
    name: String,
    status: String,
    creativeId: String,
    raw: Object,
  },
  { timestamps: true },
)

export default mongoose.model('Ad', adSchema)
