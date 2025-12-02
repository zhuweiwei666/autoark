import mongoose from 'mongoose'

const userSettingsSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  campaignColumns: {
    type: [String],
    default: [
      'name',
      'account_id',
      'status',
      'spend',
      'cpm',
      'ctr',
      'cpc',
      'mobile_app_install',
      'impressions',
      'clicks',
    ],
  },
})

export default mongoose.model('UserSettings', userSettingsSchema)
