import mongoose from 'mongoose'

const tokenSchema = new mongoose.Schema({
  platform: { type: String, enum: ['facebook', 'tiktok'], required: true },
  accessToken: { type: String, required: true },
  refreshToken: String,
  fbUserId: String,
  userName: String,
  advertiserIds: [String], // TikTok only
  status: { type: String, enum: ['active', 'expired', 'invalid'], default: 'active' },
  expiresAt: Date,
}, { timestamps: true })

export const Token = mongoose.model('Token', tokenSchema)
