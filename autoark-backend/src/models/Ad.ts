import mongoose from 'mongoose'

/**
 * Ad 模型 - 存储 Facebook 广告详情
 * 增强：包含素材标识字段，支持素材级别追踪
 */
const adSchema = new mongoose.Schema(
  {
    adId: { type: String, required: true, unique: true },
    adsetId: String,
    campaignId: String,
    accountId: String,
    channel: { type: String, default: 'facebook' },
    name: String,
    status: String,
    
    // Creative 关联
    creativeId: String,
    
    // 素材标识（从 creative 提取，用于素材级别追踪）
    imageHash: String,      // 图片 hash
    videoId: String,        // 视频 ID
    thumbnailUrl: String,   // 缩略图 URL
    
    created_time: Date,
    updated_time: Date,
    raw: Object,
  },
  { timestamps: true },
)

// 索引
adSchema.index({ adId: 1 }, { unique: true })
adSchema.index({ campaignId: 1 })
adSchema.index({ adsetId: 1 })
adSchema.index({ accountId: 1 })
adSchema.index({ creativeId: 1 })
adSchema.index({ imageHash: 1 })
adSchema.index({ videoId: 1 })

export default mongoose.model('Ad', adSchema)
