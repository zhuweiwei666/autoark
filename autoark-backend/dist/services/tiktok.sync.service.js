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
exports.runTiktokFullSync = exports.syncTiktokAdvertiser = exports.getEffectiveTiktokAdvertisers = void 0;
const tiktokApi = __importStar(require("../integration/tiktok/insights.api"));
const models_1 = require("../models");
const logger_1 = __importDefault(require("../utils/logger"));
const dayjs_1 = __importDefault(require("dayjs"));
/**
 * TikTok 资产同步服务
 */
// 1. 获取所有活跃的 TikTok Advertiser IDs
const getEffectiveTiktokAdvertisers = async () => {
    const tokens = await models_1.TiktokToken.find({ status: 'active' }).lean();
    const effectiveAdvertisers = [];
    for (const tokenDoc of tokens) {
        for (const advId of tokenDoc.advertiserIds) {
            effectiveAdvertisers.push({
                advertiserId: advId,
                token: tokenDoc.accessToken,
                userId: tokenDoc.userId
            });
        }
    }
    return effectiveAdvertisers;
};
exports.getEffectiveTiktokAdvertisers = getEffectiveTiktokAdvertisers;
// 2. 通用 Mongo 写入器
const writeToMongo = async (model, filter, data) => {
    try {
        await model.findOneAndUpdate(filter, data, {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
        });
    }
    catch (error) {
        logger_1.default.error(`[TikTokSync] Mongo Write Error: ${error.message}`);
    }
};
// 3. 同步单个广告主的所有资产
const syncTiktokAdvertiser = async (advertiserId, token) => {
    logger_1.default.info(`[TikTokSync] Syncing Advertiser: ${advertiserId}`);
    const today = (0, dayjs_1.default)().format('YYYY-MM-DD');
    // 1. 同步报表 (Hourly)
    try {
        const insightsData = await tiktokApi.fetchTiktokInsights(advertiserId, 'AUCTION_AD', 'BASIC', {
            start_date: today,
            end_date: today,
            time_granularity: 'STAT_TIME_GRANULARITY_HOURLY',
            dimensions: ['stat_time_hour', 'ad_id']
        }, token);
        const list = insightsData.list || [];
        logger_1.default.info(`[TikTokSync] Found ${list.length} hourly insight records for ${advertiserId}`);
        for (const i of list) {
            const spend = parseFloat(i.metrics?.spend || '0');
            if (spend <= 0)
                continue;
            const impressions = parseInt(i.metrics?.impressions || '0');
            const clicks = parseInt(i.metrics?.clicks || '0');
            const conversions = parseInt(i.metrics?.conversions || '0');
            const purchaseValue = parseFloat(i.metrics?.purchase || '0');
            // TikTok 特有指标
            const video2s = parseInt(i.metrics?.video_watched_2s || '0');
            const atc = parseInt(i.metrics?.add_to_cart || '0');
            const date = i.dimensions?.stat_time_hour?.split(' ')[0] || today;
            const hour = i.dimensions?.stat_time_hour?.split(' ')[1] || '00';
            await writeToMongo(models_1.MetricsDaily, {
                date,
                level: 'ad',
                entityId: i.dimensions?.ad_id,
                channel: 'tiktok',
                // 使用 hour 作为一个区分标记，或者直接存入每日聚合，
                // 因为现有 MetricsDaily 是按天存的。
                // 这里的策略是更新当天的每日汇总。
            }, {
                date,
                channel: 'tiktok',
                accountId: advertiserId,
                adId: i.dimensions?.ad_id,
                level: 'ad',
                entityId: i.dimensions?.ad_id,
                impressions,
                clicks,
                spendUsd: spend,
                conversions,
                purchase_value: purchaseValue,
                // 存入原始数据供后续提取 hookRate/atcRate
                raw: i,
                updatedAt: new Date()
            });
        }
    }
    catch (err) {
        logger_1.default.error(`[TikTokSync] Failed to sync insights for ${advertiserId}`, err);
    }
};
exports.syncTiktokAdvertiser = syncTiktokAdvertiser;
// 4. 全量同步执行器
const runTiktokFullSync = async () => {
    const startTime = new Date();
    logger_1.default.info('[TikTokSync] Starting Full TikTok Sync...');
    let syncLog;
    try {
        syncLog = new models_1.SyncLog({ startTime, status: 'RUNNING', channel: 'tiktok' });
        await syncLog.save();
        const advertisers = await (0, exports.getEffectiveTiktokAdvertisers)();
        logger_1.default.info(`[TikTokSync] Syncing ${advertisers.length} advertisers`);
        for (const adv of advertisers) {
            await (0, exports.syncTiktokAdvertiser)(adv.advertiserId, adv.token);
        }
        syncLog.endTime = new Date();
        syncLog.status = 'SUCCESS';
        syncLog.details = { advertisersSynced: advertisers.length };
        await syncLog.save();
        logger_1.default.info('[TikTokSync] Full TikTok Sync Completed Successfully.');
    }
    catch (error) {
        const msg = error.message;
        logger_1.default.error(`[TikTokSync] Full TikTok Sync Failed: ${msg}`);
        if (syncLog) {
            syncLog.endTime = new Date();
            syncLog.status = 'FAILED';
            syncLog.error = msg;
            await syncLog.save();
        }
    }
};
exports.runTiktokFullSync = runTiktokFullSync;
