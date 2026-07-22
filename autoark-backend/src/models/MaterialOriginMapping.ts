import mongoose from 'mongoose'

const materialOriginMappingSchema = new mongoose.Schema({
  provider: {
    type: String,
    required: true,
    enum: ['guangdada'],
    default: 'guangdada',
  },
  providerAssetKey: { type: String, required: true },
  materialId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Material',
    required: true,
  },
  packageKey: { type: String, required: true },
  packageName: { type: String },
  productName: { type: String },
  advertiserName: { type: String },
  mediaType: {
    type: String,
    required: true,
    enum: ['image', 'video'],
  },
  mediaRole: { type: String, required: true },
  mediaIndex: { type: Number, required: true },
  firstSeenAt: { type: Date, required: true },
  lastSeenAt: { type: Date, required: true },
  heat: { type: Number },
  estimatedValue: { type: Number },
  sourcePageUrl: { type: String },
  lastMediaUrl: { type: String },
})

materialOriginMappingSchema.index(
  { provider: 1, providerAssetKey: 1 },
  { unique: true },
)
materialOriginMappingSchema.index({ provider: 1, packageKey: 1, lastSeenAt: -1 })
materialOriginMappingSchema.index({ materialId: 1, provider: 1 })

export default mongoose.model('MaterialOriginMapping', materialOriginMappingSchema)
