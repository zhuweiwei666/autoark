import mongoose from 'mongoose'

const materialFavoriteSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },
    materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true, index: true },
  },
  { timestamps: true },
)

materialFavoriteSchema.index({ userId: 1, materialId: 1 }, { unique: true })

export default mongoose.model('MaterialFavorite', materialFavoriteSchema)
