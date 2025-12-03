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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEffectiveAdAccounts = exports.getInsightsDaily = exports.getAds = exports.getAdSets = exports.getCampaigns = exports.getAccountInfo = void 0;
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
const models_1 = require("../models"); // Unified export
const logger_1 = __importDefault(require("../utils/logger"));
const facebook_sync_service_1 = require("./facebook.sync.service"); // Import from sync service
Object.defineProperty(exports, "getEffectiveAdAccounts", { enumerable: true, get: function () { return facebook_sync_service_1.getEffectiveAdAccounts; } });
const fbToken_1 = require("../utils/fbToken");
dotenv_1.default.config();
const FB_API_VERSION = 'v18.0';
const FB_BASE_URL = 'https://graph.facebook.com';
// Generic error handler helper
const handleApiError = (context, error) => {
    const errMsg = error.response?.data?.error?.message || error.message;
    logger_1.default.error(`Facebook API Error [${context}]: ${errMsg}`, error.response?.data);
    throw new Error(`Facebook API [${context}] failed: ${errMsg}`);
};
const getAccountInfo = async (accountId) => {
    const startTime = Date.now();
    logger_1.default.info(`[Facebook API] getAccountInfo started for ${accountId}`);
    try {
        const token = await (0, fbToken_1.getFacebookAccessToken)();
        const url = `${FB_BASE_URL}/${FB_API_VERSION}/${accountId}`;
        const res = await axios_1.default.get(url, {
            params: {
                access_token: token,
                fields: 'id,name,currency,timezone_name',
            },
        });
        logger_1.default.timerLog(`[Facebook API] getAccountInfo for ${accountId}`, startTime);
        return res.data;
    }
    catch (error) {
        handleApiError('getAccountInfo', error);
    }
};
exports.getAccountInfo = getAccountInfo;
const getCampaigns = async (accountId) => {
    const startTime = Date.now();
    logger_1.default.info(`[Facebook API] getCampaigns started for ${accountId}`);
    try {
        const token = await (0, fbToken_1.getFacebookAccessToken)();
        const url = `${FB_BASE_URL}/${FB_API_VERSION}/${accountId}/campaigns`;
        const res = await axios_1.default.get(url, {
            params: {
                access_token: token,
                fields: 'id,name,objective,status,start_time,stop_time',
                limit: 1000, // Handle pagination in real prod
            },
        });
        logger_1.default.timerLog(`[Facebook API] getCampaigns for ${accountId}`, startTime);
        return res.data; // Usually { data: [...] }
    }
    catch (error) {
        handleApiError('getCampaigns', error);
    }
};
exports.getCampaigns = getCampaigns;
const getAdSets = async (accountId) => {
    const startTime = Date.now();
    logger_1.default.info(`[Facebook API] getAdSets started for ${accountId}`);
    try {
        const token = await (0, fbToken_1.getFacebookAccessToken)();
        const url = `${FB_BASE_URL}/${FB_API_VERSION}/${accountId}/adsets`;
        const res = await axios_1.default.get(url, {
            params: {
                access_token: token,
                fields: 'id,name,optimization_goal,billing_event,bid_amount,daily_budget,campaign_id,status,targeting',
                limit: 1000,
            },
        });
        logger_1.default.timerLog(`[Facebook API] getAdSets for ${accountId}`, startTime);
        return res.data;
    }
    catch (error) {
        handleApiError('getAdSets', error);
    }
};
exports.getAdSets = getAdSets;
const getAds = async (accountId) => {
    const startTime = Date.now();
    logger_1.default.info(`[Facebook API] getAds started for ${accountId}`);
    try {
        const token = await (0, fbToken_1.getFacebookAccessToken)();
        const url = `${FB_BASE_URL}/${FB_API_VERSION}/${accountId}/ads`;
        const res = await axios_1.default.get(url, {
            params: {
                access_token: token,
                fields: 'id,name,status,creative{id},adset_id,campaign_id',
                limit: 1000,
            },
        });
        logger_1.default.timerLog(`[Facebook API] getAds for ${accountId}`, startTime);
        return res.data;
    }
    catch (error) {
        handleApiError('getAds', error);
    }
};
exports.getAds = getAds;
/**
 * Fetch daily insights and upsert into DB
 */
