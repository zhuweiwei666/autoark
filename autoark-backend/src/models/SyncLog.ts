import mongoose from 'mongoose'

const syncLogSchema = new mongoose.Schema(
  {
    startTime: { type: Date, required: true },
    endTime: Date,
    channel: { type: String, default: 'facebook' }, // 'facebook' | 'tiktok'
    status: {
      type: String,
      enum: ['RUNNING', 'SUCCESS', 'FAILED'],
      default: 'RUNNING',
    },
    details: Object, // Summary of what was synced
    error: String,
  },
  { timestamps: true },
)

export default mongoose.model('SyncLog', syncLogSchema)
