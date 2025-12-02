import { Router } from 'express'
import * as userSettingsController from '../controllers/user.settings.controller'

const router = Router()

// 获取用户自定义的广告系列列设置
router.get('/campaign-columns', userSettingsController.getCampaignColumns)
// 保存用户自定义的广告系列列设置
router.post('/campaign-columns', userSettingsController.saveCampaignColumns)

export default router
