"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const facebookController = __importStar(require("../controllers/facebook.controller"));
const facebookToken_controller_1 = require("../controllers/facebookToken.controller");
const router = (0, express_1.Router)();
router.post('/save-token', facebookToken_controller_1.saveFacebookToken); // New token saving route
router.get('/accounts', facebookController.getAccounts);
router.get('/accounts-list', facebookController.getAccountsList); // New: Account management list
router.post('/accounts/sync', facebookController.syncAccounts); // New: Trigger sync
// Campaign management
router.get('/campaigns-list', facebookController.getCampaignsList); // New: Campaign management list
router.post('/campaigns/sync', facebookController.syncCampaigns); // New: Trigger sync
router.get('/queue/status', facebookController.getQueueStatus); // New: Get queue status
router.get('/diagnose', facebookController.diagnoseTokens); // New: Diagnose token permissions
router.get('/token-pool/status', facebookController.getTokenPoolStatus); // New: Get token pool status
router.get('/purchase-value-info', facebookController.getPurchaseValueInfo); // New: Get purchase value info for tooltip
// Pixel routes
const pixelsController = __importStar(require("../controllers/facebook.pixels.controller"));
router.get('/pixels', pixelsController.getPixels); // Get all pixels
router.get('/pixels/:id', pixelsController.getPixelDetails); // Get pixel details
router.get('/pixels/:id/events', pixelsController.getPixelEvents); // Get pixel events
// OAuth routes
const oauthController = __importStar(require("../controllers/facebook.oauth.controller"));
router.get('/oauth/login-url', oauthController.getLoginUrl); // Get Facebook login URL
router.get('/oauth/callback', oauthController.handleCallback); // OAuth callback handler
router.get('/oauth/config', oauthController.getOAuthConfig); // Get OAuth config status
// AI routes
const aiController = __importStar(require("../controllers/ai.controller"));
router.post('/campaigns/:campaignId/ai-suggestion', aiController.generateAiSuggestion); // Generate suggestion
router.get('/ai-suggestions', aiController.getAiSuggestions); // Get history
router.post('/ai-suggestions/:id/apply', aiController.applyAiSuggestion); // Apply suggestion
router.get('/accounts/:id/campaigns', facebookController.getCampaigns);
router.get('/accounts/:id/adsets', facebookController.getAdSets);
router.get('/accounts/:id/ads', facebookController.getAds);
router.get('/accounts/:id/insights/daily', facebookController.getInsightsDaily);
exports.default = router;
