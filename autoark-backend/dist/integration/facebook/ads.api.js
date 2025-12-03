"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchCreatives = exports.fetchAds = exports.fetchAdSets = void 0;
const facebookClient_1 = require("./facebookClient");
const fetchAdSets = async (accountId) => {
    const res = await facebookClient_1.facebookClient.get(`/${accountId}/adsets`, {
        fields: 'id,name,status,campaign_id,optimization_goal,billing_event,bid_amount,daily_budget,created_time,updated_time',
        limit: 1000,
    });
    return res.data || [];
};
exports.fetchAdSets = fetchAdSets;
const fetchAds = async (accountId, token) => {
    const params = {
        fields: 'id,name,status,adset_id,campaign_id,creative{id},created_time,updated_time',
        limit: 1000,
    };
    if (token) {
        params.access_token = token;
    }
    const res = await facebookClient_1.facebookClient.get(`/${accountId}/ads`, params);
    return res.data || [];
};
exports.fetchAds = fetchAds;
const fetchCreatives = async (accountId) => {
    const res = await facebookClient_1.facebookClient.get(`/${accountId}/adcreatives`, {
        fields: 'id,name,object_story_spec,thumbnail_url,image_url,status', // simplified fields
        limit: 500,
    });
    return res.data || [];
};
exports.fetchCreatives = fetchCreatives;
