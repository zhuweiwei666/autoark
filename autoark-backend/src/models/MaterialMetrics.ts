import mongoose from 'mongoose'

/**
 * 素材级别指标数据模型
 * 用于追踪每个素材（图片/视频）的投放表现
 * 这是实现全自动化优化的关键数据基础
 */

const materialMetricsSchema = new mongoose.Schema(
  {
    // 日期
    date: { type: String, required: true }, // YYYY-MM-DD
    
    // 素材标识
    materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'Material' }, // 关联到 Material 表
    
    // Facebook 素材标识（用于匹配）
    creativeId: { type: String }, // Facebook 创意 ID（主要标识符）
    imageHash: { type: String }, // 图片的 hash
    videoId: { type: String },   // 视频的 ID
    thumbnailUrl: { type: String }, // 缩略图 URL
    
    // ========== 素材展示信息（关键！）==========
    localStorageUrl: { type: String }, // R2 本地存储的 URL（可直接展示）
    originalUrl: { type: String },     // Facebook 原始 URL
    fingerprint: { type: String },     // 素材指纹（pHash）用于跨系统识别
    
    // 🎯 归因类型（诊断用）
    matchType: { type: String, enum: ['direct', 'fallback', 'none'] }, // direct=通过materialId, fallback=通过hash反查
    
    // 关联维度
    accountIds: [{ type: String }],    // 使用该素材的账户
    campaignIds: [{ type: String }],   // 使用该素材的广告系列
    adsetIds: [{ type: String }],      // 使用该素材的广告组
    adIds: [{ type: String }],         // 使用该素材的广告
    
    // 素材元信息
    materialType: { type: String, enum: ['image', 'video'] },
    materialName: { type: String },
    creativeText: { type: String },  // 关联的文案（如有）
    
    // 投放者信息（从广告系列名称提取）
    optimizers: [{ type: String }], // 使用该素材的投手列表
    
    // ============ 核心指标 ============
    // 消耗
    spend: { type: Number, default: 0 },
    
    // 曝光
    impressions: { type: Number, default: 0 },
    
    // 点击
    clicks: { type: Number, default: 0 },
    
    // 转化
    conversions: { type: Number, default: 0 },
    installs: { type: Number, default: 0 },
    purchases: { type: Number, default: 0 },
    purchaseValue: { type: Number, default: 0 },
    leads: { type: Number, default: 0 },
    
    // 互动
    videoViews: { type: Number, default: 0 },
    videoViewsP25: { type: Number, default: 0 },
    videoViewsP50: { type: Number, default: 0 },
    videoViewsP75: { type: Number, default: 0 },
    videoViewsP100: { type: Number, default: 0 },
    postEngagement: { type: Number, default: 0 },
    
    // ============ 派生指标（计算得出）============
    ctr: { type: Number }, // 点击率
    cpc: { type: Number }, // 单次点击成本
    cpm: { type: Number }, // 千次曝光成本
    cpi: { type: Number }, // 单次安装成本
    roas: { type: Number }, // 广告支出回报率
    
    // ============ 素材评分 ============
    qualityScore: { type: Number, default: 0 }, // 综合质量评分 0-100
    engagementScore: { type: Number, default: 0 }, // 互动评分
    conversionScore: { type: Number, default: 0 }, // 转化评分
    
    // ============ 使用统计 ============
    activeAdsCount: { type: Number, default: 0 }, // 当日在跑的广告数
    totalAdsCount: { type: Number, default: 0 },  // 累计使用的广告数
    
    // 原始数据
    raw: { type: Object },
  },
  { timestamps: true }
)

// 复合索引：确保唯一性（使用 creativeId 作为主要标识）
materialMetricsSchema.index({ date: 1, creativeId: 1 }, { unique: true, sparse: true })
materialMetricsSchema.index({ date: 1, imageHash: 1 }, { sparse: true })
materialMetricsSchema.index({ date: 1, videoId: 1 }, { sparse: true })
materialMetricsSchema.index({ date: 1, materialId: 1 }, { sparse: true })

// 查询索引
materialMetricsSchema.index({ date: 1 })
materialMetricsSchema.index({ creativeId: 1, date: -1 })
materialMetricsSchema.index({ materialId: 1, date: -1 })
materialMetricsSchema.index({ imageHash: 1, date: -1 })
materialMetricsSchema.index({ videoId: 1, date: -1 })
materialMetricsSchema.index({ qualityScore: -1, date: -1 })
materialMetricsSchema.index({ roas: -1, date: -1 })

