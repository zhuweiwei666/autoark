import mongoose from 'mongoose'

export const REPLICA_RUN_STATUSES = [
  'building',
  'blocked',
  'approval_required',
  'approved',
  'publishing',
  'published',
  'partial',
  'failed',
  'evaluating',
  'completed',
] as const

const replicaRunSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
    },
    scopeKey: { type: String, required: true, index: true },
    optimizerId: { type: String, required: true, index: true },
    profileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OptimizerProfile',
      required: true,
    },
    playbookVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PlaybookVersion',
      required: true,
      index: true,
    },
    playbookVersion: { type: Number, required: true },
    status: {
      type: String,
      enum: REPLICA_RUN_STATUSES,
      default: 'building',
      index: true,
    },
    source: { type: mongoose.Schema.Types.Mixed },
    targets: { type: mongoose.Schema.Types.Mixed, required: true },
    blueprint: { type: mongoose.Schema.Types.Mixed },
    aiChanges: [{ type: String }],
    creativeGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CreativeGroup',
    },
    copywritingPackageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CopywritingPackage',
    },
    draftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AdDraft',
      index: true,
    },
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AdTask',
      index: true,
    },
    validation: { type: mongoose.Schema.Types.Mixed },
    approval: {
      required: { type: Boolean, default: true },
      approvedBy: String,
      approvedAt: Date,
      note: String,
    },
    evaluation: { type: mongoose.Schema.Types.Mixed },
    blockedReasons: [{ type: String }],
    error: { type: String },
    createdBy: String,
    updatedBy: String,
  },
  { timestamps: true },
)

replicaRunSchema.index({ organizationId: 1, createdAt: -1 })
replicaRunSchema.index({ optimizerId: 1, createdAt: -1 })

export default mongoose.model('ReplicaRun', replicaRunSchema)
