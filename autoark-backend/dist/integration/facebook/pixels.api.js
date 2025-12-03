"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPixelEvents = exports.getPixelDetails = exports.getPixels = void 0;
const facebookClient_1 = require("./facebookClient");
/**
 * 获取所有 Pixels
 */
const getPixels = async (token) => {
    const response = await facebookClient_1.facebookClient.get('/me/pixels', {
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
    return (response.data || []).map((pixel) => ({
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
        code = codeResponse.code;
    }
    catch (error) {
        // console.warn(`[Pixels] Failed to fetch code for pixel ${pixelId}:`, error)
        // 代码获取失败不影响主要信息
    }
    return {
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
        code,
        raw: pixel,
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
    return (response.data || []).map((event) => ({
        event_name: event.event_name,
        event_time: event.event_time,
        event_id: event.event_id,
        user_data: event.user_data,
        custom_data: event.custom_data,
        raw: event,
    }));
};
exports.getPixelEvents = getPixelEvents;
