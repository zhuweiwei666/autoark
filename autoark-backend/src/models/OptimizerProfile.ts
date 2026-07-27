import mongoose from 'mongoose'

const optimizerProfileSchema = new mongoose.Schema(
  {
    scopeKey: { type: String, required: true },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
    },
    optimizerId: { type: String, required: true, index: true },
    displayName: { type: String, required: true },
    tokenIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FbToken' }],
    accountIds: [{ type: String }],
    latestPlaybookId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PlaybookVersion',
    },
    versionCounter: { type: Number, default: 0 },
    lastGeneratedAt: Date,
    lastSourceSyncedAt: Date,
    lastEligibility: {
      eligible: { type: Boolean, default: false },
      blockers: [{ type: String }],
      warnings: [{ type: String }],
    },
  },
  { timestamps: true },
)

optimizerProfileSchema.index({ scopeKey: 1, optimizerId: 1 }, { unique: true })
optimizerProfileSchema.index({ organizationId: 1, lastGeneratedAt: -1 })

export default mongoose.model('OptimizerProfile', optimizerProfileSchema)
