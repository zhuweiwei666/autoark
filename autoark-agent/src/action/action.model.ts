import mongoose from 'mongoose'

/**
 * Agent 提出的操作 - 写操作的审批队列
 * 
 * 生命周期: pending → approved → executed
 *                   → rejected
 *           pending → expired (超时未审批)
 */
const actionSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // 操作类型
  type: {
    type: String,
    enum: [
      'create_campaign', 'create_adset', 'create_ad',
      'adjust_budget', 'pause', 'resume',
      'update_targeting', 'update_creative',
    ],
    required: true,
  },

  // 平台和目标实体
  platform: { type: String, enum: ['facebook', 'tiktok'], required: true },
  accountId: { type: String, default: '' },
  entityId: String,    // campaignId / adsetId / adId
  entityName: String,

  // 操作参数（Agent 生成）
  params: { type: mongoose.Schema.Types.Mixed, required: true },

  // Agent 给出的原因
  reason: { type: String, required: true },

  // 审批状态
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'executed', 'failed', 'expired'],
    default: 'pending',
    index: true,
  },

  // 执行结果
  result: mongoose.Schema.Types.Mixed,
  executedAt: Date,
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: Date,
  reviewNote: String,
}, { timestamps: true })

actionSchema.index({ userId: 1, status: 1, createdAt: -1 })

export const Action = mongoose.model('Action', actionSchema)
