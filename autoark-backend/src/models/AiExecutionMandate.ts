import mongoose from 'mongoose'

export const AI_EXECUTION_MANDATE_STATUSES = ['active', 'revoked'] as const

const mandateAccountSchema = new mongoose.Schema(
  {
    accountId: { type: String, required: true },
    accountName: String,
    currency: String,
    timezone: String,
    pageId: { type: String, required: true },
    pageName: String,
    instagramAccountId: String,
    pixelId: { type: String, required: true },
    pixelName: String,
    domain: String,
    conversionEvent: { type: String, default: 'PURCHASE' },
  },
  { _id: false },
)

const aiExecutionMandateSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
    },
    scopeKey: { type: String, required: true, index: true },
    name: { type: String, required: true },
    status: {
      type: String,
      enum: AI_EXECUTION_MANDATE_STATUSES,
      default: 'active',
      index: true,
    },
    playbookVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PlaybookVersion',
      required: true,
      index: true,
    },
    optimizerId: { type: String, required: true, index: true },
    sourceBoundary: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    authorizationType: {
      type: String,
      enum: ['system_user', 'personal_user'],
      default: 'personal_user',
      required: true,
      index: true,
    },
    metaCredentialId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MetaBusinessCredential',
      index: true,
    },
    facebookTokenId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FbToken',
      index: true,
    },
    facebookTokenOwnerUserId: String,
    accounts: {
      type: [mandateAccountSchema],
      required: true,
      validate: {
        validator: (accounts: any[]) =>
          Array.isArray(accounts) && accounts.length > 0,
        message: 'AI 投放授权单至少需要一个执行账户',
      },
    },
    targetingPackageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TargetingPackage',
      required: true,
    },
    creativeGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CreativeGroup',
      required: true,
    },
    copywritingPackageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CopywritingPackage',
      required: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    productSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    budget: {
      defaultDailyBudget: { type: Number, required: true },
      maximumDailyBudget: { type: Number, required: true },
      currency: { type: String, required: true },
    },
    readiness: {
      ready: { type: Boolean, required: true, default: false },
      checkedAt: { type: Date, required: true, default: Date.now },
      checks: { type: mongoose.Schema.Types.Mixed },
      warnings: [String],
    },
    permissions: {
      accountAssignment: {
        type: String,
        enum: ['admin_explicit'],
        default: 'admin_explicit',
      },
      metaWriteMode: {
        type: String,
        enum: ['paused_only'],
        default: 'paused_only',
      },
      automaticActivationAllowed: { type: Boolean, default: false },
      automaticScalingAllowed: { type: Boolean, default: false },
    },
    approvedBy: { type: String, required: true },
    approvedAt: { type: Date, required: true, default: Date.now },
    revokedBy: String,
    revokedAt: Date,
    revokeReason: String,
    createdBy: String,
    updatedBy: String,
  },
  { timestamps: true },
)

aiExecutionMandateSchema.pre('validate', function validateAuthorization() {
  const hasSystemCredential = Boolean(this.metaCredentialId)
  const hasPersonalToken = Boolean(this.facebookTokenId)
  if (
    this.authorizationType === 'system_user' &&
    (!hasSystemCredential || hasPersonalToken)
  ) {
    this.invalidate(
      'metaCredentialId',
      'System User 授权单必须且只能绑定一个 Meta Business Credential',
    )
  }
  if (
    this.authorizationType === 'personal_user' &&
    (!hasPersonalToken || hasSystemCredential)
  ) {
    this.invalidate(
      'facebookTokenId',
      '个人授权单必须且只能绑定一个 Facebook Token',
    )
  }
})

aiExecutionMandateSchema.index({
  organizationId: 1,
  playbookVersionId: 1,
  status: 1,
  createdAt: -1,
})
aiExecutionMandateSchema.index({
  organizationId: 1,
  facebookTokenId: 1,
  status: 1,
})
aiExecutionMandateSchema.index({
  organizationId: 1,
  metaCredentialId: 1,
  status: 1,
})
aiExecutionMandateSchema.index({
  'accounts.accountId': 1,
  status: 1,
})

export default mongoose.model('AiExecutionMandate', aiExecutionMandateSchema)
