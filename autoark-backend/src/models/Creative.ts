import mongoose from 'mongoose';

const creativeSchema = new mongoose.Schema({
  channel: String,
  creativeId: String,
  type: String,
  hash: String,
  storageUrl: String,
  duration: Number,
  width: Number,
  height: Number,
  tags: [String],
  createdBy: String,
}, { timestamps: true });

export default mongoose.model('Creative', creativeSchema);

