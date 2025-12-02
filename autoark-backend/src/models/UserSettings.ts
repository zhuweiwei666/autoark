import mongoose from 'mongoose'

const userSettingsSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  campaignColumns: {
    type: [String],
    default: [
      'name',
      'accountId',
      'spend',
      'cpm',
      'ctr',
      'cpc',
      'cpi',
      'purchase_value',
      'roas',
      'event_conversions',
    ],
  },
})

export default mongoose.model('UserSettings', userSettingsSchema)
