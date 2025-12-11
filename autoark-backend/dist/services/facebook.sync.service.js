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
const accountId_1 = require("../utils/accountId");
const facebookPurchase_1 = require("../utils/facebookPurchase");
// 从 object_story_spec 中提取 image_hash
const extractImageHashFromSpec = (spec) => {
    if (!spec)
        return undefined;
    // link_data 中的 image_hash
    if (spec.link_data?.image_hash)
        return spec.link_data.image_hash;
    // photo_data 中的 image_hash
    if (spec.photo_data?.image_hash)
        return spec.photo_data.image_hash;
    // video_data 中可能有 image_hash（封面图）
    if (spec.video_data?.image_hash)
        return spec.video_data.image_hash;
    return undefined;
};
// 从 object_story_spec 中提取 video_id
const extractVideoIdFromSpec = (spec) => {
    if (!spec)
        return undefined;
    // video_data 中的 video_id
    if (spec.video_data?.video_id)
        return spec.video_data.video_id;
    // link_data 中可能有 video_id
    if (spec.link_data?.video_id)
        return spec.link_data.video_id;
    return undefined;
};
// 1. Get Effective Accounts - 从所有 active token 获取账户
const getEffectiveAdAccounts = async () => {
    // Priority: Env Array > Env Single > Auto-discover from all tokens
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
    // Auto-discover: 遍历所有 active token，获取各自的账户
    const FbToken = require('../models/FbToken').default;
    const tokens = await FbToken.find({ status: 'active' }).lean();
    const allAccountIds = new Set();
    for (const tokenDoc of tokens) {
        try {
            const accounts = await fbApi.fetchUserAdAccounts(tokenDoc.token);
            for (const acc of accounts) {
                allAccountIds.add(acc.id);
            }
            logger_1.default.info(`[GetAccounts] Token ${tokenDoc.fbUserName || tokenDoc.fbUserId}: found ${accounts.length} accounts`);
        }
        catch (err) {
            logger_1.default.warn(`[GetAccounts] Failed to fetch accounts for token ${tokenDoc.fbUserName || tokenDoc.fbUserId}: ${err.message}`);
        }
    }
    logger_1.default.info(`[GetAccounts] Total unique accounts from all tokens: ${allAccountIds.size}`);
    return Array.from(allAccountIds);
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
    // 统一格式：API 调用需要带 act_ 前缀
    const accountIdForApi = (0, accountId_1.normalizeForApi)(accountId);
    const accountIdForStorage = (0, accountId_1.normalizeForStorage)(accountId);
    // 1. Campaigns
    try {
        const campaigns = await fbApi.fetchCampaigns(accountIdForApi);
        logger_1.default.info(`Syncing ${campaigns.length} campaigns for ${accountId}`);
        for (const c of campaigns) {
            await writeToMongo(models_1.Campaign, { campaignId: c.id }, {
                campaignId: c.id,
                accountId: accountIdForStorage, // 统一格式：数据库存储时去掉前缀
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
        const adsets = await fbApi.fetchAdSets(accountIdForApi);
        logger_1.default.info(`Syncing ${adsets.length} adsets for ${accountId}`);
        for (const a of adsets) {
            await writeToMongo(models_1.AdSet, { adsetId: a.id }, {
                adsetId: a.id,
                accountId: accountIdForStorage, // 统一格式：数据库存储时去掉前缀
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
    // 3. Ads（增强：提取 creative 的 image_hash/video_id）
    try {
        const ads = await fbApi.fetchAds(accountIdForApi);
        logger_1.default.info(`Syncing ${ads.length} ads for ${accountId}`);
        for (const a of ads) {
            // 从 creative 中提取素材标识
            const creative = a.creative || {};
            const imageHash = creative.image_hash || extractImageHashFromSpec(creative.object_story_spec);
            const videoId = creative.video_id || extractVideoIdFromSpec(creative.object_story_spec);
            await writeToMongo(models_1.Ad, { adId: a.id }, {
                adId: a.id,
                accountId: accountIdForStorage,
                adsetId: a.adset_id,
                campaignId: a.campaign_id,
                name: a.name,
                status: a.status,
                creativeId: creative.id,
                // 新增：素材标识字段
                imageHash,
                videoId,
                thumbnailUrl: creative.thumbnail_url,
                created_time: a.created_time,
                updated_time: a.updated_time,
                raw: a,
            });
        }
    }
    catch (err) {
        logger_1.default.error(`Failed to sync ads for ${accountId}`, err);
    }
    // 4. Creatives（增强：存储完整的素材标识信息）
    try {
        const creatives = await fbApi.fetchCreatives(accountIdForApi);
        logger_1.default.info(`Syncing ${creatives.length} creatives for ${accountId}`);
        for (const c of creatives) {
            // 提取素材标识
            const imageHash = c.image_hash || extractImageHashFromSpec(c.object_story_spec);
            const videoId = c.video_id || extractVideoIdFromSpec(c.object_story_spec);
            // 判断素材类型
            let type = 'unknown';
            if (videoId)
                type = 'video';
            else if (imageHash)
                type = 'image';
            else if (c.object_story_spec?.link_data?.child_attachments)
                type = 'carousel';
            await writeToMongo(models_1.Creative, { creativeId: c.id }, {
                creativeId: c.id,
                channel: 'facebook',
                accountId: accountIdForStorage,
                name: c.name,
                status: c.status,
                type,
                // 素材标识
                imageHash,
                videoId,
                hash: imageHash, // 兼容旧字段
                // URLs
                imageUrl: c.image_url,
                thumbnailUrl: c.thumbnail_url,
                storageUrl: c.image_url || c.thumbnail_url,
                // 原始数据
                raw: c,
            });
        }
    }
    catch (err) {
        logger_1.default.error(`Failed to sync creatives for ${accountId}`, err);
    }
    // 5. Insights (Daily) - 使用 campaign 级别以获取完整的维度数据
    try {
        // 改用 campaign 级别 + country breakdown 以支持多维度聚合
        const insights = await fbApi.fetchInsights(accountIdForApi, 'campaign', 'today', undefined, ['country']);
        logger_1.default.info(`Syncing ${insights.length} campaign-level insight records for ${accountId}`);
        for (const i of insights) {
            const spendUsd = parseFloat(i.spend || '0');
            const impressions = parseInt(i.impressions || '0');
            const clicks = parseInt(i.clicks || '0');
            // Extract installs
            const actions = i.actions || [];
            const installAction = actions.find((a) => a.action_type === 'mobile_app_install');
            const installs = installAction ? parseFloat(installAction.value) : 0;
            // 确定数据级别和实体ID
            let dataLevel;
            let entityId;
            if (i.ad_id) {
                dataLevel = 'ad';
                entityId = i.ad_id;
            }
            else if (i.adset_id) {
                dataLevel = 'adset';
                entityId = i.adset_id;
            }
            else if (i.campaign_id) {
                dataLevel = 'campaign';
                entityId = i.campaign_id;
            }
            else {
                dataLevel = 'account';
                entityId = accountIdForStorage;
            }
            // 从 action_values 提取 purchase_value
            const purchaseValue = (0, facebookPurchase_1.extractPurchaseValue)(i.action_values || []);
            await writeToMongo(models_1.MetricsDaily, {
                date: i.date_start,
                level: dataLevel,
                entityId: entityId,
                country: i.country || null,
            }, {
                date: i.date_start,
                channel: 'facebook',
                accountId: accountIdForStorage, // 统一格式：数据库存储时去掉前缀
                campaignId: i.campaign_id,
                adsetId: i.adset_id,
                adId: i.ad_id,
                level: dataLevel,
                entityId: entityId,
                country: i.country || null,
                impressions,
                clicks,
                spendUsd,
                cpc: i.cpc ? parseFloat(i.cpc) : 0,
                ctr: i.ctr ? parseFloat(i.ctr) : 0,
                cpm: i.cpm ? parseFloat(i.cpm) : 0,
                installs,
                conversions: installs, // 保持 conversions 字段兼容
                purchase_value: purchaseValue,
                actions: i.actions,
                action_values: i.action_values,
                raw: i,
            });
        }
    }
    catch (err) {
        logger_1.default.error(`Failed to sync insights for ${accountId}`, err);
    }
    // 6. Ad-level Insights (用于素材数据聚合)
    try {
        const adInsights = await fbApi.fetchInsights(accountIdForApi, 'ad', 'today', undefined, ['country']);
        logger_1.default.info(`Syncing ${adInsights.length} ad-level insight records for ${accountId}`);
        for (const i of adInsights) {
            const spendUsd = parseFloat(i.spend || '0');
            // 跳过无消耗的记录以减少数据量
            if (spendUsd <= 0)
                continue;
            const impressions = parseInt(i.impressions || '0');
            const clicks = parseInt(i.clicks || '0');
            const actions = i.actions || [];
            const installAction = actions.find((a) => a.action_type === 'mobile_app_install');
            const installs = installAction ? parseFloat(installAction.value) : 0;
            const purchaseValue = (0, facebookPurchase_1.extractPurchaseValue)(i.action_values || []);
            await writeToMongo(models_1.MetricsDaily, {
                date: i.date_start,
                level: 'ad',
                entityId: i.ad_id,
                country: i.country || null,
            }, {
                date: i.date_start,
                channel: 'facebook',
                accountId: accountIdForStorage,
                campaignId: i.campaign_id,
                adsetId: i.adset_id,
                adId: i.ad_id,
                level: 'ad',
                entityId: i.ad_id,
                country: i.country || null,
                impressions,
                clicks,
                spendUsd,
                cpc: i.cpc ? parseFloat(i.cpc) : 0,
                ctr: i.ctr ? parseFloat(i.ctr) : 0,
                cpm: i.cpm ? parseFloat(i.cpm) : 0,
                installs,
                conversions: installs,
                purchase_value: purchaseValue,
                actions: i.actions,
                action_values: i.action_values,
                raw: i,
            });
        }
    }
    catch (err) {
        logger_1.default.error(`Failed to sync ad-level insights for ${accountId}`, err);
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
