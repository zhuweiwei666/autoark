import { Router } from 'express'
import * as facebookController from '../controllers/facebook.controller'
import { saveFacebookToken } from '../controllers/facebookToken.controller'

const router = Router()

router.post('/save-token', saveFacebookToken) // New token saving route
router.get('/accounts', facebookController.getAccounts)
router.get('/accounts/:id/campaigns', facebookController.getCampaigns)
router.get('/accounts/:id/adsets', facebookController.getAdSets)
router.get('/accounts/:id/ads', facebookController.getAds)
router.get('/accounts/:id/insights/daily', facebookController.getInsightsDaily)

export default router

