import mongoose from 'mongoose'

/**
 * Creative 模型 - 存储 Facebook 创意详情
 * 用于关联广告与素材，实现素材级别追踪
 */
const creativeSchema = new mongoose.Schema(
  {
    // 基本信息
    channel: { type: String, default: 'facebook' },
    creativeId: { type: String, required: true, unique: true },
    name: String,
    status: String,
    
    // 素材类型
    type: { type: String, enum: ['image', 'video', 'carousel', 'collection', 'unknown'] },
    
    // 图片素材标识
    imageHash: String,      // Facebook 图片 hash（关键：用于素材去重）
    imageUrl: String,       // 图片 URL
    
    // 视频素材标识
    videoId: String,        // Facebook 视频 ID（关键：用于素材去重）
    
    // 缩略图
    thumbnailUrl: String,
    
    // 旧字段兼容
    hash: String,           // 等同于 imageHash
    storageUrl: String,     // 等同于 thumbnailUrl 或 imageUrl
    
    // 素材尺寸
    width: Number,
    height: Number,
    duration: Number,       // 视频时长（秒）
    
    // 关联信息
    accountId: String,
    
    // 标签和分类
    tags: [String],
    createdBy: String,
    
    // 关联的 Material（上传的素材）
    materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'Material' },
    
    // 原始数据
    raw: Object,
  },
  { timestamps: true },
)

// 索引
creativeSchema.index({ creativeId: 1 }, { unique: true })
creativeSchema.index({ imageHash: 1 })
creativeSchema.index({ videoId: 1 })
creativeSchema.index({ accountId: 1 })
creativeSchema.index({ materialId: 1 })

export default mongoose.model('Creative', creativeSchema)
