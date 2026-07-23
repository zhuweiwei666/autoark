import mongoose from 'mongoose'

export type ExternalMaterialProvider = 'guangdada'

export interface IExternalMaterialSyncState extends mongoose.Document {
  provider: ExternalMaterialProvider
  paused: boolean
  pauseReason?: string | null
  recurringEnabled: boolean
  backfillCursor?: string | null
  createdAt: Date
  updatedAt: Date
}

const externalMaterialSyncStateSchema =
  new mongoose.Schema<IExternalMaterialSyncState>(
    {
      provider: {
        type: String,
        enum: ['guangdada'],
        required: true,
        default: 'guangdada',
      },
      paused: {
        type: Boolean,
        required: true,
        default: false,
      },
      pauseReason: {
        type: String,
        trim: true,
        maxlength: 120,
        match: /^[a-z0-9_.:-]+$/,
        default: null,
      },
      recurringEnabled: {
        type: Boolean,
        required: true,
        default: true,
      },
      backfillCursor: {
        type: String,
        trim: true,
        maxlength: 128,
        match: /^[A-Za-z0-9._:-]+$/,
        default: null,
      },
    },
    {
      timestamps: true,
      strict: true,
    },
  )

externalMaterialSyncStateSchema.index(
  { provider: 1 },
  { unique: true, name: 'uniq_external_material_sync_state_provider' },
)

export default mongoose.model<IExternalMaterialSyncState>(
  'ExternalMaterialSyncState',
  externalMaterialSyncStateSchema,
)
