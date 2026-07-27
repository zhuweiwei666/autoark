import mongoose from 'mongoose'

export const PLAYBOOK_GENERATION_STATUSES = [
  'queued',
  'running',
  'completed',
  'failed',
] as const

const playbookGenerationSchema = new mongoose.Schema(
  {
    scopeKey: { type: String, required: true, index: true },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
    },
    optimizerId: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: PLAYBOOK_GENERATION_STATUSES,
      default: 'queued',
      required: true,
      index: true,
    },
    // Present only while queued/running. The sparse unique index makes
    // generation single-flight per organization and optimizer.
    activeKey: { type: String },
    windowDays: { type: Number, required: true },
    refreshInsights: { type: Boolean, default: true },
    generatedBy: String,
    playbookId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PlaybookVersion',
      index: true,
    },
    requestedAt: { type: Date, default: Date.now, required: true },
    startedAt: Date,
    completedAt: Date,
    error: String,
  },
  { timestamps: true },
)

playbookGenerationSchema.index({ activeKey: 1 }, { unique: true, sparse: true })
playbookGenerationSchema.index({ organizationId: 1, createdAt: -1 })
playbookGenerationSchema.index({ scopeKey: 1, optimizerId: 1, createdAt: -1 })

export default mongoose.model('PlaybookGeneration', playbookGenerationSchema)