const getInsightsDaily = async (accountId, dateRange) => {
    const startTime = Date.now();
    // 统一格式：API 调用需要带 act_ 前缀
    const { normalizeForApi, normalizeForStorage } = await Promise.resolve().then(() => __importStar(require('../utils/accountId')));
    const accountIdForApi = normalizeForApi(accountId);
    const accountIdForStorage = normalizeForStorage(accountId);
    logger_1.default.info(`[Facebook API] getInsightsDaily started for ${accountId}`);
    try {
        const token = await (0, fbToken_1.getFacebookAccessToken)();
        const url = `${FB_BASE_URL}/${FB_API_VERSION}/${accountIdForApi}/insights`;
        // Requested fields
        const fields = [
            'campaign_id',
            'adset_id',
            'ad_id',
            'impressions',
            'clicks',
            'spend',
            'actions',
            'action_values',
            'cpc',
            'cpm',
            'ctr',
            'cost_per_action_type',
            'purchase_roas',
            'date_start', // FB returns date_start/date_stop for the window
            'date_stop',
        ].join(',');
        const params = {
            access_token: token,
            level: 'ad',
            fields: fields,
            time_increment: 1, // Daily breakdown
            limit: 500,
        };
        if (dateRange) {
            params.time_range = JSON.stringify(dateRange);
        }
        else {
            params.date_preset = 'yesterday';
        }
        const res = await axios_1.default.get(url, { params });
        const insights = res.data.data || [];
        logger_1.default.info(`Fetched ${insights.length} daily insight records for account ${accountId}`);
        const processedData = [];
        for (const item of insights) {
            // 1. Extract Installs (mobile_app_install)
            const actions = item.actions || [];
            const installAction = actions.find((a) => a.action_type === 'mobile_app_install');
            const installs = installAction ? parseFloat(installAction.value) : 0;
            // 2. Extract Revenue/ROAS
            // 'action_values' usually contains purchase value
            const actionValues = item.action_values || [];
            const purchaseValue = actionValues.find((a) => a.action_type === 'purchase' ||
                a.action_type === 'mobile_app_purchase'); // Adjust based on specific event name
            const revenueD0 = purchaseValue ? parseFloat(purchaseValue.value) : 0;
            // purchase_roas is array of { action_type, value }
            const roasStats = item.purchase_roas || [];
            const totalRoas = roasStats.reduce((acc, cur) => acc + parseFloat(cur.value || '0'), 0);
            // Or if there's a specific 'purchase' action type for ROAS
            // For simplicity taking the aggregated value if single or just summing up
            const spendUsd = parseFloat(item.spend || '0');
            // 3. Calculate Derived Metrics
            const cpiUsd = installs > 0 ? spendUsd / installs : 0;
            // 4. Construct Internal Format
            const record = {
                date: item.date_start, // YYYY-MM-DD
                channel: 'facebook',
                accountId: accountIdForStorage, // 统一格式：数据库存储时去掉前缀
                campaignId: item.campaign_id,
                adsetId: item.adset_id,
                adId: item.ad_id,
                impressions: parseInt(item.impressions || '0', 10),
                clicks: parseInt(item.clicks || '0', 10),
                installs,
                spendUsd,
                revenueD0, // Assuming D0 for daily fetch
                cpiUsd,
                roiD0: totalRoas, // ROAS
                raw: item, // Store raw FB response for debugging
            };
            // 5. Upsert into MongoDB
            await models_1.MetricsDaily.findOneAndUpdate({
                date: record.date,
                adId: record.adId,
                accountId: record.accountId,
            }, record, { upsert: true, new: true, setDefaultsOnInsert: true });
            processedData.push(record);
        }
        logger_1.default.info(`Successfully upserted ${processedData.length} records into MetricsDaily`);
        logger_1.default.timerLog(`[Facebook API] getInsightsDaily for ${accountId}`, startTime);
        return processedData;
    }
    catch (error) {
        handleApiError('getInsightsDaily', error);
    }
};
exports.getInsightsDaily = getInsightsDaily;
