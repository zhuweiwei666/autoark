import mongoose from 'mongoose'

export type MetaCredentialStatus =
  | 'provisioning'
  | 'active'
  | 'invalid'
  | 'inactive'

const assetGrantSchema = new mongoose.Schema(
  {
    assetId: { type: String, required: true },
    name: { type: String },
    tasks: [{ type: String }],
    source: {
      type: String,
      enum: ['owned', 'client', 'assigned', 'unknown'],
      default: 'unknown',
    },
    accountIds: [{ type: String }],
    accountStatus: { type: Number },
    currency: { type: String },
    timezoneName: { type: String },
    readbackVerifiedAt: { type: Date },
  },
  { _id: false },
)

const metaBusinessCredentialSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    facebookAppId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FacebookApp',
      required: true,
      index: true,
    },
    credentialType: {
      type: String,
      enum: ['system_user'],
      default: 'system_user',
      required: true,
    },
    status: {
      type: String,
      enum: ['provisioning', 'active', 'invalid', 'inactive'],
      default: 'provisioning',
      index: true,
    },
    isDefault: { type: Boolean, default: true, index: true },
    businessId: { type: String, required: true, index: true },
    businessName: { type: String },
    systemUserId: { type: String, required: true, index: true },
    systemUserName: { type: String, required: true },
    systemUserRole: {
      type: String,
      enum: ['EMPLOYEE', 'ADMIN'],
      default: 'EMPLOYEE',
    },
    tokenCiphertext: { type: String, required: true, select: false },
    tokenFingerprint: { type: String, required: true },
    scopes: [{ type: String }],
    expiresAt: { type: Date },
    lastValidatedAt: { type: Date },
    lastValidationError: { type: String },
    lastReconciledAt: { type: Date },
    assetGrants: {
      adAccounts: [assetGrantSchema],
      pages: [assetGrantSchema],
      pixels: [assetGrantSchema],
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: any) => {
        delete ret.tokenCiphertext
        return ret
      },
    },
    toObject: {
      virtuals: true,
      transform: (_doc, ret: any) => {
        delete ret.tokenCiphertext
        return ret
      },
    },
  },
)

metaBusinessCredentialSchema.index(
  { organizationId: 1, businessId: 1, systemUserId: 1, facebookAppId: 1 },
  { unique: true },
)
metaBusinessCredentialSchema.index({
  organizationId: 1,
  status: 1,
  isDefault: -1,
  updatedAt: -1,
})
metaBusinessCredentialSchema.index({ 'assetGrants.adAccounts.assetId': 1 })
metaBusinessCredentialSchema.index({ 'assetGrants.pages.assetId': 1 })
metaBusinessCredentialSchema.index({ 'assetGrants.pixels.assetId': 1 })

export default mongoose.model(
  'MetaBusinessCredential',
  metaBusinessCredentialSchema,
)
