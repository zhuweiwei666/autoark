import mongoose from 'mongoose'

const creativeFactoryJobSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
    },
    batchId: { type: String, required: true, index: true },
    variantId: { type: String, required: true },
    title: { type: String, required: true },
    intent: { type: String, required: true },
    brandKey: { type: String, default: 'clingai' },
    templateKey: { type: String, index: true },
    templateVersion: { type: Number },
    workflow: {
      type: String,
      enum: ['generate_then_edit', 'edit_only', 'extract_frame_then_edit'],
      required: true,
    },
    status: {
      type: String,
      enum: [
        'awaiting_codex',
        'generating',
        'codex_processing',
        'ready',
        'failed',
      ],
      default: 'awaiting_codex',
      index: true,
    },
    source: {
      materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'Material' },
      url: { type: String, required: true },
      mediaType: { type: String, enum: ['image', 'video'], required: true },
      name: { type: String },
    },
    styleReference: {
      materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'Material' },
      url: { type: String },
      mediaType: { type: String, enum: ['image', 'video'] },
      name: { type: String },
      analysis: {
        status: {
          type: String,
          enum: ['pending', 'completed', 'failed'],
          default: 'pending',
        },
        summary: { type: String },
        visualLanguage: { type: String },
        palette: [{ type: String }],
        typography: { type: String },
        layout: { type: String },
        hookPattern: { type: String },
        pacing: { type: String },
        transitions: { type: String },
        overlays: { type: String },
        callToAction: { type: String },
        audio: { type: String },
        generationPrompt: { type: String },
        avoid: [{ type: String }],
        extractedAt: { type: Date },
      },
    },
    requestedOutput: {
      mediaType: { type: String, enum: ['image', 'video'], required: true },
      aspectRatio: { type: String, default: '9:16' },
    },
    analysis: {
      intentSummary: { type: String },
      audience: { type: String },
      hook: { type: String },
      featureKey: { type: String },
      templateId: { type: String },
      rationale: { type: String },
      editRecipe: { type: mongoose.Schema.Types.Mixed },
    },
    aiHost: {
      status: { type: String, default: 'not_started' },
      generationId: { type: String },
      presetToken: { type: String },
      genJobId: { type: String },
      resultUrl: { type: String },
      landingUrl: { type: String },
      error: { type: String },
      updatedAt: { type: Date },
    },
    pipeline: {
      status: {
        type: String,
        enum: ['queued', 'processing', 'completed', 'failed'],
      },
      currentStep: { type: String },
      progressLabel: { type: String },
      steps: { type: mongoose.Schema.Types.Mixed, default: {} },
      attempts: { type: Number, default: 0 },
      nextAttemptAt: { type: Date },
      leaseOwner: { type: String },
      leaseUntil: { type: Date },
      lastError: { type: String },
      startedAt: { type: Date },
      completedAt: { type: Date },
    },
    codex: {
      status: {
        type: String,
        enum: ['queued', 'claimed', 'processing', 'completed', 'failed'],
        default: 'queued',
        index: true,
      },
      workerId: { type: String },
      leaseUntil: { type: Date },
      claimedAt: { type: Date },
      completedAt: { type: Date },
      notes: { type: String },
      outputs: [{ type: mongoose.Schema.Types.Mixed }],
    },
    outputMaterialId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Material',
      index: true,
    },
    attribution: {
      status: { type: String, enum: ['pending', 'linked'], default: 'pending' },
      mappings: [{ type: mongoose.Schema.Types.Mixed }],
      linkedAt: { type: Date },
    },
    error: { type: String },
    createdBy: { type: String, required: true },
  },
  { timestamps: true },
)

creativeFactoryJobSchema.index({ batchId: 1, variantId: 1 }, { unique: true })
creativeFactoryJobSchema.index({ organizationId: 1, createdAt: -1 })
creativeFactoryJobSchema.index({
  'codex.status': 1,
  'codex.leaseUntil': 1,
  createdAt: 1,
})

export default mongoose.model('CreativeFactoryJob', creativeFactoryJobSchema)
