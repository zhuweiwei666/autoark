import mongoose from 'mongoose'

export enum OrganizationStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
}

export enum OrganizationPlan {
  TRIAL = 'trial',
  STARTER = 'starter',
  GROWTH = 'growth',
  ENTERPRISE = 'enterprise',
}

export enum OrganizationBillingStatus {
  TRIALING = 'trialing',
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  PAUSED = 'paused',
  CANCELED = 'canceled',
}

export interface IOrganization extends mongoose.Document {
  name: string
  description?: string
  adminId: mongoose.Types.ObjectId // 组织负责人
  status: OrganizationStatus
  billing?: {
    plan?: OrganizationPlan
    status?: OrganizationBillingStatus
    seats?: number
    trialEndsAt?: Date
    currentPeriodEndsAt?: Date
    customerId?: string
    subscriptionId?: string
  }
  settings?: {
    maxMembers?: number // 最大成员数限制
    maxAdAccounts?: number
    maxMaterials?: number
    maxConcurrentTasks?: number
    monthlyTaskLimit?: number
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
    billing: {
      plan: {
        type: String,
        enum: Object.values(OrganizationPlan),
        default: OrganizationPlan.TRIAL,
        index: true,
      },
      status: {
        type: String,
        enum: Object.values(OrganizationBillingStatus),
        default: OrganizationBillingStatus.TRIALING,
        index: true,
      },
      seats: {
        type: Number,
        default: 3,
      },
      trialEndsAt: {
        type: Date,
      },
      currentPeriodEndsAt: {
        type: Date,
      },
      customerId: {
        type: String,
      },
      subscriptionId: {
        type: String,
      },
    },
    settings: {
      maxMembers: {
        type: Number,
        default: 50,
      },
      maxAdAccounts: {
        type: Number,
      },
      maxMaterials: {
        type: Number,
      },
      maxConcurrentTasks: {
        type: Number,
      },
      monthlyTaskLimit: {
        type: Number,
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
