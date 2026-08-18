import mongoose, { Document, Schema } from 'mongoose'
import { MetaInsightsAuthorizationType } from './MetaInsightsFact'

export type MetaInsightsCoverageStatus = 'fresh' | 'stale' | 'unavailable'

export interface IMetaInsightsCoverage extends Document {
  provider: 'facebook'
  date: string
  accountId: string
  status: MetaInsightsCoverageStatus
  hasSnapshot: boolean
  factRows: number
  lastAttemptAt: Date
  lastSuccessAt?: Date
  lastFailureAt?: Date
  nextRetryAt?: Date
  attemptCount: number
  consecutiveFailures: number
  lastErrorCode?: number
  lastErrorSubcode?: number
  lastErrorMessage?: string
  authorizationType?: MetaInsightsAuthorizationType
  authorizationId?: string
  sourceApiVersion?: string
  frozenAt?: Date
  createdAt: Date
  updatedAt: Date
}

const metaInsightsCoverageSchema = new Schema<IMetaInsightsCoverage>(
  {
    provider: {
      type: String,
      enum: ['facebook'],
      default: 'facebook',
      required: true,
    },
    date: { type: String, required: true, index: true },
    accountId: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['fresh', 'stale', 'unavailable'],
      required: true,
      index: true,
    },
    hasSnapshot: { type: Boolean, default: false },
    factRows: { type: Number, default: 0 },
    lastAttemptAt: { type: Date, required: true },
    lastSuccessAt: { type: Date },
    lastFailureAt: { type: Date },
    nextRetryAt: { type: Date, index: true },
    attemptCount: { type: Number, default: 0 },
    consecutiveFailures: { type: Number, default: 0 },
    lastErrorCode: { type: Number },
    lastErrorSubcode: { type: Number },
    lastErrorMessage: { type: String, maxlength: 500 },
    authorizationType: {
      type: String,
      enum: ['system_user', 'personal', 'unknown'],
    },
    authorizationId: { type: String },
    sourceApiVersion: { type: String },
    frozenAt: { type: Date, index: true },
  },
  { timestamps: true },
)

metaInsightsCoverageSchema.index(
  { provider: 1, date: 1, accountId: 1 },
  { unique: true },
)
metaInsightsCoverageSchema.index({
  provider: 1,
  status: 1,
  nextRetryAt: 1,
  date: 1,
})
metaInsightsCoverageSchema.index({ provider: 1, accountId: 1, date: 1 })
metaInsightsCoverageSchema.index({ provider: 1, frozenAt: 1, date: 1 })

// Intentionally no TTL: coverage is required to prove completeness and find gaps.
export default mongoose.model<IMetaInsightsCoverage>(
  'MetaInsightsCoverage',
  metaInsightsCoverageSchema,
)
