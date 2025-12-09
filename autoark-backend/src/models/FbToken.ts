import mongoose from 'mongoose'

export interface IFbToken extends mongoose.Document {
  userId: string
  organizationId?: mongoose.Types.ObjectId // 组织隔离
  token: string
  optimizer?: string // 优化师名称
  status: 'active' | 'expired' | 'invalid' // token 状态
  lastCheckedAt?: Date // 最后检查时间
  expiresAt?: Date // token 过期时间（如果 Facebook API 返回）
  fbUserId?: string // Facebook 用户 ID
  fbUserName?: string // Facebook 用户名称
  createdAt: Date
  updatedAt: Date
}

const FbTokenSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true }, // 组织隔离
    token: { type: String, required: true },
    optimizer: { type: String, index: true }, // 优化师名称，支持筛选
    status: {
      type: String,
      enum: ['active', 'expired', 'invalid'],
      default: 'active',
      index: true,
    },
    lastCheckedAt: { type: Date }, // 最后检查时间
    expiresAt: { type: Date }, // token 过期时间
    fbUserId: { type: String }, // Facebook 用户 ID
    fbUserName: { type: String }, // Facebook 用户名称
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true, // 自动管理 createdAt 和 updatedAt
  },
)

// 索引：优化师 + 创建日期，用于筛选
FbTokenSchema.index({ optimizer: 1, createdAt: -1 })
// 索引：状态 + 最后检查时间
FbTokenSchema.index({ status: 1, lastCheckedAt: -1 })

export default mongoose.model<IFbToken>('FbToken', FbTokenSchema)
