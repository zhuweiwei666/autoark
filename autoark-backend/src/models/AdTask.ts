import mongoose from 'mongoose'

/**
 * 广告任务数据模型
 * 用于追踪批量广告创建的任务执行状态
 */

// 任务项 Schema（每个账户的创建任务）
const taskItemSchema = new mongoose.Schema({
  accountId: { type: String, required: true },
  accountName: { type: String },
  
  // 状态
  status: { 
    type: String, 
    default: 'pending',
    enum: ['pending', 'processing', 'success', 'failed', 'skipped'],
  },
  
  // 进度
  progress: {
    current: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
  },
  
  // 创建结果
  result: {
    campaignId: { type: String },
    campaignName: { type: String },
    adsetIds: [{ type: String }],
    adIds: [{ type: String }],
    createdCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
  },
  
  // 错误信息
  errors: [{
    entityType: { type: String, enum: ['campaign', 'adset', 'ad', 'creative', 'general'] },
    entityName: { type: String },
    errorCode: { type: String },
    errorMessage: { type: String },
    errorDetails: { type: Object },
    timestamp: { type: Date, default: Date.now },
  }],
  
  // 时间戳
  startedAt: { type: Date },
  completedAt: { type: Date },
  duration: { type: Number },  // 耗时（毫秒）
}, { _id: true })

