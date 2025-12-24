"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateTiktokAd = exports.updateTiktokAdGroup = exports.updateTiktokCampaign = void 0;
const tiktokClient_1 = require("./tiktokClient");
/**
 * TikTok Campaign API
 */
const updateTiktokCampaign = async (advertiserId, campaignId, data, accessToken) => {
    return tiktokClient_1.tiktokClient.post('/campaign/update/', {
        advertiser_id: advertiserId,
        campaign_id: campaignId,
        ...data
    }, accessToken);
};
exports.updateTiktokCampaign = updateTiktokCampaign;
/**
 * TikTok AdGroup API
 */
const updateTiktokAdGroup = async (advertiserId, adgroupId, data, accessToken) => {
    return tiktokClient_1.tiktokClient.post('/adgroup/update/', {
        advertiser_id: advertiserId,
        adgroup_id: adgroupId,
        ...data
    }, accessToken);
};
exports.updateTiktokAdGroup = updateTiktokAdGroup;
/**
 * TikTok Ad API
 */
const updateTiktokAd = async (advertiserId, adId, data, accessToken) => {
    return tiktokClient_1.tiktokClient.post('/ad/update/', {
        advertiser_id: advertiserId,
        ad_id: adId,
        ...data
    }, accessToken);
};
exports.updateTiktokAd = updateTiktokAd;
