import { Request, Response, NextFunction } from 'express'
import * as userSettingsService from '../services/user.settings.service'

// 假设用户 ID 可以从请求中获取，例如通过认证中间件。
// 这里我们暂时模拟一个 userId。
const MOCK_USER_ID = 'user_autoark_test_id'

export const getCampaignColumns = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const columns = await userSettingsService.getCampaignColumnSettings(MOCK_USER_ID)
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
    const savedColumns = await userSettingsService.saveCampaignColumnSettings(MOCK_USER_ID, columns)
    res.json({
      success: true,
      message: 'Campaign columns saved successfully.',
      data: savedColumns,
    })
  } catch (error) {
    next(error)
  }
}
