import mongoose from 'mongoose'

export const PRODUCT_LINK_PLATFORMS = ['ios', 'android'] as const
export const PRODUCT_LINK_POOL_STATUSES = ['active', 'inactive'] as const
export const PRODUCT_LINK_WEIGHT_MAX = 1000

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

const destinationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    platform: {
      type: String,
      enum: PRODUCT_LINK_PLATFORMS,
      required: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2048,
      validate: {
        validator: isHttpUrl,
        message: 'Destination URL must use http or https',
      },
    },
    weight: {
      type: Number,
      required: true,
      default: 100,
      min: 0,
      max: PRODUCT_LINK_WEIGHT_MAX,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
  },
  { _id: true },
)

const productLinkPoolSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
    shortCode: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      minlength: 6,
      maxlength: 32,
      match: /^[A-Za-z0-9_-]+$/,
    },
    fallbackUrl: {
      type: String,
      trim: true,
      maxlength: 2048,
      default: '',
      validate: {
        validator: (value: string) => !value || isHttpUrl(value),
        message: 'Fallback URL must use http or https',
      },
    },
    status: {
      type: String,
      enum: PRODUCT_LINK_POOL_STATUSES,
      default: 'active',
      index: true,
    },
    destinations: {
      type: [destinationSchema],
      default: [],
      validate: {
        validator: (value: unknown[]) => value.length <= 50,
        message: 'A product link pool supports at most 50 destinations',
      },
    },
    createdBy: {
      type: String,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
)

productLinkPoolSchema.index({ organizationId: 1, updatedAt: -1 })
productLinkPoolSchema.index({ status: 1, shortCode: 1 })

export default mongoose.model('ProductLinkPool', productLinkPoolSchema)
