"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchCampaigns = void 0;
const facebookClient_1 = require("./facebookClient");
const fetchCampaigns = async (accountId, token) => {
    const params = {
        fields: 'id,name,objective,status,created_time,updated_time,buying_type,daily_budget,budget_remaining,lifetime_budget,start_time,stop_time,bid_strategy,bid_amount,account_id,special_ad_categories,source_campaign_id,promoted_object',
        limit: 1000,
    };
    if (token) {
        params.access_token = token;
    }
    const res = await facebookClient_1.facebookClient.get(`/${accountId}/campaigns`, params);
    return res.data || [];
};
exports.fetchCampaigns = fetchCampaigns;
