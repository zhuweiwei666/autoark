import mongoose from 'mongoose'
import type { ExternalMaterialProvider } from './ExternalMaterialSyncState'

export const EXTERNAL_MATERIAL_SYNC_MODES = [
  'scheduled',
  'backfill',
  'canary10',
  'canary100',
] as const

export type ExternalMaterialSyncMode =
  (typeof EXTERNAL_MATERIAL_SYNC_MODES)[number]

export const EXTERNAL_MATERIAL_SYNC_STATUSES = [
  'queued',
  'running',
  'completed',
  'failed',
  'deferred',
  'disabled',
] as const

export type ExternalMaterialSyncStatus =
  (typeof EXTERNAL_MATERIAL_SYNC_STATUSES)[number]

export const EXTERNAL_MATERIAL_ERROR_CATEGORIES = [
  'configuration',
  'authentication',
  'rate_limit',
  'server',
  'request',
  'network',
  'timeout',
  'cancelled',
  'response',
  'paused',
  'active_run',
  'lock_busy',
  'lock_lost',
  'queue',
  'ingestion_retry_exhausted',
  'unexpected',
] as const

export type ExternalMaterialErrorCategory =
  (typeof EXTERNAL_MATERIAL_ERROR_CATEGORIES)[number]

export interface ExternalMaterialSyncCounters {
  discovered: number
  considered: number
  alreadySeen: number
  downloaded: number
  contentReused: number
  newlyCreated: number
  invalid: number
  failed: number
  deferred: number
}

export interface IExternalMaterialSyncRun extends mongoose.Document {
  provider: ExternalMaterialProvider
  mode: ExternalMaterialSyncMode
  dryRun: boolean
  request: {
    recentDays: number
    limit: number
  }
  status: ExternalMaterialSyncStatus
  cursor?: string | null
  deferredUntil?: Date | null
  retryAfterMs?: number | null
  deferCount: number
  continuationPending: boolean
  continuationGeneration: number
  continuationJobId?: string | null
  continuationDueAt?: Date | null
  resumeRequired: boolean
  executionClaimJobId?: string | null
  executionClaimAttempt?: number | null
  executionClaimDeferCount?: number | null
  executionClaimToken?: string | null
  executionClaimGeneration?: number | null
  executionClaimExpiresAt?: Date | null
  startedAt?: Date | null
  completedAt?: Date | null
  counters: ExternalMaterialSyncCounters
  errorSamples: Array<{
    category: ExternalMaterialErrorCategory
    at?: Date
  }>
  createdAt: Date
  updatedAt: Date
}

const counterField = {
  type: Number,
  required: true,
  default: 0,
  min: 0,
  max: 10_000_000,
}

const externalMaterialSyncRunSchema =
  new mongoose.Schema<IExternalMaterialSyncRun>(
    {
      provider: {
        type: String,
        enum: ['guangdada'],
        required: true,
        default: 'guangdada',
      },
      mode: {
        type: String,
        enum: EXTERNAL_MATERIAL_SYNC_MODES,
        required: true,
      },
      dryRun: {
        type: Boolean,
        required: true,
        default: false,
      },
      request: {
        recentDays: {
          type: Number,
          required: true,
          min: 1,
          max: 365,
        },
        limit: {
          type: Number,
          required: true,
          min: 1,
          max: 2000,
        },
      },
      status: {
        type: String,
        enum: EXTERNAL_MATERIAL_SYNC_STATUSES,
        required: true,
        default: 'queued',
      },
      cursor: {
        type: String,
        trim: true,
        maxlength: 128,
        match: /^[A-Za-z0-9._:-]+$/,
        default: null,
      },
      deferredUntil: {
        type: Date,
        default: null,
      },
      retryAfterMs: {
        type: Number,
        min: 60_000,
        max: 60 * 60 * 1000,
        default: null,
      },
      deferCount: {
        type: Number,
        required: true,
        min: 0,
        max: 3,
        default: 0,
      },
      continuationPending: {
        type: Boolean,
        required: true,
        default: false,
      },
      continuationGeneration: {
        type: Number,
        required: true,
        min: 0,
        max: 1_000_000,
        default: 0,
      },
      continuationJobId: {
        type: String,
        trim: true,
        maxlength: 200,
        match: /^[A-Za-z0-9_-]+$/,
        default: null,
      },
      continuationDueAt: {
        type: Date,
        default: null,
      },
      resumeRequired: {
        type: Boolean,
        required: true,
        default: false,
      },
      executionClaimJobId: {
        type: String,
        trim: true,
        maxlength: 200,
        match: /^[A-Za-z0-9_-]+$/,
        default: null,
      },
      executionClaimAttempt: {
        type: Number,
        min: 0,
        max: 100,
        validate: {
          validator: (value: number | null) =>
            value === null || Number.isInteger(value),
          message: 'executionClaimAttempt must be an integer',
        },
        default: null,
      },
      executionClaimDeferCount: {
        type: Number,
        min: 0,
        max: 3,
        validate: {
          validator: (value: number | null) =>
            value === null || Number.isInteger(value),
          message: 'executionClaimDeferCount must be an integer',
        },
        default: null,
      },
      executionClaimToken: {
        type: String,
        trim: true,
        maxlength: 64,
        match: /^[A-Za-z0-9_-]+$/,
        default: null,
      },
      executionClaimGeneration: {
        type: Number,
        min: 0,
        max: 1_000_000,
        validate: {
          validator: (value: number | null) =>
            value === null || Number.isInteger(value),
          message: 'executionClaimGeneration must be an integer',
        },
        default: null,
      },
      executionClaimExpiresAt: {
        type: Date,
        default: null,
      },
      startedAt: {
        type: Date,
        default: null,
      },
      completedAt: {
        type: Date,
        default: null,
      },
      counters: {
        discovered: counterField,
        considered: counterField,
        alreadySeen: counterField,
        downloaded: counterField,
        contentReused: counterField,
        newlyCreated: counterField,
        invalid: counterField,
        failed: counterField,
        deferred: counterField,
      },
      errorSamples: {
        type: [
          {
            category: {
              type: String,
              enum: EXTERNAL_MATERIAL_ERROR_CATEGORIES,
              required: true,
            },
            at: {
              type: Date,
              default: Date.now,
            },
            _id: false,
          },
        ],
        default: [],
        validate: {
          validator: (samples: unknown[]) => samples.length <= 5,
          message: 'too_many_error_samples',
        },
      },
    },
    {
      timestamps: true,
      strict: true,
    },
  )

externalMaterialSyncRunSchema.index(
  { provider: 1 },
  {
    unique: true,
    name: 'uniq_external_material_active_provider',
    partialFilterExpression: {
      $or: [
        { status: { $in: ['queued', 'running'] } },
        { status: 'deferred', continuationPending: true },
      ],
    },
  },
)
externalMaterialSyncRunSchema.index(
  { provider: 1, createdAt: -1 },
  { name: 'external_material_recent_runs' },
)

export default mongoose.model<IExternalMaterialSyncRun>(
  'ExternalMaterialSyncRun',
  externalMaterialSyncRunSchema,
)
