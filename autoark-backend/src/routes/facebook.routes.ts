import { Router } from 'express'
import * as facebookController from '../controllers/facebook.controller'

const router = Router()

router.get('/accounts/:id/campaigns', facebookController.getCampaigns)
router.get('/accounts/:id/adsets', facebookController.getAdSets)
router.get('/accounts/:id/ads', facebookController.getAds)
router.get('/accounts/:id/insights/daily', facebookController.getInsightsDaily)

export default router
