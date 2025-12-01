import mongoose from 'mongoose';

const campaignSchema = new mongoose.Schema({
  channel: String,
  accountId: String,
  campaignId: String,
  name: String,
  objective: String,
  raw: Object,
}, { timestamps: true });

export default mongoose.model('Campaign', campaignSchema);

