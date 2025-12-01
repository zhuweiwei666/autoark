import mongoose from 'mongoose';

const accountSchema = new mongoose.Schema({
  channel: { type: String, required: true }, // 'facebook' / 'tiktok'
  accountId: { type: String, required: true },
  name: String,
  currency: String,
  timezone: String,
  operator: String, // 优化师
  token: String,
  status: String,
}, { timestamps: true });

export default mongoose.model('Account', accountSchema);

