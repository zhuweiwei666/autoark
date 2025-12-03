"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchInsights = exports.fetchCreatives = exports.fetchAds = exports.fetchAdSets = exports.fetchCampaigns = exports.fetchUserAdAccounts = exports.fbClient = void 0;
// Re-export from integration layer
const facebookClient_1 = require("../integration/facebook/facebookClient");
const accounts_api_1 = require("../integration/facebook/accounts.api");
Object.defineProperty(exports, "fetchUserAdAccounts", { enumerable: true, get: function () { return accounts_api_1.fetchUserAdAccounts; } });
const campaigns_api_1 = require("../integration/facebook/campaigns.api");
Object.defineProperty(exports, "fetchCampaigns", { enumerable: true, get: function () { return campaigns_api_1.fetchCampaigns; } });
const ads_api_1 = require("../integration/facebook/ads.api");
Object.defineProperty(exports, "fetchAdSets", { enumerable: true, get: function () { return ads_api_1.fetchAdSets; } });
Object.defineProperty(exports, "fetchAds", { enumerable: true, get: function () { return ads_api_1.fetchAds; } });
Object.defineProperty(exports, "fetchCreatives", { enumerable: true, get: function () { return ads_api_1.fetchCreatives; } });
const insights_api_1 = require("../integration/facebook/insights.api");
Object.defineProperty(exports, "fetchInsights", { enumerable: true, get: function () { return insights_api_1.fetchInsights; } });
// Keep the same exports as before for compatibility
exports.fbClient = facebookClient_1.facebookClient;
