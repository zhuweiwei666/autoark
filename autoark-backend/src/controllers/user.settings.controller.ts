import { Request, Response, NextFunction } from 'express'
import * as userSettingsService from '../services/user.settings.service'

const getUserId = (req: Request): string => {
  if (!req.user?.userId) {
    throw Object.assign(new Error('未认证'), { statusCode: 401 })
  }
  return req.user.userId
}

export const getCampaignColumns = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const columns = await userSettingsService.getCampaignColumnSettings(getUserId(req))
    res.json({
      success: true,
      data: columns,
    })
  } catch (error) {
    next(error)
  }
}

export const saveCampaignColumns = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { columns } = req.body
    if (!Array.isArray(columns)) {
      return res.status(400).json({ success: false, message: 'Columns must be an array.' })
    }
    const savedColumns = await userSettingsService.saveCampaignColumnSettings(getUserId(req), columns)
    res.json({
      success: true,
      message: 'Campaign columns saved successfully.',
      data: savedColumns,
    })
  } catch (error) {
    next(error)
  }
}
