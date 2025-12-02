"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchInsights = exports.fetchCreatives = exports.fetchAds = exports.fetchAdSets = exports.fetchCampaigns = exports.fetchUserAdAccounts = exports.fbClient = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../utils/logger"));
const fbToken_1 = require("../utils/fbToken");
const FB_API_VERSION = 'v19.0';
const FB_BASE_URL = 'https://graph.facebook.com';
const handleApiError = (context, error) => {
    const errMsg = error.response?.data?.error?.message || error.message;
    logger_1.default.error(`Facebook API Error [${context}]: ${errMsg}`, error.response?.data);
    throw new Error(`Facebook API [${context}] failed: ${errMsg}`);
};
exports.fbClient = {
    get: async (endpoint, params = {}) => {
        const startTime = Date.now();
        const url = `${FB_BASE_URL}/${FB_API_VERSION}${endpoint}`;
        try {
            const token = params.access_token || (await (0, fbToken_1.getFacebookAccessToken)());
            const res = await axios_1.default.get(url, {
                params: {
                    access_token: token,
                    ...params,
                },
            });
            logger_1.default.timerLog(`[Facebook API] GET ${endpoint}`, startTime);
            return res.data;
        }
        catch (error) {
            handleApiError(`GET ${endpoint}`, error);
        }
    },
};
const fetchUserAdAccounts = async (token) => {
    const params = {
        fields: 'id,account_status,name,currency,balance,spend_cap,amount_spent,disable_reason',
        limit: 500,
    };
    if (token) {
        params.access_token = token;
    }
    const res = await exports.fbClient.get('/me/adaccounts', params);
    return res.data || [];
};
exports.fetchUserAdAccounts = fetchUserAdAccounts;
const fetchCampaigns = async (accountId, token) => {
    const params = {
        fields: 'id,name,objective,status,created_time,updated_time,buying_type,daily_budget,budget_remaining',
        limit: 1000,
    };
    if (token) {
        params.access_token = token;
    }
    const res = await exports.fbClient.get(`/${accountId}/campaigns`, params);
    return res.data || [];
};
exports.fetchCampaigns = fetchCampaigns;
const fetchAdSets = async (accountId) => {
    const res = await exports.fbClient.get(`/${accountId}/adsets`, {
        fields: 'id,name,status,campaign_id,optimization_goal,billing_event,bid_amount,daily_budget,created_time,updated_time',
        limit: 1000,
    });
    return res.data || [];
};
exports.fetchAdSets = fetchAdSets;
const fetchAds = async (accountId) => {
    const res = await exports.fbClient.get(`/${accountId}/ads`, {
        fields: 'id,name,status,adset_id,campaign_id,creative{id},created_time,updated_time',
        limit: 1000,
    });
    return res.data || [];
};
exports.fetchAds = fetchAds;
const fetchCreatives = async (accountId) => {
    const res = await exports.fbClient.get(`/${accountId}/adcreatives`, {
        fields: 'id,name,object_story_spec,thumbnail_url,image_url,status', // simplified fields
        limit: 500,
    });
    return res.data || [];
};
exports.fetchCreatives = fetchCreatives;
const fetchInsights = async (entityId, // 可以是 accountId, campaignId, adsetId, adId
level, datePreset = 'today', token) => {
    const fields = [
        'campaign_id',
        'adset_id',
        'ad_id',
        'impressions',
        'clicks',
        'spend',
        'cpc',
        'ctr',
        'cpm',
        'actions', // for conversions
        'action_values', // for conversion values
        'purchase_roas', // Return on Ad Spend
        'conversions', // For generic conversions
        'mobile_app_install', // For specific event count
        'date_start',
        'date_stop',
    ].join(',');
    const params = {
        level: level,
        date_preset: datePreset,
        fields,
        limit: 1000,
    };
    if (token) {
        params.access_token = token;
    }
    const res = await exports.fbClient.get(`/${entityId}/insights`, params);
    return res.data || [];
};
exports.fetchInsights = fetchInsights;
