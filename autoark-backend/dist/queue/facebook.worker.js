"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adWorker = exports.campaignWorker = exports.accountWorker = exports.initWorkers = void 0;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
const logger_1 = __importDefault(require("../utils/logger"));
const facebook_queue_1 = require("./facebook.queue");
const campaigns_api_1 = require("../integration/facebook/campaigns.api");
const insights_api_1 = require("../integration/facebook/insights.api");
const accountId_1 = require("../utils/accountId");
const facebook_upsert_service_1 = require("../services/facebook.upsert.service");
const facebookPurchase_1 = require("../utils/facebookPurchase");
const Campaign_1 = __importDefault(require("../models/Campaign"));
const Ad_1 = __importDefault(require("../models/Ad"));
const AdSet_1 = __importDefault(require("../models/AdSet"));
const Creative_1 = __importDefault(require("../models/Creative"));
const dayjs_1 = __importDefault(require("dayjs"));
// Worker 实例（延迟初始化）
let accountWorker = null;
exports.accountWorker = accountWorker;
let campaignWorker = null;
exports.campaignWorker = campaignWorker;
let adWorker = null;
exports.adWorker = adWorker;
// 辅助函数：从 actions 数组中获取特定 action_type 的 value
const getActionValue = (actions, actionType) => {
    if (!actions || !Array.isArray(actions))
        return undefined;
    const action = actions.find((a) => a.action_type === actionType);
    return action ? parseFloat(action.value) : undefined;
};
// 辅助函数：从 actions 数组中获取特定 action_type 的 count
const getActionCount = (actions, actionType) => {
    if (!actions || !Array.isArray(actions))
        return undefined;
    const action = actions.find((a) => a.action_type === actionType);
    return action ? parseFloat(action.value) : undefined;
};
// 辅助函数：从 object_story_spec 中提取 image_hash
const extractImageHashFromSpec = (spec) => {
    if (!spec)
        return undefined;
    if (spec.link_data?.image_hash)
        return spec.link_data.image_hash;
    if (spec.photo_data?.image_hash)
        return spec.photo_data.image_hash;
    if (spec.video_data?.image_hash)
        return spec.video_data.image_hash;
    return undefined;
};
// 辅助函数：从 object_story_spec 中提取 video_id
const extractVideoIdFromSpec = (spec) => {
    if (!spec)
        return undefined;
    if (spec.video_data?.video_id)
        return spec.video_data.video_id;
    if (spec.link_data?.video_id)
        return spec.link_data.video_id;
    return undefined;
};
// 初始化 Workers（延迟调用，确保 Redis 已连接）
const initWorkers = () => {
    const client = (0, redis_1.getRedisClient)();
    if (!client) {
        logger_1.default.warn('[Worker] Workers not initialized (Redis not configured)');
        return;
    }
    // 创建 Worker 配置（使用 duplicate 创建新连接，并设置 BullMQ 必需的选项）
    const createWorkerOptions = (concurrency) => {
        const connection = client.duplicate();
        // BullMQ 要求 maxRetriesPerRequest 为 null
        connection.options.maxRetriesPerRequest = null;
        return {
            connection,
            concurrency,
            limiter: {
                max: 80,
                duration: 60000,
            },
        };
    };
    // 检查队列是否已初始化
    if (!facebook_queue_1.accountQueue || !facebook_queue_1.campaignQueue || !facebook_queue_1.adQueue) {
        logger_1.default.warn('[Worker] Workers not initialized (Queues not available)');
        return;
    }
    // ==================== 1. Account Sync Worker ====================
    exports.accountWorker = accountWorker = new bullmq_1.Worker('facebook.account.sync', async (job) => {
        const { accountId, token } = job.data;
        logger_1.default.info(`[AccountWorker] Processing account: ${accountId}`);
        try {
            const campaigns = await (0, campaigns_api_1.fetchCampaigns)(accountId, token);
            logger_1.default.info(`[AccountWorker] Fetched ${campaigns.length} campaigns for account ${accountId}`);
            const jobs = [];
            for (const camp of campaigns) {
                await Campaign_1.default.findOneAndUpdate({ campaignId: camp.id }, {
                    campaignId: camp.id,
                    accountId: (0, accountId_1.normalizeForStorage)(accountId),
                    name: camp.name,
                    status: camp.status,
                    objective: camp.objective,
                    daily_budget: camp.daily_budget,
                    budget_remaining: camp.budget_remaining,
                    buying_type: camp.buying_type,
                    raw: camp,
                }, { upsert: true, new: true });
                if (facebook_queue_1.campaignQueue) {
                    jobs.push(facebook_queue_1.campaignQueue.add('sync-campaign', { accountId, campaignId: camp.id, token }, {
                        jobId: `campaign-sync-${camp.id}-${(0, dayjs_1.default)().format('YYYY-MM-DD-HH')}`,
                        priority: 2,
                    }));
                }
            }
            await Promise.all(jobs);
            return { campaignsCount: campaigns.length };
        }
        catch (error) {
            logger_1.default.error(`[AccountWorker] Failed for account ${accountId}:`, error);
            throw error;
        }
    }, createWorkerOptions(5));
    // ==================== 2. Campaign Sync Worker ====================
    exports.campaignWorker = campaignWorker = new bullmq_1.Worker('facebook.campaign.sync', async (job) => {
        const { accountId, campaignId, token } = job.data;
        try {
            const { facebookClient } = require('../integration/facebook/facebookClient');
            // 2.1 同步该 Campaign 下的 AdSets
            try {
                const adsetsRes = await facebookClient.get(`/${campaignId}/adsets`, {
                    access_token: token,
                    fields: 'id,name,status,optimization_goal,daily_budget,lifetime_budget,bid_amount,billing_event,targeting,created_time,updated_time',
                    limit: 500,
                });
                const adsets = adsetsRes.data || [];
                logger_1.default.info(`[CampaignWorker] Syncing ${adsets.length} adsets for campaign ${campaignId}`);
                for (const adset of adsets) {
                    await AdSet_1.default.findOneAndUpdate({ adsetId: adset.id }, {
                        adsetId: adset.id,
                        accountId: (0, accountId_1.normalizeForStorage)(accountId),
                        campaignId: campaignId,
                        channel: 'facebook',
                        name: adset.name,
                        status: adset.status,
                        optimizationGoal: adset.optimization_goal,
                        budget: adset.daily_budget ? parseInt(adset.daily_budget) : (adset.lifetime_budget ? parseInt(adset.lifetime_budget) : 0),
                        created_time: adset.created_time,
                        updated_time: adset.updated_time,
                        raw: adset,
                    }, { upsert: true });
                }
            }
            catch (adsetError) {
                logger_1.default.warn(`[CampaignWorker] Failed to sync adsets for campaign ${campaignId}: ${adsetError.message}`);
                // 不阻塞后续同步
            }
            // 2.2 同步该 Campaign 下的 Ads
            const res = await facebookClient.get(`/${campaignId}/ads`, {
                access_token: token,
                fields: 'id,name,status,adset_id,campaign_id,creative{id,name,status,image_hash,video_id,image_url,thumbnail_url,object_story_spec},created_time,updated_time',
                limit: 500,
            });
            const campaignAds = res.data || [];
            const jobs = [];
            for (const ad of campaignAds) {
                // 提取 creative 信息
                const creative = ad.creative || {};
                const creativeId = creative.id;
                await Ad_1.default.findOneAndUpdate({ adId: ad.id }, {
                    adId: ad.id,
                    adsetId: ad.adset_id,
                    campaignId: ad.campaign_id,
                    accountId: (0, accountId_1.normalizeForStorage)(accountId),
                    name: ad.name,
                    status: ad.status,
                    creativeId: creativeId,
                    raw: ad,
                }, { upsert: true });
                // 2.3 同步 Creative（如果存在）
                if (creativeId) {
                    try {
                        // 从 ad.creative 中提取素材标识
                        const imageHash = creative.image_hash || extractImageHashFromSpec(creative.object_story_spec);
                        const videoId = creative.video_id || extractVideoIdFromSpec(creative.object_story_spec);
                        let creativeType = 'unknown';
                        if (videoId)
                            creativeType = 'video';
                        else if (imageHash)
                            creativeType = 'image';
                        else if (creative.object_story_spec?.link_data?.child_attachments)
                            creativeType = 'carousel';
                        await Creative_1.default.findOneAndUpdate({ creativeId: creativeId }, {
                            creativeId: creativeId,
                            channel: 'facebook',
                            accountId: (0, accountId_1.normalizeForStorage)(accountId),
                            name: creative.name,
                            status: creative.status,
                            type: creativeType,
                            imageHash: imageHash,
                            videoId: videoId,
                            hash: imageHash, // 兼容旧字段
                            imageUrl: creative.image_url,
                            thumbnailUrl: creative.thumbnail_url,
                            storageUrl: creative.image_url || creative.thumbnail_url,
                            raw: creative,
                        }, { upsert: true });
                    }
                    catch (creativeError) {
                        logger_1.default.warn(`[CampaignWorker] Failed to sync creative ${creativeId}: ${creativeError.message}`);
                    }
                }
                if (facebook_queue_1.adQueue) {
                    jobs.push(facebook_queue_1.adQueue.add('sync-ad', {
                        accountId,
                        campaignId,
                        adId: ad.id,
                        adsetId: ad.adset_id,
                        creativeId: creativeId,
                        token,
                    }, {
                        jobId: `ad-sync-${ad.id}-${(0, dayjs_1.default)().format('YYYY-MM-DD-HH')}`,
                        priority: 3,
                    }));
                }
            }
            await Promise.all(jobs);
            return { adsCount: campaignAds.length };
        }
        catch (error) {
            logger_1.default.error(`[CampaignWorker] Failed for campaign ${campaignId}:`, error);
            throw error;
        }
    }, createWorkerOptions(10));
    // ==================== 3. Ad Sync Worker ====================
    exports.adWorker = adWorker = new bullmq_1.Worker('facebook.ad.sync', async (job) => {
        const { accountId, campaignId, adId, adsetId, token } = job.data;
        try {
            const datePresets = ['today', 'yesterday', 'last_3d', 'last_7d'];
            const promises = datePresets.map(async (preset) => {
                const insights = await (0, insights_api_1.fetchInsights)(adId, 'ad', preset, token, ['country']);
                if (!insights || insights.length === 0)
                    return;
                for (const insight of insights) {
                    const country = insight.country || null;
                    const date = insight.date_start || (0, dayjs_1.default)().format('YYYY-MM-DD');
                    let actualDate = date;
                    if (preset === 'yesterday') {
                        actualDate = (0, dayjs_1.default)().subtract(1, 'day').format('YYYY-MM-DD');
                    }
                    else if (preset === 'today') {
                        actualDate = (0, dayjs_1.default)().format('YYYY-MM-DD');
                    }
                    const purchaseValue = (0, facebookPurchase_1.extractPurchaseValue)(insight.action_values);
                    const mobileAppInstall = getActionCount(insight.actions, 'mobile_app_install');
                    await facebook_upsert_service_1.upsertService.upsertRawInsights({
                        date: actualDate,
                        datePreset: preset,
                        adId: adId,
                        country: country,
                        raw: insight,
                        accountId: (0, accountId_1.normalizeForStorage)(accountId),
                        campaignId: campaignId,
                        adsetId: adsetId,
                        spend: parseFloat(insight.spend || '0'),
                        impressions: insight.impressions || 0,
                        clicks: insight.clicks || 0,
                        purchase_value: purchaseValue,
                        syncedAt: new Date(),
                        tokenId: job.data.tokenId || 'unknown',
                    });
                    if (preset === 'today' || preset === 'yesterday') {
                        await facebook_upsert_service_1.upsertService.upsertMetricsDaily({
                            date: actualDate,
                            level: 'ad',
                            entityId: adId,
                            channel: 'facebook',
                            country: country,
                            accountId: (0, accountId_1.normalizeForStorage)(accountId),
                            campaignId: campaignId,
                            adsetId: adsetId,
                            adId: adId,
                            spend: parseFloat(insight.spend || '0'),
                            impressions: insight.impressions || 0,
                            clicks: insight.clicks || 0,
                            purchase_value: purchaseValue || 0,
                            roas: insight.purchase_roas ? parseFloat(insight.purchase_roas) : 0,
                            cpc: insight.cpc ? parseFloat(insight.cpc) : undefined,
                            cpm: insight.cpm ? parseFloat(insight.cpm) : undefined,
                            actions: insight.actions,
                            action_values: insight.action_values,
                            mobile_app_install_count: mobileAppInstall,
                            raw: insight,
                        });
                    }
                }
            });
            await Promise.all(promises);
            return { success: true };
        }
        catch (error) {
            logger_1.default.error(`[AdWorker] Failed for ad ${adId}:`, error);
            throw error;
        }
    }, createWorkerOptions(20));
    // 设置错误处理
    const workers = [
        { name: 'AccountWorker', worker: accountWorker },
        { name: 'CampaignWorker', worker: campaignWorker },
        { name: 'AdWorker', worker: adWorker },
    ];
    workers.forEach(({ name, worker }) => {
        worker.on('failed', (job, err) => {
            logger_1.default.error(`[${name}] Job ${job?.id} failed:`, err);
        });
        worker.on('error', (err) => {
            logger_1.default.error(`[${name}] Worker error:`, err);
        });
    });
    logger_1.default.info('[Worker] Facebook sync workers initialized (Pipeline V2)');
};
exports.initWorkers = initWorkers;
