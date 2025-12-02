import mongoose from 'mongoose'

const userSettingsSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  campaignColumns: {
    type: [String],
    default: [
      'name',
      'accountId',
      'status',
      'spend',
      'cpm',
      'ctr',
      'cpc',
      'installs',
      'cpi',
      'purchase_value',
      'roas',
      'event_conversions',
    ],
  },
})

export default mongoose.model('UserSettings', userSettingsSchema)
