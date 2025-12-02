import UserSettings from '../models/UserSettings'
import logger from '../utils/logger'

export const getCampaignColumnSettings = async (userId: string): Promise<string[]> => {
  try {
    const settings = await UserSettings.findOne({ userId })
    if (settings && settings.campaignColumns) {
      return settings.campaignColumns
    }
    // 返回默认列
    return [
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
    ]
  } catch (error: any) {
    logger.error(`Failed to get campaign column settings for user ${userId}: ${error.message}`)
    throw error
  }
}

export const saveCampaignColumnSettings = async (userId: string, columns: string[]): Promise<string[]> => {
  try {
    const settings = await UserSettings.findOneAndUpdate(
      { userId },
      { campaignColumns: columns },
      { upsert: true, new: true }
    )
    return settings.campaignColumns || []
  } catch (error: any) {
    logger.error(`Failed to save campaign column settings for user ${userId}: ${error.message}`)
    throw error
  }
}