// 计算派生指标的方法
materialMetricsSchema.methods.calculateDerivedMetrics = function() {
  if (this.impressions > 0) {
    this.ctr = (this.clicks / this.impressions) * 100
    this.cpm = (this.spend / this.impressions) * 1000
  }
  if (this.clicks > 0) {
    this.cpc = this.spend / this.clicks
  }
  if (this.installs > 0) {
    this.cpi = this.spend / this.installs
  }
  if (this.spend > 0 && this.purchaseValue > 0) {
    this.roas = this.purchaseValue / this.spend
  }
  
  // 计算质量评分
  this.calculateQualityScore()
}

// 计算质量评分
materialMetricsSchema.methods.calculateQualityScore = function() {
  let score = 50 // 基础分
  
  // ROAS 评分 (最高 30 分)
  if (this.roas >= 3) score += 30
  else if (this.roas >= 2) score += 25
  else if (this.roas >= 1.5) score += 20
  else if (this.roas >= 1) score += 10
  else if (this.roas < 0.5) score -= 10
  
  // CTR 评分 (最高 10 分)
  if (this.ctr >= 2) score += 10
  else if (this.ctr >= 1) score += 5
  else if (this.ctr < 0.5) score -= 5
  
  // 转化评分 (最高 10 分)
  if (this.purchases > 0 || this.installs > 0) {
    score += Math.min(10, (this.purchases + this.installs))
  }
  
  this.qualityScore = Math.max(0, Math.min(100, score))
}

// 静态方法：按素材聚合获取排名
materialMetricsSchema.statics.getTopMaterials = async function(
  dateRange: { start: string; end: string },
  limit: number = 20,
  sortBy: string = 'roas'
) {
  return this.aggregate([
    {
      $match: {
        date: { $gte: dateRange.start, $lte: dateRange.end },
        spend: { $gt: 10 } // 至少有一定消耗
      }
    },
    {
      $group: {
        _id: { $ifNull: ['$imageHash', '$videoId'] },
        materialId: { $first: '$materialId' },
        materialType: { $first: '$materialType' },
        materialName: { $first: '$materialName' },
        thumbnailUrl: { $first: '$thumbnailUrl' },
        totalSpend: { $sum: '$spend' },
        totalImpressions: { $sum: '$impressions' },
        totalClicks: { $sum: '$clicks' },
        totalPurchaseValue: { $sum: '$purchaseValue' },
        totalInstalls: { $sum: '$installs' },
        totalPurchases: { $sum: '$purchases' },
        daysActive: { $sum: 1 },
        uniqueAds: { $addToSet: '$adIds' },
        uniqueCampaigns: { $addToSet: '$campaignIds' },
        optimizers: { $addToSet: '$optimizers' },
      }
    },
    {
      $addFields: {
        roas: { $cond: [{ $gt: ['$totalSpend', 0] }, { $divide: ['$totalPurchaseValue', '$totalSpend'] }, 0] },
        ctr: { $cond: [{ $gt: ['$totalImpressions', 0] }, { $multiply: [{ $divide: ['$totalClicks', '$totalImpressions'] }, 100] }, 0] },
        cpi: { $cond: [{ $gt: ['$totalInstalls', 0] }, { $divide: ['$totalSpend', '$totalInstalls'] }, 0] },
      }
    },
    { $sort: { [sortBy]: -1 } },
    { $limit: limit },
    {
      $project: {
        materialHash: '$_id',
        materialId: 1,
        materialType: 1,
        materialName: 1,
        thumbnailUrl: 1,
        spend: { $round: ['$totalSpend', 2] },
        impressions: '$totalImpressions',
        clicks: '$totalClicks',
        purchaseValue: { $round: ['$totalPurchaseValue', 2] },
        installs: '$totalInstalls',
        purchases: '$totalPurchases',
        roas: { $round: ['$roas', 2] },
        ctr: { $round: ['$ctr', 2] },
        cpi: { $round: ['$cpi', 2] },
        daysActive: 1,
        adsCount: { $size: { $reduce: { input: '$uniqueAds', initialValue: [], in: { $setUnion: ['$$value', '$$this'] } } } },
        campaignsCount: { $size: { $reduce: { input: '$uniqueCampaigns', initialValue: [], in: { $setUnion: ['$$value', '$$this'] } } } },
        optimizers: { $reduce: { input: '$optimizers', initialValue: [], in: { $setUnion: ['$$value', '$$this'] } } },
      }
    }
  ])
}

export default mongoose.model('MaterialMetrics', materialMetricsSchema)