const adTaskSchema = new mongoose.Schema(
  {
    // 任务类型
    taskType: { 
      type: String, 
      required: true,
      default: 'BULK_AD_CREATE',
      enum: ['BULK_AD_CREATE', 'BULK_AD_UPDATE', 'BULK_AD_DELETE', 'MATERIAL_UPLOAD'],
    },
    
    // 任务状态
    status: { 
      type: String, 
      default: 'pending',
      enum: ['pending', 'queued', 'processing', 'success', 'partial_success', 'failed', 'cancelled'],
    },
    
    // 平台
    platform: { type: String, default: 'facebook', enum: ['facebook', 'tiktok', 'google'] },
    
    // 关联的草稿
    draftId: { type: mongoose.Schema.Types.ObjectId, ref: 'AdDraft' },
    
    // 任务项（每个账户一个）
    items: [taskItemSchema],
    
    // 总体进度
    progress: {
      totalAccounts: { type: Number, default: 0 },
      completedAccounts: { type: Number, default: 0 },
      successAccounts: { type: Number, default: 0 },
      failedAccounts: { type: Number, default: 0 },
      
      totalCampaigns: { type: Number, default: 0 },
      createdCampaigns: { type: Number, default: 0 },
      
      totalAdsets: { type: Number, default: 0 },
      createdAdsets: { type: Number, default: 0 },
      
      totalAds: { type: Number, default: 0 },
      createdAds: { type: Number, default: 0 },
      
      percentage: { type: Number, default: 0 },
    },
    
    // 任务配置快照（防止草稿被修改）
    configSnapshot: {
      accounts: [{ type: Object }],
      campaign: { type: Object },
      adset: { type: Object },
      ad: { type: Object },
      publishStrategy: { type: Object },
    },
    
    // 发布设置
    publishSettings: {
      schedule: { type: String, default: 'IMMEDIATE', enum: ['IMMEDIATE', 'SCHEDULED'] },
      scheduledTime: { type: Date },
      retryOnFailure: { type: Boolean, default: true },
      maxRetries: { type: Number, default: 3 },
    },
    
    // 重试信息
    retryInfo: {
      retryCount: { type: Number, default: 0 },
      lastRetryAt: { type: Date },
      nextRetryAt: { type: Date },
    },
    
    // 时间戳
    queuedAt: { type: Date },
    startedAt: { type: Date },
    completedAt: { type: Date },
    duration: { type: Number },  // 总耗时（毫秒）
    
    // 元数据
    createdBy: { type: String },
    notes: { type: String },
    tags: [{ type: String }],
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
)

// 索引
adTaskSchema.index({ status: 1, createdAt: -1 })
adTaskSchema.index({ taskType: 1, status: 1 })
adTaskSchema.index({ draftId: 1 })
adTaskSchema.index({ createdBy: 1, createdAt: -1 })
adTaskSchema.index({ 'items.accountId': 1 })

// 虚拟字段：是否已完成
adTaskSchema.virtual('isCompleted').get(function() {
  return ['success', 'partial_success', 'failed', 'cancelled'].includes(this.status)
})

// 虚拟字段：是否成功
adTaskSchema.virtual('isSuccess').get(function() {
  return this.status === 'success'
})

// 更新进度
adTaskSchema.methods.updateProgress = function() {
  const items = this.items || []
  
  const completed = items.filter((i: any) => ['success', 'failed', 'skipped'].includes(i.status))
  const successful = items.filter((i: any) => i.status === 'success')
  const failed = items.filter((i: any) => i.status === 'failed')
  
  let totalAdsCreated = 0
  let totalAdsetsCreated = 0
  let totalCampaignsCreated = 0
  
  for (const item of items) {
    if (item.result) {
      if (item.result.campaignId) totalCampaignsCreated++
      totalAdsetsCreated += item.result.adsetIds?.length || 0
      totalAdsCreated += item.result.adIds?.length || 0
    }
  }
  
  this.progress = {
    totalAccounts: items.length,
    completedAccounts: completed.length,
    successAccounts: successful.length,
    failedAccounts: failed.length,
    
    totalCampaigns: this.progress?.totalCampaigns || items.length,
    createdCampaigns: totalCampaignsCreated,
    
    totalAdsets: this.progress?.totalAdsets || items.length,
    createdAdsets: totalAdsetsCreated,
    
    totalAds: this.progress?.totalAds || items.length,
    createdAds: totalAdsCreated,
    
    percentage: items.length > 0 ? Math.round((completed.length / items.length) * 100) : 0,
  }
  
  // 更新整体状态
  if (completed.length === items.length) {
    if (failed.length === 0) {
      this.status = 'success'
    } else if (successful.length > 0) {
      this.status = 'partial_success'
    } else {
      this.status = 'failed'
    }
    this.completedAt = new Date()
    if (this.startedAt) {
      this.duration = this.completedAt.getTime() - this.startedAt.getTime()
    }
  }
  
  return this.progress
}

// 更新单个任务项状态
adTaskSchema.methods.updateItemStatus = function(
  accountId: string, 
  status: string, 
  result?: any, 
  error?: any
) {
  const item = this.items.find((i: any) => i.accountId === accountId)
  if (!item) return null
  
  item.status = status
  
  if (status === 'processing' && !item.startedAt) {
    item.startedAt = new Date()
  }
  
  if (result) {
    item.result = { ...item.result, ...result }
  }
  
  if (error) {
    item.errors.push({
      ...error,
      timestamp: new Date(),
    })
  }
  
  if (['success', 'failed', 'skipped'].includes(status)) {
    item.completedAt = new Date()
    if (item.startedAt) {
      item.duration = item.completedAt.getTime() - item.startedAt.getTime()
    }
  }
  
  // 更新总体进度
  this.updateProgress()
  
  return item
}

// 获取摘要信息
adTaskSchema.methods.getSummary = function() {
  return {
    taskId: this._id,
    taskType: this.taskType,
    status: this.status,
    platform: this.platform,
    progress: this.progress,
    createdAt: this.createdAt,
    startedAt: this.startedAt,
    completedAt: this.completedAt,
    duration: this.duration,
    isCompleted: this.isCompleted,
    isSuccess: this.isSuccess,
  }
}

// 获取失败的任务项
adTaskSchema.methods.getFailedItems = function() {
  return this.items.filter((i: any) => i.status === 'failed')
}

// 获取所有错误
adTaskSchema.methods.getAllErrors = function() {
  const errors: any[] = []
  for (const item of this.items) {
    for (const error of (item.errors || [])) {
      errors.push({
        accountId: item.accountId,
        accountName: item.accountName,
        ...error,
      })
    }
  }
  return errors
}

export default mongoose.model('AdTask', adTaskSchema)

