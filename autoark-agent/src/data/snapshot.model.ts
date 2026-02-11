import mongoose from 'mongoose'

/**
 * 决策快照 - 每次流水线运行存一份
 */
const snapshotSchema = new mongoose.Schema({
  // 运行时间
  runAt: { type: Date, required: true, index: true },
  triggeredBy: { type: String, enum: ['cron', 'manual'], default: 'cron' },

  // 数据概要
  totalCampaigns: Number,
  classification: {
    loss_severe: Number,
    loss_mild: Number,
    observing: Number,
    stable_normal: Number,
    stable_good: Number,
    high_potential: Number,
    declining: Number,
  },

  // 汇总指标
  totalSpend: Number,
  totalRevenue: Number,
  overallRoas: Number,

  // LLM 生成的操作清单
  actions: [{
    type: { type: String }, // pause, increase_budget, decrease_budget
    campaignId: String,
    campaignName: String,
    accountId: String,
    reason: String,
    auto: Boolean,          // true=自动执行 false=需审批
    currentBudget: Number,
    newBudget: Number,
    executed: { type: Boolean, default: false },
    executedAt: Date,
    executionResult: mongoose.Schema.Types.Mixed,
  }],

  // LLM 的文字总结
  summary: String,
  alerts: [String],

  // 运行耗时
  durationMs: Number,
  status: { type: String, enum: ['running', 'completed', 'failed'], default: 'running' },
  error: String,
}, { timestamps: true })

snapshotSchema.index({ runAt: -1 })

export const Snapshot = mongoose.model('PipelineSnapshot', snapshotSchema)
