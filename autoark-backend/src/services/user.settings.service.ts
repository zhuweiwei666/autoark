import UserSettings from '../models/UserSettings'
import logger from '../utils/logger'

export const getCampaignColumnSettings = async (userId: string): Promise<string[]> => {
  try {
    const settings = await UserSettings.findOne({ userId })
    if (settings && settings.campaignColumns) {
      return settings.campaignColumns
    }
    // 返回默认列（使用 Facebook 原始字段名）
    return [
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
