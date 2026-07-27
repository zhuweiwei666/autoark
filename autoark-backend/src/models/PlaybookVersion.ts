import mongoose from 'mongoose'

const playbookVersionSchema = new mongoose.Schema(
  {
    profileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OptimizerProfile',
      required: true,
      index: true,
    },
    scopeKey: { type: String, required: true, index: true, immutable: true },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
      immutable: true,
    },
    optimizerId: { type: String, required: true, index: true, immutable: true },
    version: { type: Number, required: true, immutable: true },
    status: { type: String, enum: ['ready', 'blocked'], required: true },
    generatedAt: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
    },
    generatedBy: { type: String, immutable: true },
    source: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      immutable: true,
    },
    coverage: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      immutable: true,
    },
    eligibility: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      immutable: true,
    },
    confidence: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      immutable: true,
    },
    baseline: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      immutable: true,
    },
    structure: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      immutable: true,
    },
    targeting: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      immutable: true,
    },
    geography: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      immutable: true,
    },
    placements: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      immutable: true,
    },
    hours: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      immutable: true,
    },
    creatives: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      immutable: true,
    },
    copywriting: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      immutable: true,
    },
    guardrails: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      immutable: true,
    },
  },
  { timestamps: true },
)

playbookVersionSchema.index({ profileId: 1, version: 1 }, { unique: true })
playbookVersionSchema.index({
  organizationId: 1,
  optimizerId: 1,
  generatedAt: -1,
})

export default mongoose.model('PlaybookVersion', playbookVersionSchema)
