"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchImageByHash = exports.fetchVideoSource = exports.fetchCreatives = exports.fetchAds = exports.fetchAdSets = void 0;
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
        // 增强 creative 字段，获取 image_hash, video_id 等素材标识
        fields: 'id,name,status,adset_id,campaign_id,creative{id,name,image_hash,image_url,thumbnail_url,video_id,object_story_spec},created_time,updated_time',
        limit: 1000,
    };
    if (token) {
        params.access_token = token;
    }
    const res = await facebookClient_1.facebookClient.get(`/${accountId}/ads`, params);
    return res.data || [];
};
exports.fetchAds = fetchAds;
const fetchCreatives = async (accountId, token) => {
    const params = {
        // 增强字段，获取 image_hash, video_id 等素材标识
        fields: 'id,name,status,image_hash,image_url,thumbnail_url,video_id,object_story_spec,asset_feed_spec,effective_object_story_id',
        limit: 500,
    };
    if (token) {
        params.access_token = token;
    }
    const res = await facebookClient_1.facebookClient.get(`/${accountId}/adcreatives`, params);
    return res.data || [];
};
exports.fetchCreatives = fetchCreatives;
/**
 * 获取视频源文件 URL（用于下载原视频）
 * Facebook 视频 URL 是临时的，需要及时下载
 */
const fetchVideoSource = async (videoId, token) => {
    const params = {
        fields: 'source,picture,thumbnails,length,created_time',
    };
    if (token) {
        params.access_token = token;
    }
    try {
        const res = await facebookClient_1.facebookClient.get(`/${videoId}`, params);
        return {
            success: true,
            source: res.source, // 视频源文件 URL
            picture: res.picture, // 封面图
            thumbnails: res.thumbnails?.data || [],
            length: res.length, // 时长（秒）
        };
    }
    catch (error) {
        return { success: false, error: error.message };
    }
};
exports.fetchVideoSource = fetchVideoSource;
/**
 * 获取图片原图 URL（通过 image_hash）
 */
const fetchImageByHash = async (accountId, imageHash, token) => {
    const params = {
        hashes: [imageHash],
    };
    if (token) {
        params.access_token = token;
    }
    try {
        const res = await facebookClient_1.facebookClient.get(`/${accountId}/adimages`, params);
        const images = res.data?.data || res.data || {};
        // 返回第一个匹配的图片
        const imageData = images[imageHash] || Object.values(images)[0];
        if (imageData) {
            return {
                success: true,
                url: imageData.url || imageData.url_128, // url 是原图
                url_128: imageData.url_128,
                permalink_url: imageData.permalink_url,
                width: imageData.width,
                height: imageData.height,
            };
        }
        return { success: false, error: 'Image not found' };
    }
    catch (error) {
        return { success: false, error: error.message };
    }
};
exports.fetchImageByHash = fetchImageByHash;
