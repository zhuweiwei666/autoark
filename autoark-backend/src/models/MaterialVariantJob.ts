import mongoose from 'mongoose'

export const MATERIAL_VARIANT_JOB_STATUSES = [
  'submitting',
  'submission_unknown',
  'queued',
  'processing',
  'completed',
  'failed',
  'cancelled',
] as const

const materialVariantJobSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
    },
    scopeKey: { type: String, required: true },
    parentMaterialId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Material',
      required: true,
      index: true,
    },
    outputMaterialId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Material',
      index: true,
    },
    createdBy: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: MATERIAL_VARIANT_JOB_STATUSES,
      default: 'submitting',
      required: true,
      index: true,
    },
    idempotencyKey: { type: String, required: true },
    upstreamIdempotencyKey: { type: String, required: true },
    requestFingerprint: { type: String, required: true },
    externalId: { type: String, required: true, unique: true },
    generationJobId: { type: String, unique: true, sparse: true },
    input: {
      sourceVideoUrl: { type: String, required: true },
      prompt: { type: String, required: true },
      negativePrompt: { type: String },
      referenceImageUrl: { type: String },
      durationSeconds: { type: Number, required: true },
      frameRate: { type: Number, required: true },
      strength: { type: Number, required: true },
      preserveAudio: { type: Boolean, required: true },
      aspectRatio: { type: String, required: true },
      seed: { type: Number },
    },
    generation: {
      service: { type: String, default: 'ai-host-v2' },
      provider: { type: String },
      capability: { type: String, default: 'video_edit' },
      priority: { type: Number, default: 20 },
      resultUrlPolicy: { type: String, default: 'permanent' },
    },
    output: {
      resultUrl: { type: String },
      metadata: { type: mongoose.Schema.Types.Mixed },
    },
    error: {
      code: { type: String },
      message: { type: String },
    },
    callback: {
      lastDeliveryId: { type: String },
      lastFingerprint: { type: String },
      receivedAt: { type: Date },
      attempt: { type: Number },
    },
  },
  { timestamps: true },
)

materialVariantJobSchema.index(
  { scopeKey: 1, idempotencyKey: 1 },
  { unique: true },
)
materialVariantJobSchema.index({ parentMaterialId: 1, createdAt: -1 })
materialVariantJobSchema.index({ organizationId: 1, status: 1, createdAt: -1 })

export default mongoose.model('MaterialVariantJob', materialVariantJobSchema)
