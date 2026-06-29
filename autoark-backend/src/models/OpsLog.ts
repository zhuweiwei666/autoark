import mongoose from 'mongoose'

const opsLogSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  username: String,
  userEmail: String,
  userRole: String,
  category: { type: String, index: true },
  operator: String,
  channel: String,
  action: String,
  status: { type: String, enum: ['success', 'failed', 'warning'], default: 'success', index: true },
  targetType: String,
  targetId: String,
  summary: String,
  before: Object,
  after: Object,
  reason: String,
  related: Object,
  metadata: Object,
  requestId: { type: String, index: true },
  ip: String,
  userAgent: String,
  createdAt: { type: Date, default: Date.now },
})

opsLogSchema.index({ organizationId: 1, createdAt: -1 })
opsLogSchema.index({ category: 1, action: 1, createdAt: -1 })

export default mongoose.model('OpsLog', opsLogSchema)
