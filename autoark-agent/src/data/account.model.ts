import mongoose from 'mongoose'

const adAccountSchema = new mongoose.Schema({
  platform: { type: String, enum: ['facebook', 'tiktok'], required: true },
  accountId: { type: String, required: true },
  name: { type: String },
  tokenId: { type: mongoose.Schema.Types.ObjectId, ref: 'Token' },
  status: { type: String, enum: ['active', 'paused', 'disabled'], default: 'active' },
  currency: String,
  timezone: String,
}, { timestamps: true })

adAccountSchema.index({ platform: 1, accountId: 1 }, { unique: true })

export const AdAccount = mongoose.model('AdAccount', adAccountSchema)
