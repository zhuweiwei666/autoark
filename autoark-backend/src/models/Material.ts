import mongoose from 'mongoose'

/**
 * 素材数据模型
 * 用于存储用户上传的图片、视频等素材
 */

const materialSchema = new mongoose.Schema(
  {
    // 素材名称
    name: { type: String, required: true },
    
    // 素材类型
    type: { 
      type: String, 
      required: true,
      enum: ['image', 'video'],
    },
    
    // 素材状态
    status: {
      type: String,
      default: 'uploaded',
      enum: ['uploading', 'uploaded', 'failed', 'deleted'],
    },
    
    // 存储信息
    storage: {
      provider: { type: String, default: 'r2' }, // r2, s3, local
      bucket: { type: String },
      key: { type: String }, // 存储路径/文件名
      url: { type: String, required: true }, // 公开访问 URL
    },
    
    // 文件信息
    file: {
      originalName: { type: String },
      mimeType: { type: String },
      size: { type: Number }, // 字节
      width: { type: Number }, // 图片/视频宽度
      height: { type: Number }, // 图片/视频高度
      duration: { type: Number }, // 视频时长（秒）
    },
    
    // 缩略图
    thumbnail: {
      url: { type: String },
      width: { type: Number },
      height: { type: Number },
    },
    
    // Facebook 相关（上传后获得）
    facebook: {
      imageHash: { type: String }, // 图片上传后的 hash
      videoId: { type: String }, // 视频上传后的 ID
      uploadedAt: { type: Date },
    },
    
    // 标签和分类
    tags: [{ type: String }],
    folder: { type: String, default: '默认' }, // 文件夹分类
    
    // 使用统计
    usageCount: { type: Number, default: 0 },
    lastUsedAt: { type: Date },
    
    // 元数据
    createdBy: { type: String },
    notes: { type: String },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
)

// 索引
materialSchema.index({ type: 1, status: 1 })
materialSchema.index({ folder: 1, createdAt: -1 })
materialSchema.index({ tags: 1 })
materialSchema.index({ createdBy: 1, createdAt: -1 })
materialSchema.index({ 'storage.url': 1 })

// 虚拟字段：文件大小（友好格式）
materialSchema.virtual('fileSizeFormatted').get(function() {
  const size = this.file?.size
  if (!size) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
})

// 虚拟字段：视频时长（友好格式）
materialSchema.virtual('durationFormatted').get(function() {
  const duration = this.file?.duration
  if (!duration) return '-'
  const minutes = Math.floor(duration / 60)
  const seconds = Math.floor(duration % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
})

export default mongoose.model('Material', materialSchema)

