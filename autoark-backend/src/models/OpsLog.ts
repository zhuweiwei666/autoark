import mongoose from 'mongoose';

const opsLogSchema = new mongoose.Schema({
  operator: String,
  channel: String,
  action: String,
  before: Object,
  after: Object,
  reason: String,
  related: Object,
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('OpsLog', opsLogSchema);

