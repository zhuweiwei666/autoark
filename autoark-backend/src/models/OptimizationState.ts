import mongoose from 'mongoose'

const optimizationStateSchema = new mongoose.Schema(
  {
    entityType: {
      type: String,
      required: true,
      enum: ['account', 'campaign', 'adset', 'ad'],
    },
    entityId: { type: String, required: true },
    accountId: { type: String, required: true, index: true },

    // 当前状态
    currentBudget: Number,
    targetRoas: Number,
    status: String,
    bidAmount: Number,

    // 优化动作记录
    lastAction: String,
    lastActionTime: Date,
    lastCheckTime: Date,
  },
  { timestamps: true }
)

// 唯一索引：entityType + entityId
optimizationStateSchema.index({ entityType: 1, entityId: 1 }, { unique: true })

export default mongoose.model('OptimizationState', optimizationStateSchema)

