import UserSettings from '../models/UserSettings'
import logger from '../utils/logger'
import { pickSafeQueryString } from '../utils/pagination'

export const DEFAULT_CAMPAIGN_COLUMNS = [
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

const CAMPAIGN_COLUMN_MAX_COUNT = 120
const CAMPAIGN_COLUMN_MAX_LENGTH = 80
const CAMPAIGN_COLUMN_KEY_PATTERN = /^[A-Za-z0-9_.:-]+$/

export const sanitizeCampaignColumns = (columns: any[]): string[] => {
  const sanitized: string[] = []
  const seen = new Set<string>()

  for (const column of columns) {
    if (sanitized.length >= CAMPAIGN_COLUMN_MAX_COUNT) break

    const safeColumn = pickSafeQueryString(column, CAMPAIGN_COLUMN_MAX_LENGTH)
    if (!safeColumn || !CAMPAIGN_COLUMN_KEY_PATTERN.test(safeColumn)) continue
    if (seen.has(safeColumn)) continue

    seen.add(safeColumn)
    sanitized.push(safeColumn)
  }

  return sanitized
}

export const getCampaignColumnSettings = async (userId: string): Promise<string[]> => {
  try {
    const settings = await UserSettings.findOne({ userId })
    if (settings && settings.campaignColumns) {
      return sanitizeCampaignColumns(settings.campaignColumns)
    }
    // 返回默认列（使用 Facebook 原始字段名）
    return DEFAULT_CAMPAIGN_COLUMNS
  } catch (error: any) {
    logger.error(`Failed to get campaign column settings for user ${userId}: ${error.message}`)
    throw error
  }
}

export const saveCampaignColumnSettings = async (userId: string, columns: any[]): Promise<string[]> => {
  try {
    const sanitizedColumns = sanitizeCampaignColumns(columns)
    const settings = await UserSettings.findOneAndUpdate(
      { userId },
      { campaignColumns: sanitizedColumns },
      { upsert: true, new: true }
    )
    return sanitizeCampaignColumns(settings.campaignColumns || [])
  } catch (error: any) {
    logger.error(`Failed to save campaign column settings for user ${userId}: ${error.message}`)
    throw error
  }
}
