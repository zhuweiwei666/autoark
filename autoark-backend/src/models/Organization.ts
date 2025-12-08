import mongoose from 'mongoose'

export enum OrganizationStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
}

export interface IOrganization extends mongoose.Document {
  name: string
  description?: string
  adminId: mongoose.Types.ObjectId // 组织负责人
  status: OrganizationStatus
  settings?: {
    maxMembers?: number // 最大成员数限制
    features?: string[] // 可用功能列表
  }
  createdBy: mongoose.Types.ObjectId
}

const organizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
      index: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(OrganizationStatus),
      default: OrganizationStatus.ACTIVE,
      required: true,
    },
    settings: {
      maxMembers: {
        type: Number,
        default: 50,
      },
      features: {
        type: [String],
        default: [],
      },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
)

// 索引
organizationSchema.index({ status: 1 })
organizationSchema.index({ adminId: 1 })

export default mongoose.model<IOrganization>('Organization', organizationSchema)
