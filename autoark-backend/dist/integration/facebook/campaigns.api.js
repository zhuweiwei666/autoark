"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchCampaigns = void 0;
const facebookClient_1 = require("./facebookClient");
const accountId_1 = require("../../utils/accountId");
const fetchCampaigns = async (accountId, token) => {
    // 确保 accountId 格式正确（添加 act_ 前缀）
    const apiAccountId = (0, accountId_1.normalizeForApi)(accountId);
    const params = {
        fields: 'id,name,objective,status,created_time,updated_time,buying_type,daily_budget,budget_remaining,lifetime_budget,start_time,stop_time,bid_strategy,bid_amount,account_id,special_ad_categories,source_campaign_id,promoted_object',
        limit: 1000,
    };
    if (token) {
        params.access_token = token;
    }
    const res = await facebookClient_1.facebookClient.get(`/${apiAccountId}/campaigns`, params);
    return res.data || [];
};
exports.fetchCampaigns = fetchCampaigns;
