"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateAd = exports.updateAdSet = exports.updateCampaign = exports.getCustomConversions = exports.getPixels = exports.getInstagramAccounts = exports.getPages = exports.searchTargetingLocations = exports.searchTargetingInterests = exports.uploadVideoFromUrl = exports.uploadImageFromUrl = exports.createAd = exports.createAdCreative = exports.createAdSet = exports.createCampaign = void 0;
const facebookClient_1 = require("./facebookClient");
const logger_1 = __importDefault(require("../../utils/logger"));
const createCampaign = async (params) => {
    const { accountId, token, name, objective, status, buyingType = 'AUCTION', specialAdCategories = [], dailyBudget, lifetimeBudget, bidStrategy, spendCap, } = params;
    const requestParams = {
        access_token: token,
        name,
        objective,
        status,
        buying_type: buyingType,
        // Facebook API 要求参数为 JSON 字符串格式
        // 无特殊类别时传空数组 "[]"
        special_ad_categories: JSON.stringify(specialAdCategories.length > 0 ? specialAdCategories : []),
    };
    // 预算设置（只有非 CBO 模式下才设置）
    if (dailyBudget && !lifetimeBudget) {
        requestParams.daily_budget = Math.round(dailyBudget * 100); // 转换为分
    }
    if (lifetimeBudget) {
        requestParams.lifetime_budget = Math.round(lifetimeBudget * 100);
    }
    if (bidStrategy) {
        requestParams.bid_strategy = bidStrategy;
    }
    if (spendCap) {
        requestParams.spend_cap = Math.round(spendCap * 100);
    }
    try {
        logger_1.default.info(`[BulkCreate] Creating campaign for account ${accountId}: ${name}`);
        logger_1.default.info(`[BulkCreate] Campaign params: ${JSON.stringify(requestParams, null, 2)}`);
        const res = await facebookClient_1.facebookClient.post(`/act_${accountId}/campaigns`, requestParams);
        logger_1.default.info(`[BulkCreate] Campaign created: ${res.id}`);
        return { success: true, id: res.id, data: res };
    }
    catch (error) {
        // FacebookApiError 有特殊结构: { response, code, subcode, userMessage }
        const fbResponse = error.response || {};
        const fbError = fbResponse.error || {};
        logger_1.default.error(`[BulkCreate] Failed to create campaign - Full error:`, JSON.stringify({
            message: error.message,
            code: error.code || fbError.code,
            subcode: error.subcode || fbError.error_subcode,
            userMessage: error.userMessage || fbError.error_user_msg || fbError.error_user_title,
            fbResponse: fbResponse,
            rawError: String(error),
        }, null, 2));
        return {
            success: false,
            error: {
                code: error.code || fbError.code || 'UNKNOWN',
                subcode: error.subcode || fbError.error_subcode,
                message: fbError.message || error.message,
                userTitle: fbError.error_user_title,
                userMsg: error.userMessage || fbError.error_user_msg,
                details: fbResponse,
            },
        };
    }
};
exports.createCampaign = createCampaign;
const createAdSet = async (params) => {
    const { accountId, token, campaignId, name, status, targeting, optimizationGoal, billingEvent, bidStrategy, bidAmount, dailyBudget, lifetimeBudget, startTime, endTime, promotedObject, attribution_spec, pacing_type, dsa_beneficiary, dsa_payor, } = params;
    // 处理 targeting：确保国家代码大写，并添加必要的 targeting_automation 字段
    const processedTargeting = { ...targeting };
    // 确保国家代码大写
    if (processedTargeting.geo_locations?.countries) {
        processedTargeting.geo_locations.countries = processedTargeting.geo_locations.countries.map((c) => c.toUpperCase());
    }
    // Facebook API 要求：必须设置 targeting_automation.advantage_audience
    if (!processedTargeting.targeting_automation) {
        processedTargeting.targeting_automation = { advantage_audience: 0 };
    }
    const requestParams = {
        access_token: token,
        campaign_id: campaignId,
        name,
        status,
        targeting: JSON.stringify(processedTargeting),
        optimization_goal: optimizationGoal,
        billing_event: billingEvent,
    };
    if (bidStrategy) {
        requestParams.bid_strategy = bidStrategy;
    }
    if (bidAmount) {
        requestParams.bid_amount = Math.round(bidAmount * 100);
    }
    if (dailyBudget) {
        requestParams.daily_budget = Math.round(dailyBudget * 100);
    }
    if (lifetimeBudget) {
        requestParams.lifetime_budget = Math.round(lifetimeBudget * 100);
    }
    if (startTime) {
        requestParams.start_time = startTime;
    }
    if (endTime) {
        requestParams.end_time = endTime;
    }
    if (promotedObject) {
        requestParams.promoted_object = JSON.stringify(promotedObject);
    }
    if (attribution_spec) {
        requestParams.attribution_spec = JSON.stringify(attribution_spec);
    }
    if (pacing_type) {
        requestParams.pacing_type = JSON.stringify(pacing_type);
    }
    // DSA 合规字段（欧盟数字服务法案）
    if (dsa_beneficiary) {
        requestParams.dsa_beneficiary = dsa_beneficiary;
    }
    if (dsa_payor) {
        requestParams.dsa_payor = dsa_payor;
    }
    try {
        logger_1.default.info(`[BulkCreate] Creating adset for campaign ${campaignId}: ${name}`);
        logger_1.default.info(`[BulkCreate] AdSet params: ${JSON.stringify(requestParams, null, 2)}`);
        const res = await facebookClient_1.facebookClient.post(`/act_${accountId}/adsets`, requestParams);
        logger_1.default.info(`[BulkCreate] AdSet created: ${res.id}`);
        return { success: true, id: res.id, data: res };
    }
    catch (error) {
        const errorData = error.response?.data?.error || error.response?.data || error.message;
        logger_1.default.error(`[BulkCreate] Failed to create adset - Full error:`, JSON.stringify(errorData, null, 2));
        logger_1.default.error(`[BulkCreate] AdSet failed params: ${JSON.stringify(requestParams, null, 2)}`);
        return {
            success: false,
            error: {
                code: error.response?.data?.error?.code || 'UNKNOWN',
                message: error.response?.data?.error?.message || error.message,
                details: error.response?.data,
            },
        };
    }
};
exports.createAdSet = createAdSet;
const createAdCreative = async (params) => {
    const { accountId, token, name, objectStorySpec, degreesOfFreedomSpec, assetFeedSpec, } = params;
    const requestParams = {
        access_token: token,
        name,
        object_story_spec: JSON.stringify(objectStorySpec),
    };
    if (degreesOfFreedomSpec) {
        requestParams.degrees_of_freedom_spec = JSON.stringify(degreesOfFreedomSpec);
    }
    if (assetFeedSpec) {
        requestParams.asset_feed_spec = JSON.stringify(assetFeedSpec);
    }
    try {
        logger_1.default.info(`[BulkCreate] Creating ad creative for account ${accountId}: ${name}`);
        logger_1.default.info(`[BulkCreate] Creative params: ${JSON.stringify(requestParams, null, 2)}`);
        const res = await facebookClient_1.facebookClient.post(`/act_${accountId}/adcreatives`, requestParams);
        logger_1.default.info(`[BulkCreate] Ad Creative created: ${res.id}`);
        return { success: true, id: res.id, data: res };
    }
    catch (error) {
        // 从 FacebookApiError 获取详细信息
        const fbError = error.response?.error || {};
        const responseData = error.response || {};
        logger_1.default.error(`[BulkCreate] Failed to create ad creative - Full error:`);
        logger_1.default.error(`[BulkCreate] Error code: ${error.code || fbError.code}`);
        logger_1.default.error(`[BulkCreate] Error message: ${fbError.message || error.message}`);
        logger_1.default.error(`[BulkCreate] Error type: ${fbError.type}`);
        logger_1.default.error(`[BulkCreate] Error subcode: ${error.subcode || fbError.error_subcode}`);
        logger_1.default.error(`[BulkCreate] Error user_msg: ${error.userMessage || fbError.error_user_msg || fbError.error_user_title}`);
        logger_1.default.error(`[BulkCreate] Full response: ${JSON.stringify(responseData, null, 2)}`);
        logger_1.default.error(`[BulkCreate] Creative failed params: ${JSON.stringify(requestParams, null, 2)}`);
        return {
            success: false,
            error: {
                code: error.code || fbError.code || 'UNKNOWN',
                message: fbError.message || error.message,
                details: responseData,
            },
        };
    }
};
exports.createAdCreative = createAdCreative;
const createAd = async (params) => {
    const { accountId, token, adsetId, creativeId, name, status, trackingSpecs, urlTags, } = params;
    const requestParams = {
        access_token: token,
        adset_id: adsetId,
        creative: JSON.stringify({ creative_id: creativeId }),
        name,
        status,
    };
    if (trackingSpecs) {
        requestParams.tracking_specs = JSON.stringify(trackingSpecs);
    }
    if (urlTags) {
        requestParams.url_tags = urlTags;
    }
    try {
        logger_1.default.info(`[BulkCreate] Creating ad for adset ${adsetId}: ${name}`);
        const res = await facebookClient_1.facebookClient.post(`/act_${accountId}/ads`, requestParams);
        logger_1.default.info(`[BulkCreate] Ad created: ${res.id}`);
        return { success: true, id: res.id, data: res };
    }
    catch (error) {
        logger_1.default.error(`[BulkCreate] Failed to create ad:`, error.response?.data || error.message);
        return {
            success: false,
            error: {
                code: error.response?.data?.error?.code || 'UNKNOWN',
                message: error.response?.data?.error?.message || error.message,
                details: error.response?.data,
            },
        };
    }
};
exports.createAd = createAd;
const uploadImageFromUrl = async (params) => {
    const { accountId, token, imageUrl, name } = params;
    const requestParams = {
        access_token: token,
        url: imageUrl,
    };
    if (name) {
        requestParams.name = name;
    }
    try {
        logger_1.default.info(`[BulkCreate] Uploading image for account ${accountId}`);
        const res = await facebookClient_1.facebookClient.post(`/act_${accountId}/adimages`, requestParams);
        const images = res.images || {};
        const imageHash = Object.values(images)[0];
        logger_1.default.info(`[BulkCreate] Image uploaded, hash: ${imageHash?.hash}`);
        return { success: true, hash: imageHash?.hash, data: res };
    }
    catch (error) {
        logger_1.default.error(`[BulkCreate] Failed to upload image:`, error.response?.data || error.message);
        return {
            success: false,
            error: {
                code: error.response?.data?.error?.code || 'UNKNOWN',
                message: error.response?.data?.error?.message || error.message,
                details: error.response?.data,
            },
        };
    }
};
exports.uploadImageFromUrl = uploadImageFromUrl;
const uploadVideoFromUrl = async (params) => {
    const { accountId, token, videoUrl, title, description } = params;
    const requestParams = {
        access_token: token,
        file_url: videoUrl,
    };
    if (title) {
        requestParams.title = title;
    }
    if (description) {
        requestParams.description = description;
    }
    try {
        logger_1.default.info(`[BulkCreate] Uploading video for account ${accountId}`);
        const res = await facebookClient_1.facebookClient.post(`/act_${accountId}/advideos`, requestParams);
        logger_1.default.info(`[BulkCreate] Video uploaded, id: ${res.id}`);
        // 获取视频缩略图
        let thumbnailUrl;
        try {
            // 等待一小段时间让 Facebook 处理视频
            await new Promise(resolve => setTimeout(resolve, 2000));
            const videoDetails = await facebookClient_1.facebookClient.get(`/${res.id}`, {
                access_token: token,
                fields: 'thumbnails,picture',
            });
            // 优先使用 picture，其次使用 thumbnails 中的第一个
            if (videoDetails.picture) {
                thumbnailUrl = videoDetails.picture;
            }
            else if (videoDetails.thumbnails?.data?.[0]?.uri) {
                thumbnailUrl = videoDetails.thumbnails.data[0].uri;
            }
            logger_1.default.info(`[BulkCreate] Video thumbnail: ${thumbnailUrl}`);
        }
        catch (thumbError) {
            logger_1.default.warn(`[BulkCreate] Failed to get video thumbnail: ${thumbError.message}`);
        }
        return { success: true, id: res.id, thumbnailUrl, data: res };
    }
    catch (error) {
        logger_1.default.error(`[BulkCreate] Failed to upload video:`, error.response?.data || error.message);
        return {
            success: false,
            error: {
                code: error.response?.data?.error?.code || 'UNKNOWN',
                message: error.response?.data?.error?.message || error.message,
                details: error.response?.data,
            },
        };
    }
};
exports.uploadVideoFromUrl = uploadVideoFromUrl;
const searchTargetingInterests = async (params) => {
    const { token, query, type = 'adinterest', limit = 50 } = params;
    try {
        const res = await facebookClient_1.facebookClient.get('/search', {
            access_token: token,
            type,
            q: query,
            limit,
        });
        return { success: true, data: res.data || [] };
    }
    catch (error) {
        logger_1.default.error(`[BulkCreate] Failed to search interests:`, error.message);
        return { success: false, error: error.message, data: [] };
    }
};
exports.searchTargetingInterests = searchTargetingInterests;
const searchTargetingLocations = async (params) => {
    const { token, query, type = 'adgeolocation', limit = 50 } = params;
    try {
        const res = await facebookClient_1.facebookClient.get('/search', {
            access_token: token,
            type,
            q: query,
            location_types: JSON.stringify(['country', 'region', 'city']),
            limit,
        });
        return { success: true, data: res.data || [] };
    }
    catch (error) {
        logger_1.default.error(`[BulkCreate] Failed to search locations:`, error.message);
        return { success: false, error: error.message, data: [] };
    }
};
exports.searchTargetingLocations = searchTargetingLocations;
// ==================== 获取 Pages 和 Instagram ====================
const getPages = async (accountId, token) => {
    try {
        // 1. 先尝试从广告账户获取 promote_pages
        let pages = [];
        try {
            const promoteRes = await facebookClient_1.facebookClient.get(`/act_${accountId}/promote_pages`, {
                access_token: token,
                fields: 'id,name,picture',
                limit: 100,
            });
            pages = promoteRes.data || [];
        }
        catch (e) {
            logger_1.default.warn(`[BulkCreate] Failed to get promote_pages for ${accountId}: ${e.message}`);
        }
        // 2. 如果没有 promote_pages，获取用户有广告权限的所有主页
        if (pages.length === 0) {
            logger_1.default.info(`[BulkCreate] No promote_pages for ${accountId}, falling back to user pages`);
            const userPagesRes = await facebookClient_1.facebookClient.get('/me/accounts', {
                access_token: token,
                fields: 'id,name,picture,tasks',
                limit: 100,
            });
            // 只返回有 ADVERTISE 权限的主页
            pages = (userPagesRes.data || []).filter((page) => page.tasks && page.tasks.includes('ADVERTISE'));
            logger_1.default.info(`[BulkCreate] Found ${pages.length} user pages with ADVERTISE permission`);
        }
        return { success: true, data: pages };
    }
    catch (error) {
        logger_1.default.error(`[BulkCreate] Failed to get pages:`, error.message);
        return { success: false, error: error.message, data: [] };
    }
};
exports.getPages = getPages;
const getInstagramAccounts = async (pageId, token) => {
    try {
        const res = await facebookClient_1.facebookClient.get(`/${pageId}/instagram_accounts`, {
            access_token: token,
            fields: 'id,username,profile_pic',
        });
        return { success: true, data: res.data || [] };
    }
    catch (error) {
        logger_1.default.error(`[BulkCreate] Failed to get Instagram accounts:`, error.message);
        return { success: false, error: error.message, data: [] };
    }
};
exports.getInstagramAccounts = getInstagramAccounts;
// ==================== 获取 Pixels ====================
const getPixels = async (accountId, token) => {
    try {
        const res = await facebookClient_1.facebookClient.get(`/act_${accountId}/adspixels`, {
            access_token: token,
            fields: 'id,name,code,last_fired_time',
            limit: 100,
        });
        return { success: true, data: res.data || [] };
    }
    catch (error) {
        logger_1.default.error(`[BulkCreate] Failed to get pixels:`, error.message);
        return { success: false, error: error.message, data: [] };
    }
};
exports.getPixels = getPixels;
// ==================== 获取自定义转化事件 ====================
const getCustomConversions = async (accountId, token) => {
    try {
        const res = await facebookClient_1.facebookClient.get(`/act_${accountId}/customconversions`, {
            access_token: token,
            fields: 'id,name,pixel,rule,creation_time',
            limit: 100,
        });
        return { success: true, data: res.data || [] };
    }
    catch (error) {
        logger_1.default.error(`[BulkCreate] Failed to get custom conversions:`, error.message);
        return { success: false, error: error.message, data: [] };
    }
};
exports.getCustomConversions = getCustomConversions;
const updateCampaign = async (params) => {
    const { campaignId, token, ...updates } = params;
    const requestParams = {
        access_token: token,
    };
    if (updates.name)
        requestParams.name = updates.name;
    if (updates.status)
        requestParams.status = updates.status;
    if (updates.dailyBudget)
        requestParams.daily_budget = Math.round(updates.dailyBudget * 100);
    if (updates.lifetimeBudget)
        requestParams.lifetime_budget = Math.round(updates.lifetimeBudget * 100);
    if (updates.bidStrategy)
        requestParams.bid_strategy = updates.bidStrategy;
    try {
        const res = await facebookClient_1.facebookClient.post(`/${campaignId}`, requestParams);
        logger_1.default.info(`[BulkCreate] Campaign updated: ${campaignId}`);
        return { success: true, id: campaignId };
    }
    catch (error) {
        logger_1.default.error(`[BulkCreate] Failed to update campaign ${campaignId}:`, error.message);
        return { success: false, error: { message: error.message } };
    }
};
exports.updateCampaign = updateCampaign;
const updateAdSet = async (params) => {
    const { adsetId, token, ...updates } = params;
    const requestParams = {
        access_token: token,
    };
    if (updates.name)
        requestParams.name = updates.name;
    if (updates.status)
        requestParams.status = updates.status;
    if (updates.dailyBudget)
        requestParams.daily_budget = Math.round(updates.dailyBudget * 100);
    if (updates.lifetimeBudget)
        requestParams.lifetime_budget = Math.round(updates.lifetimeBudget * 100);
    if (updates.bidAmount)
        requestParams.bid_amount = Math.round(updates.bidAmount * 100);
    if (updates.targeting)
        requestParams.targeting = JSON.stringify(updates.targeting);
    try {
        const res = await facebookClient_1.facebookClient.post(`/${adsetId}`, requestParams);
        logger_1.default.info(`[BulkCreate] AdSet updated: ${adsetId}`);
        return { success: true, id: adsetId };
    }
    catch (error) {
        logger_1.default.error(`[BulkCreate] Failed to update adset ${adsetId}:`, error.message);
        return { success: false, error: { message: error.message } };
    }
};
exports.updateAdSet = updateAdSet;
const updateAd = async (params) => {
    const { adId, token, ...updates } = params;
    const requestParams = {
        access_token: token,
    };
    if (updates.name)
        requestParams.name = updates.name;
    if (updates.status)
        requestParams.status = updates.status;
    try {
        const res = await facebookClient_1.facebookClient.post(`/${adId}`, requestParams);
        logger_1.default.info(`[BulkCreate] Ad updated: ${adId}`);
        return { success: true, id: adId };
    }
    catch (error) {
        logger_1.default.error(`[BulkCreate] Failed to update ad ${adId}:`, error.message);
        return { success: false, error: { message: error.message } };
    }
};
exports.updateAd = updateAd;
