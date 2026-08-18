import mongoose, { Document, Schema } from 'mongoose'

export type MetaInsightsAuthorizationType =
  | 'system_user'
  | 'personal'
  | 'unknown'

export interface IMetaInsightsFact extends Document {
  provider: 'facebook'
  date: string
  accountId: string
  accountName: string
  campaignId: string
  campaignName: string
  optimizer: string
  country: string
  spend: number
  revenue: number
  impressions: number
  clicks: number
  installs: number
  sourceHash: string
  snapshotId: string
  sourceApiVersion: string
  authorizationType: MetaInsightsAuthorizationType
  authorizationId?: string
  firstSeenAt: Date
  fetchedAt: Date
  createdAt: Date
  updatedAt: Date
}

const metaInsightsFactSchema = new Schema<IMetaInsightsFact>(
  {
    provider: {
      type: String,
      enum: ['facebook'],
      default: 'facebook',
      required: true,
    },
    date: { type: String, required: true, index: true },
    accountId: { type: String, required: true, index: true },
    accountName: { type: String, default: '' },
    campaignId: { type: String, required: true, index: true },
    campaignName: { type: String, default: '' },
    optimizer: { type: String, default: 'unknown', index: true },
    country: { type: String, default: 'unknown', index: true },
    spend: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    installs: { type: Number, default: 0 },
    sourceHash: { type: String, required: true },
    snapshotId: { type: String, required: true, index: true },
    sourceApiVersion: { type: String, default: '' },
    authorizationType: {
      type: String,
      enum: ['system_user', 'personal', 'unknown'],
      default: 'unknown',
    },
    authorizationId: { type: String },
    firstSeenAt: { type: Date, required: true },
    fetchedAt: { type: Date, required: true, index: true },
  },
  { timestamps: true },
)

metaInsightsFactSchema.index(
  { provider: 1, date: 1, accountId: 1, campaignId: 1, country: 1 },
  { unique: true },
)
metaInsightsFactSchema.index({ date: 1, accountId: 1, optimizer: 1 })
metaInsightsFactSchema.index({ date: 1, country: 1 })
metaInsightsFactSchema.index({ provider: 1, campaignId: 1, date: 1 })

// Intentionally no TTL: normalized daily facts are the permanent source of truth.
export default mongoose.model<IMetaInsightsFact>(
  'MetaInsightsFact',
  metaInsightsFactSchema,
)
