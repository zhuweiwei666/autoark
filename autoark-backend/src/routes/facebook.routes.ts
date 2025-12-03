import { Router } from 'express'
import * as facebookController from '../controllers/facebook.controller'
import { saveFacebookToken } from '../controllers/facebookToken.controller'

const router = Router()

router.post('/save-token', saveFacebookToken) // New token saving route
router.get('/accounts', facebookController.getAccounts)
router.get('/accounts-list', facebookController.getAccountsList) // New: Account management list
router.post('/accounts/sync', facebookController.syncAccounts) // New: Trigger sync

// Campaign management
router.get('/campaigns-list', facebookController.getCampaignsList) // New: Campaign management list
router.post('/campaigns/sync', facebookController.syncCampaigns) // New: Trigger sync
router.get('/queue/status', facebookController.getQueueStatus) // New: Get queue status

// Country management
router.get('/countries-list', facebookController.getCountriesList) // New: Country management list

router.get('/accounts/:id/campaigns', facebookController.getCampaigns)
router.get('/accounts/:id/adsets', facebookController.getAdSets)
router.get('/accounts/:id/ads', facebookController.getAds)
router.get('/accounts/:id/insights/daily', facebookController.getInsightsDaily)

export default router
