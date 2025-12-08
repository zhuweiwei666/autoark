import mongoose from 'mongoose'

/**
 * 产品数据模型
 * 作为文案包、Pixel、广告账户的关系枢纽
 * 用于实现全自动投放时的智能匹配
 */

// 产品-Pixel 关联
const pixelMappingSchema = new mongoose.Schema({
  pixelId: { type: String, required: true },
  pixelName: { type: String },
  confidence: { type: Number, default: 0 }, // 匹配置信度 0-100
  matchMethod: { 
    type: String, 
    enum: ['auto_name', 'auto_url', 'manual'], // 匹配方式
    default: 'auto_name'
  },
  verified: { type: Boolean, default: false }, // 是否人工确认
  verifiedBy: { type: String },
  verifiedAt: { type: Date },
}, { _id: false })

// 产品-账户 关联
const accountMappingSchema = new mongoose.Schema({
  accountId: { type: String, required: true },
  accountName: { type: String },
  throughPixelId: { type: String }, // 通过哪个 Pixel 关联
  status: { 
    type: String, 
    enum: ['active', 'inactive', 'suspended'],
    default: 'active'
  },
  lastUsedAt: { type: Date },
  adCount: { type: Number, default: 0 }, // 该账户投放该产品的广告数
}, { _id: false })

// 产品 URL 模式
const urlPatternSchema = new mongoose.Schema({
  pattern: { type: String, required: true }, // URL 匹配模式 (正则或关键词)
  type: { type: String, enum: ['domain', 'path', 'param', 'regex'], default: 'domain' },
  priority: { type: Number, default: 0 }, // 优先级
}, { _id: false })

const productSchema = new mongoose.Schema(
  {
    // 基本信息
    name: { type: String, required: true, index: true },
    identifier: { type: String, required: true, unique: true }, // 唯一标识符（从URL提取）
    description: { type: String },
    
    // URL 匹配规则
    urlPatterns: [urlPatternSchema],
    primaryDomain: { type: String, index: true }, // 主域名
    
    // Pixel 关联
    pixels: [pixelMappingSchema],
    primaryPixelId: { type: String }, // 主 Pixel
    
    // 账户关联
    accounts: [accountMappingSchema],
    
    // 文案包关联（反向引用）
    copywritingPackageIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CopywritingPackage' }],
    
    // 投放配置
    defaultConfig: {
      objective: { type: String, default: 'OUTCOME_SALES' },
      optimizationGoal: { type: String, default: 'OFFSITE_CONVERSIONS' },
      billingEvent: { type: String, default: 'IMPRESSIONS' },
      pixelEvent: { type: String, default: 'PURCHASE' }, // 默认转化事件
    },
    
    // 统计
    stats: {
      totalSpend: { type: Number, default: 0 },
      totalRevenue: { type: Number, default: 0 },
      totalAds: { type: Number, default: 0 },
      activeCampaigns: { type: Number, default: 0 },
    },
    
    // 元数据
    tags: [{ type: String }],
    category: { type: String }, // 产品类目
    status: { 
      type: String, 
      enum: ['active', 'inactive', 'archived'],
      default: 'active'
    },
    createdBy: { type: String },
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
)

// 索引
productSchema.index({ primaryDomain: 1 })
productSchema.index({ 'pixels.pixelId': 1 })
productSchema.index({ 'accounts.accountId': 1 })
productSchema.index({ status: 1, createdAt: -1 })

// 虚拟字段：可用账户数
productSchema.virtual('availableAccountCount').get(function() {
  return this.accounts?.filter(a => a.status === 'active').length || 0
})

// 方法：检查账户是否可投放该产品
productSchema.methods.canAdvertiseWith = function(accountId: string): boolean {
  return this.accounts?.some(
    (a: any) => a.accountId === accountId && a.status === 'active'
  ) || false
}

// 方法：获取最佳投放账户
productSchema.methods.getBestAccount = function(): string | null {
  const activeAccounts = this.accounts?.filter((a: any) => a.status === 'active') || []
  if (activeAccounts.length === 0) return null
  
  // 按广告数排序，选择使用最少的账户（负载均衡）
  activeAccounts.sort((a: any, b: any) => (a.adCount || 0) - (b.adCount || 0))
  return activeAccounts[0].accountId
}

// 方法：获取主 Pixel
productSchema.methods.getPrimaryPixel = function(): { pixelId: string; pixelName?: string } | null {
  if (this.primaryPixelId) {
    const pixel = this.pixels?.find((p: any) => p.pixelId === this.primaryPixelId)
    if (pixel) return { pixelId: pixel.pixelId, pixelName: pixel.pixelName }
  }
  
  // 如果没有主 Pixel，返回置信度最高的
  const sortedPixels = [...(this.pixels || [])].sort((a: any, b: any) => 
    (b.confidence || 0) - (a.confidence || 0)
  )
  
  if (sortedPixels.length > 0) {
    return { pixelId: sortedPixels[0].pixelId, pixelName: sortedPixels[0].pixelName }
  }
  
  return null
}

export default mongoose.model('Product', productSchema)

