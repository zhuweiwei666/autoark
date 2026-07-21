import mongoose from 'mongoose'

export interface IFbToken extends mongoose.Document {
  userId: string
  organizationId?: mongoose.Types.ObjectId // 组织隔离
  token: string
  optimizer?: string // 优化师名称
  status: 'active' | 'expired' | 'invalid' // token 状态
  lastCheckedAt?: Date // 最后一次得到明确验证结果的时间
  lastValidationAttemptAt?: Date // 最后一次验证尝试时间（包括限流/网络失败）
  lastValidationError?: string // 最近一次瞬态验证失败
  lastValidationErrorCode?: number // 最近一次 Meta 错误码
  lastAccountSyncedAt?: Date // 最后一次账户目录同步完成时间
  expiresAt?: Date // token 过期时间（如果 Facebook API 返回）
  fbUserId?: string // Facebook 用户 ID
  fbUserName?: string // Facebook 用户名称
  lastAuthAppId?: string // 上次授权使用的 Facebook App ID
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
    lastCheckedAt: { type: Date }, // 最后一次得到明确验证结果的时间
    lastValidationAttemptAt: { type: Date }, // 最后一次验证尝试时间
    lastValidationError: { type: String },
    lastValidationErrorCode: { type: Number },
    lastAccountSyncedAt: { type: Date },
    expiresAt: { type: Date }, // token 过期时间
    fbUserId: { type: String }, // Facebook 用户 ID
    fbUserName: { type: String }, // Facebook 用户名称
    lastAuthAppId: { type: String }, // 上次授权使用的 Facebook App ID
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true, // 自动管理 createdAt 和 updatedAt
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: any) => {
        delete ret.token
        return ret
      },
    },
    toObject: {
      virtuals: true,
      transform: (_doc, ret: any) => {
        delete ret.token
        return ret
      },
    },
  },
)

// 索引：优化师 + 创建日期，用于筛选
FbTokenSchema.index({ optimizer: 1, createdAt: -1 })
// 索引：租户 Token 列表按创建时间分页
FbTokenSchema.index({ organizationId: 1, createdAt: -1 })
FbTokenSchema.index({ userId: 1, createdAt: -1 })
// 索引：状态 + 最后检查时间
FbTokenSchema.index({ status: 1, lastCheckedAt: -1 })
FbTokenSchema.index({ status: 1, lastValidationAttemptAt: 1 })
// 同一组织内同一个 Facebook 用户只保留一个活跃授权，避免并发 OAuth 产生重复记录
FbTokenSchema.index(
  { fbUserId: 1, organizationId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      fbUserId: { $exists: true },
      organizationId: { $exists: true },
    },
  },
)

export default mongoose.model<IFbToken>('FbToken', FbTokenSchema)
