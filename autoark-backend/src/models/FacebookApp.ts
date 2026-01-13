import mongoose from 'mongoose'

const facebookAppSchema = new mongoose.Schema(
  {
    appId: { type: String, required: true, unique: true, index: true },
    appSecret: { type: String, required: true },
    appName: { type: String, required: true }, // 用户自定义名称，方便识别
    
    // 状态
    status: { 
      type: String, 
      enum: ['active', 'inactive', 'suspended', 'rate_limited'], 
      default: 'active' 
    },
    
    // 使用统计
    stats: {
      totalRequests: { type: Number, default: 0 },
      successRequests: { type: Number, default: 0 },
      failedRequests: { type: Number, default: 0 },
      lastUsedAt: { type: Date },
      lastErrorAt: { type: Date },
      lastError: { type: String },
      rateLimitResetAt: { type: Date }, // 限流重置时间
    },
    
    // 配置
    config: {
      maxConcurrentTasks: { type: Number, default: 5 }, // 最大并发任务数
      requestsPerMinute: { type: Number, default: 200 }, // 每分钟请求限制
      priority: { type: Number, default: 1 }, // 优先级，数字越大优先级越高
      enabledForBulkAds: { type: Boolean, default: true }, // 是否用于批量发广告
    },
    
    // 当前负载
    currentLoad: {
      activeTasks: { type: Number, default: 0 },
      requestsThisMinute: { type: Number, default: 0 },
      lastResetAt: { type: Date, default: Date.now },
    },
    
    // 验证信息
    validation: {
      isValid: { type: Boolean, default: false },
      validatedAt: { type: Date },
      validationError: { type: String },
    },
    
    /**
     * 合规 / 权限可用性信息（用于判断是否能“任意 FB 号”完成授权）
     * 说明：
     * - Meta 并不会提供一个稳定的 Graph API 来直接告诉你每个 permission 是 Standard 还是 Advanced
     * - 所以这里按“平台侧可维护的事实”进行存储（由管理员在控制台填写/更新）
     * - 后续可接入自动诊断（比如用测试号尝试授权、或结合 App Review 状态）作为辅助
     */
    compliance: {
      appMode: { type: String, enum: ['dev', 'live', 'unknown'], default: 'unknown' },
      businessVerification: { type: String, enum: ['not_started', 'in_review', 'verified', 'rejected', 'unknown'], default: 'unknown' },
      appReview: { type: String, enum: ['not_started', 'in_review', 'approved', 'rejected', 'unknown'], default: 'unknown' },

      // 权限清单与访问级别（Standard/Advanced）
      permissions: [
        new mongoose.Schema(
          {
            name: { type: String, required: true }, // e.g. ads_management
            access: { type: String, enum: ['standard', 'advanced', 'unknown'], default: 'unknown' },
            status: { type: String, enum: ['requested', 'approved', 'rejected', 'unknown'], default: 'unknown' },
            notes: { type: String },
            lastUpdatedAt: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],

      // 是否满足“公开 OAuth 登录”的最低合规要求（供服务端选 App）
      publicOauthReady: { type: Boolean, default: false },
      lastCheckedAt: { type: Date },
    },
    
    // 备注
    notes: { type: String },
    createdBy: { type: String },
  },
  {
    timestamps: true,
    toJSON: { 
      virtuals: true,
      transform: function(doc: any, ret: any) {
        // 隐藏 appSecret，只返回部分
        if (ret.appSecret) {
          ret.appSecretMasked = ret.appSecret.substring(0, 4) + '****' + ret.appSecret.substring(ret.appSecret.length - 4)
          delete ret.appSecret
        }
        return ret
      }
    },
    toObject: { virtuals: true },
  },
)

// 虚拟字段：健康度评分
facebookAppSchema.virtual('healthScore').get(function() {
  if (!this.stats) return 100
  const total = this.stats.totalRequests || 1
  const success = this.stats.successRequests || 0
  return Math.round((success / total) * 100)
})

// 虚拟字段：是否可用
facebookAppSchema.virtual('isAvailable').get(function(this: any) {
  if (this.status === 'rate_limited' && this.stats?.rateLimitResetAt) {
    // 限流中，检查是否已过重置时间
    return new Date() > this.stats.rateLimitResetAt
  }
  if (this.status !== 'active') return false
  if (!this.currentLoad) return true
  return this.currentLoad.activeTasks < (this.config?.maxConcurrentTasks || 5)
})

// 虚拟字段：是否满足公开 OAuth（更严格：需要 validation 通过 + publicOauthReady）
facebookAppSchema.virtual('isPublicOauthReady').get(function(this: any) {
  return Boolean(this.validation?.isValid) && Boolean(this.compliance?.publicOauthReady) && this.status === 'active'
})

// 索引
facebookAppSchema.index({ status: 1, 'config.priority': -1 })
facebookAppSchema.index({ 'currentLoad.activeTasks': 1 })

export default mongoose.model('FacebookApp', facebookAppSchema)

