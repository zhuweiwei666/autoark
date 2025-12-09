import mongoose from 'mongoose'

/**
 * 创意组数据模型
 * 用于保存和复用广告素材组合
 */

// 素材 Schema
const materialSchema = new mongoose.Schema({
  // 素材基本信息
  type: { 
    type: String, 
    required: true,
    enum: ['image', 'video'],
  },
  url: { type: String, required: true },
  
  // 素材元数据
  name: { type: String },
  width: { type: Number },
  height: { type: Number },
  duration: { type: Number },  // 视频时长（秒）
  size: { type: Number },  // 文件大小（字节）
  format: { type: String },  // jpg, png, mp4 等
  
  // 缩略图（视频素材用）
  thumbnail: { type: String },
  
  // Facebook 素材 ID（上传后获得）
  facebookImageHash: { type: String },
  facebookVideoId: { type: String },
  
  // 素材状态
  status: { 
    type: String, 
    default: 'pending',
    enum: ['pending', 'uploaded', 'failed'],
  },
  uploadedAt: { type: Date },
  
  // 素材来源
  source: {
    type: String,
    default: 'manual',
    enum: ['manual', 'facebook_sync', 'url_import'],
  },
  sourceId: { type: String },  // 来源平台的素材 ID
  
}, { _id: true })

const creativeGroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true }, // 组织隔离
    accountId: { type: String, index: true },  // 可选，创意组可跨账户使用
    platform: { type: String, default: 'facebook', enum: ['facebook', 'tiktok', 'google'] },
    
    // 素材列表
    materials: [materialSchema],
    
    // 素材配置
    config: {
      // 广告格式
      format: {
        type: String,
        default: 'single',
        enum: ['single', 'carousel', 'collection'],
      },
      // 是否启用动态素材
      dynamicCreative: { type: Boolean, default: false },
      // 轮播图设置
      carousel: {
        autoOptimize: { type: Boolean, default: true },  // 自动优化排序
        linkPerCard: { type: Boolean, default: false },  // 每张卡片独立链接
      },
    },
    
    // 关联的文案包（可选）
    copywritingPackageId: { type: mongoose.Schema.Types.ObjectId, ref: 'CopywritingPackage' },
    
    // 元数据
    description: { type: String },
    tags: [{ type: String }],
    folderId: { type: String },  // 文件夹分类
    createdBy: { type: String },
    
    // 统计
    usageCount: { type: Number, default: 0 },
    lastUsedAt: { type: Date },
    
    // 素材统计
    materialStats: {
      totalCount: { type: Number, default: 0 },
      imageCount: { type: Number, default: 0 },
      videoCount: { type: Number, default: 0 },
      uploadedCount: { type: Number, default: 0 },
    },
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
)

// 复合索引
creativeGroupSchema.index({ accountId: 1, name: 1 }, { unique: true })
creativeGroupSchema.index({ platform: 1, createdAt: -1 })
creativeGroupSchema.index({ tags: 1 })
creativeGroupSchema.index({ folderId: 1 })

// 更新素材统计的中间件
creativeGroupSchema.pre('save', function() {
  if (this.materials) {
    this.materialStats = {
      totalCount: this.materials.length,
      imageCount: this.materials.filter((m: any) => m.type === 'image').length,
      videoCount: this.materials.filter((m: any) => m.type === 'video').length,
      uploadedCount: this.materials.filter((m: any) => m.status === 'uploaded').length,
    }
  }
})

// 获取已上传的素材
creativeGroupSchema.methods.getUploadedMaterials = function() {
  return this.materials.filter((m: any) => m.status === 'uploaded')
}

// 获取第一个可用素材（用于单图/视频广告）
creativeGroupSchema.methods.getPrimaryMaterial = function() {
  const uploaded = this.getUploadedMaterials()
  return uploaded.length > 0 ? uploaded[0] : null
}

// 转换为 Facebook 轮播广告格式
creativeGroupSchema.methods.toFacebookCarousel = function(copywriting: any) {
  const uploadedMaterials = this.getUploadedMaterials()
  if (uploadedMaterials.length === 0) return null
  
  const carouselCards = uploadedMaterials.slice(0, 10).map((material: any, index: number) => {
    const card: any = {
      link: copywriting?.links?.websiteUrl || '',
      name: copywriting?.content?.headlines?.[index] || copywriting?.content?.headlines?.[0] || '',
      description: copywriting?.content?.descriptions?.[index] || copywriting?.content?.descriptions?.[0] || '',
      call_to_action: {
        type: copywriting?.callToAction || 'SHOP_NOW',
      },
    }
    
    if (material.type === 'image' && material.facebookImageHash) {
      card.image_hash = material.facebookImageHash
    } else if (material.type === 'video' && material.facebookVideoId) {
      card.video_id = material.facebookVideoId
    }
    
    return card
  })
  
  return {
    object_story_spec: {
      link_data: {
        link: copywriting?.links?.websiteUrl || '',
        message: copywriting?.content?.primaryTexts?.[0] || '',
        child_attachments: carouselCards,
        multi_share_optimized: this.config?.carousel?.autoOptimize ?? true,
      },
    },
  }
}

// 检查素材是否已全部上传
creativeGroupSchema.methods.isReady = function() {
  return this.materials.length > 0 && 
         this.materials.every((m: any) => m.status === 'uploaded')
}

export default mongoose.model('CreativeGroup', creativeGroupSchema)

