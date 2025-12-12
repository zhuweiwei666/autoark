import { Router } from 'express'
import * as facebookController from '../controllers/facebook.controller'
import { saveFacebookToken } from '../controllers/facebookToken.controller'
import { authenticate } from '../middlewares/auth'

const router = Router()

// 大部分路由需要认证，但 OAuth callback 必须公开（Facebook 重定向不会带 Authorization header）
router.use((req, res, next) => {
  // OAuth 回调不需要认证
  if (req.path === '/oauth/callback') {
    return next()
  }
  return authenticate(req, res, next)
})

router.post('/save-token', saveFacebookToken) // New token saving route
router.get('/accounts', facebookController.getAccounts)
router.get('/accounts-list', facebookController.getAccountsList) // New: Account management list
router.post('/accounts/sync', facebookController.syncAccounts) // New: Trigger sync

// Campaign management
router.get('/campaigns-list', facebookController.getCampaignsList) // New: Campaign management list
router.post('/campaigns/sync', facebookController.syncCampaigns) // New: Trigger sync
router.put('/campaigns/:campaignId/status', facebookController.updateCampaignStatus) // Update campaign status

// Country management
router.get('/countries-list', facebookController.getCountriesList) // New: Country management list
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

// AI routes 已迁移到 /api/ai-suggestions

router.get('/accounts/:id/campaigns', facebookController.getCampaigns)
router.get('/accounts/:id/adsets', facebookController.getAdSets)
router.get('/accounts/:id/ads', facebookController.getAds)
router.get('/accounts/:id/insights/daily', facebookController.getInsightsDaily)

export default router
