"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPixelEvents = exports.getPixelDetails = exports.getPixels = void 0;
const facebookClient_1 = require("./facebookClient");
/**
 * 获取所有 Pixels
 * Facebook Graph API: 需要通过 Business Manager 或 Ad Account 访问
 * 尝试多种端点：/me/adspixels, /me/businesses/{id}/owned_pixels
 */
const getPixels = async (token) => {
    // 方法1: 尝试通过 /me/adspixels（需要 ads_read 权限）
    try {
        const response = await facebookClient_1.facebookClient.get('/me/adspixels', {
            access_token: token,
            fields: [
                'id',
                'name',
                'owner_business',
                'is_created_by_business',
                'creation_time',
                'last_fired_time',
                'data_use_setting',
                'enable_automatic_matching',
            ].join(','),
        });
        // Facebook Graph API 返回格式: { data: [...], paging: {...} }
        const pixels = Array.isArray(response) ? response : (response.data || []);
        if (pixels.length > 0) {
            return pixels.map((pixel) => ({
                id: pixel.id,
                name: pixel.name || 'Unnamed Pixel',
                owner_business: pixel.owner_business
                    ? {
                        id: pixel.owner_business.id,
                        name: pixel.owner_business.name || 'Unknown Business',
                    }
                    : undefined,
                is_created_by_business: pixel.is_created_by_business || false,
                creation_time: pixel.creation_time,
                last_fired_time: pixel.last_fired_time,
                data_use_setting: pixel.data_use_setting,
                enable_automatic_matching: pixel.enable_automatic_matching,
                raw: pixel,
            }));
        }
    }
    catch (error) {
        // 如果 /me/adspixels 失败，尝试其他方法
        console.warn('[Pixels API] /me/adspixels failed, trying alternative methods:', error.message);
    }
    // 方法2: 尝试通过 Business Manager
    try {
        // 先获取用户的 Business Managers
        const businesses = await facebookClient_1.facebookClient.get('/me/businesses', {
            access_token: token,
            fields: 'id,name',
        });
        const businessList = Array.isArray(businesses) ? businesses : (businesses.data || []);
        const allPixels = [];
        for (const business of businessList) {
            try {
                const pixelsResponse = await facebookClient_1.facebookClient.get(`/${business.id}/owned_pixels`, {
                    access_token: token,
                    fields: [
                        'id',
                        'name',
                        'owner_business',
                        'is_created_by_business',
                        'creation_time',
                        'last_fired_time',
                        'data_use_setting',
                        'enable_automatic_matching',
                    ].join(','),
                });
                const pixels = Array.isArray(pixelsResponse) ? pixelsResponse : (pixelsResponse.data || []);
                allPixels.push(...pixels);
            }
            catch (error) {
                console.warn(`[Pixels API] Failed to get pixels for business ${business.id}:`, error.message);
            }
        }
        if (allPixels.length > 0) {
            return allPixels.map((pixel) => ({
                id: pixel.id,
                name: pixel.name || 'Unnamed Pixel',
                owner_business: pixel.owner_business
                    ? {
                        id: pixel.owner_business.id,
                        name: pixel.owner_business.name || 'Unknown Business',
                    }
                    : undefined,
                is_created_by_business: pixel.is_created_by_business || false,
                creation_time: pixel.creation_time,
                last_fired_time: pixel.last_fired_time,
                data_use_setting: pixel.data_use_setting,
                enable_automatic_matching: pixel.enable_automatic_matching,
                raw: pixel,
            }));
        }
    }
    catch (error) {
        console.warn('[Pixels API] Business Manager method failed:', error.message);
    }
    // 如果所有方法都失败，返回空数组（而不是抛出错误）
    return [];
};
exports.getPixels = getPixels;
/**
 * 获取 Pixel 详情（包括代码）
 */
const getPixelDetails = async (pixelId, token) => {
    // 获取 pixel 详情
    const pixel = await facebookClient_1.facebookClient.get(`/${pixelId}`, {
        access_token: token,
        fields: [
            'id',
            'name',
            'owner_business',
            'is_created_by_business',
            'creation_time',
            'last_fired_time',
            'data_use_setting',
            'enable_automatic_matching',
        ].join(','),
    });
    // 获取 pixel 代码（需要额外请求）
    let code;
    try {
        const codeResponse = await facebookClient_1.facebookClient.get(`/${pixelId}`, {
            access_token: token,
            fields: 'code',
        });
        // 单个对象响应，直接返回对象本身
        code = codeResponse.code || codeResponse.data?.code;
    }
    catch (error) {
        // console.warn(`[Pixels] Failed to fetch code for pixel ${pixelId}:`, error)
        // 代码获取失败不影响主要信息
    }
    // 处理响应格式：可能是对象本身，也可能是 { data: {...} }
    const pixelData = pixel.data || pixel;
    return {
        id: pixelData.id,
        name: pixelData.name || 'Unnamed Pixel',
        owner_business: pixelData.owner_business
            ? {
                id: pixelData.owner_business.id,
                name: pixelData.owner_business.name || 'Unknown Business',
            }
            : undefined,
        is_created_by_business: pixelData.is_created_by_business || false,
        creation_time: pixelData.creation_time,
        last_fired_time: pixelData.last_fired_time,
        data_use_setting: pixelData.data_use_setting,
        enable_automatic_matching: pixelData.enable_automatic_matching,
        code,
        raw: pixelData,
    };
};
exports.getPixelDetails = getPixelDetails;
/**
 * 获取 Pixel 事件（最近的事件）
 */
const getPixelEvents = async (pixelId, token, limit = 100) => {
    const response = await facebookClient_1.facebookClient.get(`/${pixelId}/events`, {
        access_token: token,
        limit,
        fields: ['event_name', 'event_time', 'event_id', 'user_data', 'custom_data'].join(','),
    });
    // Facebook Graph API 返回格式: { data: [...], paging: {...} }
    const events = Array.isArray(response) ? response : (response.data || []);
    return events.map((event) => ({
        event_name: event.event_name,
        event_time: event.event_time,
        event_id: event.event_id,
        user_data: event.user_data,
        custom_data: event.custom_data,
        raw: event,
    }));
};
exports.getPixelEvents = getPixelEvents;
