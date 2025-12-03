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
router.get('/diagnose', facebookController.diagnoseTokens) // New: Diagnose token permissions
router.get('/token-pool/status', facebookController.getTokenPoolStatus) // New: Get token pool status
router.get('/purchase-value-info', facebookController.getPurchaseValueInfo) // New: Get purchase value info for tooltip

// Pixel routes
import * as pixelsController from '../controllers/facebook.pixels.controller'
router.get('/pixels', pixelsController.getPixels) // Get all pixels
router.get('/pixels/:id', pixelsController.getPixelDetails) // Get pixel details
router.get('/pixels/:id/events', pixelsController.getPixelEvents) // Get pixel events

// OAuth routes
import * as oauthController from '../controllers/facebook.oauth.controller'
router.get('/oauth/login-url', oauthController.getLoginUrl) // Get Facebook login URL
router.get('/oauth/callback', oauthController.handleCallback) // OAuth callback handler
router.get('/oauth/config', oauthController.getOAuthConfig) // Get OAuth config status

// AI routes
import * as aiController from '../controllers/ai.controller'
router.post('/campaigns/:campaignId/ai-suggestion', aiController.generateAiSuggestion) // Generate suggestion
router.get('/ai-suggestions', aiController.getAiSuggestions) // Get history
router.post('/ai-suggestions/:id/apply', aiController.applyAiSuggestion) // Apply suggestion

router.get('/accounts/:id/campaigns', facebookController.getCampaigns)
router.get('/accounts/:id/adsets', facebookController.getAdSets)
router.get('/accounts/:id/ads', facebookController.getAds)
router.get('/accounts/:id/insights/daily', facebookController.getInsightsDaily)

export default router
