import mongoose from 'mongoose'

export type AutomationJobType =
  | 'RUN_AGENT'
  | 'RUN_AGENT_AS_JOBS'
  | 'EXECUTE_AGENT_OPERATION'
  | 'PUBLISH_DRAFT'
  | 'RUN_FB_FULL_SYNC'
  | 'SYNC_FB_USER_ASSETS'

const automationJobSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['queued', 'running', 'completed', 'failed', 'cancelled'],
      default: 'queued',
      index: true,
    },

    // 幂等：同一个 key 只会有一个 job（重复创建将返回已存在的 job）
    idempotencyKey: { type: String, required: true, unique: true, index: true },

    // 归属（审计/隔离）
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
    createdBy: { type: String },
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentConfig' },

    // 执行载荷（确定性输入）
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },

    // 执行信息
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    lastError: { type: String },
    result: { type: mongoose.Schema.Types.Mixed },

    queuedAt: { type: Date, default: Date.now },
    startedAt: { type: Date },
    finishedAt: { type: Date },
  },
  { timestamps: true },
)

automationJobSchema.index({ organizationId: 1, createdAt: -1 })
automationJobSchema.index({ agentId: 1, createdAt: -1 })

export default mongoose.model('AutomationJob', automationJobSchema)

