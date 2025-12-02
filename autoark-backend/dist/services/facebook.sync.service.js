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
exports.runFullSync = exports.syncAccount = exports.getEffectiveAdAccounts = void 0;
const fbApi = __importStar(require("./facebook.api"));
const models_1 = require("../models");
const logger_1 = __importDefault(require("../utils/logger"));
// 1. Get Effective Accounts
const getEffectiveAdAccounts = async () => {
    // Priority: Env Array > Env Single > Auto-discover
    if (process.env.FB_ACCOUNT_IDS) {
        try {
            const ids = JSON.parse(process.env.FB_ACCOUNT_IDS);
            if (Array.isArray(ids) && ids.length > 0)
                return ids;
        }
        catch (e) {
            logger_1.default.warn('Failed to parse FB_ACCOUNT_IDS');
        }
    }
    if (process.env.FB_AD_ACCOUNT_ID) {
        return [process.env.FB_AD_ACCOUNT_ID];
    }
    // Auto-discover
    const accounts = await fbApi.fetchUserAdAccounts();
    return accounts.map((a) => a.id);
};
exports.getEffectiveAdAccounts = getEffectiveAdAccounts;
// 6. Generic Mongo Writer
const writeToMongo = async (model, filter, data) => {
    try {
        await model.findOneAndUpdate(filter, data, {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
        });
    }
    catch (error) {
        logger_1.default.error(`Mongo Write Error: ${error.message}`);
    }
};
// 7. Sync Single Account
const syncAccount = async (accountId) => {
    logger_1.default.info(`Syncing Account: ${accountId}`);
    // 1. Campaigns
    try {
        const campaigns = await fbApi.fetchCampaigns(accountId);
        logger_1.default.info(`Syncing ${campaigns.length} campaigns for ${accountId}`);
        for (const c of campaigns) {
            await writeToMongo(models_1.Campaign, { campaignId: c.id }, {
                campaignId: c.id,
                accountId,
                name: c.name,
                status: c.status,
                objective: c.objective,
                created_time: c.created_time,
                updated_time: c.updated_time,
                raw: c,
            });
        }
    }
    catch (err) {
        logger_1.default.error(`Failed to sync campaigns for ${accountId}`, err);
    }
    // 2. AdSets
    try {
        const adsets = await fbApi.fetchAdSets(accountId);
        logger_1.default.info(`Syncing ${adsets.length} adsets for ${accountId}`);
        for (const a of adsets) {
            await writeToMongo(models_1.AdSet, { adsetId: a.id }, {
                adsetId: a.id,
                accountId,
                campaignId: a.campaign_id,
                name: a.name,
                status: a.status,
                optimizationGoal: a.optimization_goal,
                budget: a.daily_budget ? parseInt(a.daily_budget) : 0,
                created_time: a.created_time,
                updated_time: a.updated_time,
                raw: a,
            });
        }
    }
    catch (err) {
        logger_1.default.error(`Failed to sync adsets for ${accountId}`, err);
    }
    // 3. Ads
    try {
        const ads = await fbApi.fetchAds(accountId);
        logger_1.default.info(`Syncing ${ads.length} ads for ${accountId}`);
        for (const a of ads) {
            await writeToMongo(models_1.Ad, { adId: a.id }, {
                adId: a.id,
                accountId,
                adsetId: a.adset_id,
                campaignId: a.campaign_id,
                name: a.name,
                status: a.status,
                creativeId: a.creative?.id,
                created_time: a.created_time,
                updated_time: a.updated_time,
                raw: a,
            });
        }
    }
    catch (err) {
        logger_1.default.error(`Failed to sync ads for ${accountId}`, err);
    }
    // 4. Creatives (Optional but good to have)
    try {
        const creatives = await fbApi.fetchCreatives(accountId);
        logger_1.default.info(`Syncing ${creatives.length} creatives for ${accountId}`);
        for (const c of creatives) {
            await writeToMongo(models_1.Creative, { creativeId: c.id }, {
                creativeId: c.id,
                channel: 'facebook',
                name: c.name,
                storageUrl: c.image_url || c.thumbnail_url, // Simplification
                // type, hash etc can be extracted if needed
            });
        }
    }
    catch (err) {
        logger_1.default.error(`Failed to sync creatives for ${accountId}`, err);
    }
    // 5. Insights (Daily)
    try {
        const insights = await fbApi.fetchInsights(accountId, 'account', 'today'); // or 'yesterday'
        logger_1.default.info(`Syncing ${insights.length} insight records for ${accountId}`);
        for (const i of insights) {
            const spendUsd = parseFloat(i.spend || '0');
            const impressions = parseInt(i.impressions || '0');
            const clicks = parseInt(i.clicks || '0');
            // Extract installs
            const actions = i.actions || [];
            const installAction = actions.find((a) => a.action_type === 'mobile_app_install');
            const installs = installAction ? parseFloat(installAction.value) : 0;
            await writeToMongo(models_1.MetricsDaily, { adId: i.ad_id, date: i.date_start }, {
                date: i.date_start,
                channel: 'facebook',
                accountId,
                campaignId: i.campaign_id,
                adsetId: i.adset_id,
                adId: i.ad_id,
                impressions,
                clicks,
                spendUsd,
                cpc: i.cpc ? parseFloat(i.cpc) : 0,
                ctr: i.ctr ? parseFloat(i.ctr) : 0,
                cpm: i.cpm ? parseFloat(i.cpm) : 0,
                installs,
                raw: i,
            });
        }
    }
    catch (err) {
        logger_1.default.error(`Failed to sync insights for ${accountId}`, err);
    }
};
exports.syncAccount = syncAccount;
// 8. Full Sync Runner
const runFullSync = async () => {
    const startTime = new Date();
    logger_1.default.info('Starting Full Facebook Sync...');
    let syncLog;
    try {
        syncLog = await models_1.SyncLog.create({ startTime, status: 'RUNNING' });
        const accountIds = await (0, exports.getEffectiveAdAccounts)();
        logger_1.default.info(`Syncing ${accountIds.length} accounts: ${accountIds.join(', ')}`);
        for (const accountId of accountIds) {
            await (0, exports.syncAccount)(accountId);
        }
        syncLog.endTime = new Date();
        syncLog.status = 'SUCCESS';
        syncLog.details = { accountsSynced: accountIds.length };
        await syncLog.save();
        logger_1.default.info('Full Facebook Sync Completed Successfully.');
    }
    catch (error) {
        const msg = error.message;
        logger_1.default.error(`Full Facebook Sync Failed: ${msg}`);
        if (syncLog) {
            syncLog.endTime = new Date();
            syncLog.status = 'FAILED';
            syncLog.error = msg;
            await syncLog.save();
        }
    }
};
exports.runFullSync = runFullSync;
