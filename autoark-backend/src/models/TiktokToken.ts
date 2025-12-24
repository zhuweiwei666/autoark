import mongoose from 'mongoose'

export interface ITiktokToken extends mongoose.Document {
  userId: string
  organizationId?: mongoose.Types.ObjectId // 组织隔离
  accessToken: string
  refreshToken?: string
  openId?: string // TikTok Open ID
  advertiserIds: string[] // 关联的广告主 ID 列表
  status: 'active' | 'expired' | 'invalid' // token 状态
  lastCheckedAt?: Date // 最后检查时间
  expiresAt?: Date // token 过期时间
  refreshTokenExpiresAt?: Date // refresh token 过期时间
  tiktokUserName?: string // TikTok 用户名称
  createdAt: Date
  updatedAt: Date
}

const TiktokTokenSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true }, // 组织隔离
    accessToken: { type: String, required: true },
    refreshToken: { type: String },
    openId: { type: String, index: true },
    advertiserIds: [{ type: String }],
    status: {
      type: String,
      enum: ['active', 'expired', 'invalid'],
      default: 'active',
      index: true,
    },
    lastCheckedAt: { type: Date },
    expiresAt: { type: Date },
    refreshTokenExpiresAt: { type: Date },
    tiktokUserName: { type: String },
  },
  {
    timestamps: true,
  }
)

// 索引
TiktokTokenSchema.index({ status: 1, lastCheckedAt: -1 })

export default mongoose.model<ITiktokToken>('TiktokToken', TiktokTokenSchema)
