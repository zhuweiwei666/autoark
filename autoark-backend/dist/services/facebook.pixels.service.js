"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllPixelsFromAllTokens = exports.getPixelEvents = exports.getPixelDetails = exports.getPixelsByToken = exports.getAllPixels = void 0;
const facebook_api_1 = require("./facebook.api");
const logger_1 = __importDefault(require("../utils/logger"));
const FbToken_1 = __importDefault(require("../models/FbToken"));
const facebook_token_pool_1 = require("./facebook.token.pool");
/**
 * 获取所有 Pixels（通过 Token Pool 自动选择 token）
 */
const getAllPixels = async () => {
    try {
        // 使用 Token Pool 获取 token
        const token = facebook_token_pool_1.tokenPool.getNextToken();
        if (!token) {
            throw new Error('No available token in token pool');
        }
        logger_1.default.info('[Pixels] Fetching pixels using token pool');
        // 获取用户拥有的所有 pixels
        const response = await facebook_api_1.fbClient.get('/me/pixels', {
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
        const pixels = (response.data || []).map((pixel) => ({
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
        logger_1.default.info(`[Pixels] Fetched ${pixels.length} pixels`);
        return pixels;
    }
    catch (error) {
        logger_1.default.error('[Pixels] Failed to fetch pixels:', error);
        throw error;
    }
};
exports.getAllPixels = getAllPixels;
/**
 * 获取指定 Token 的 Pixels
 */
const getPixelsByToken = async (tokenId) => {
    try {
        const tokenDoc = await FbToken_1.default.findById(tokenId);
        if (!tokenDoc) {
            throw new Error(`Token ${tokenId} not found`);
        }
        logger_1.default.info(`[Pixels] Fetching pixels for token ${tokenId}`);
        const response = await facebook_api_1.fbClient.get('/me/pixels', {
            access_token: tokenDoc.token,
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
        const pixels = (response.data || []).map((pixel) => ({
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
        logger_1.default.info(`[Pixels] Fetched ${pixels.length} pixels for token ${tokenId}`);
        return pixels;
    }
    catch (error) {
        logger_1.default.error(`[Pixels] Failed to fetch pixels for token ${tokenId}:`, error);
        throw error;
    }
};
exports.getPixelsByToken = getPixelsByToken;
/**
 * 获取 Pixel 详情（包括代码）
 */
const getPixelDetails = async (pixelId, tokenId) => {
    try {
        let token;
        if (tokenId) {
            const tokenDoc = await FbToken_1.default.findById(tokenId);
            if (!tokenDoc) {
                throw new Error(`Token ${tokenId} not found`);
            }
            token = tokenDoc.token;
        }
        else {
            token = facebook_token_pool_1.tokenPool.getNextToken();
            if (!token) {
                throw new Error('No available token in token pool');
            }
        }
        logger_1.default.info(`[Pixels] Fetching details for pixel ${pixelId}`);
        // 获取 pixel 详情
        const pixel = await facebook_api_1.fbClient.get(`/${pixelId}`, {
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
            const codeResponse = await facebook_api_1.fbClient.get(`/${pixelId}`, {
                access_token: token,
                fields: 'code',
            });
            code = codeResponse.code;
        }
        catch (error) {
            logger_1.default.warn(`[Pixels] Failed to fetch code for pixel ${pixelId}:`, error);
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
    }
    catch (error) {
        logger_1.default.error(`[Pixels] Failed to fetch pixel details for ${pixelId}:`, error);
        throw error;
    }
};
exports.getPixelDetails = getPixelDetails;
/**
 * 获取 Pixel 事件（最近的事件）
 */
const getPixelEvents = async (pixelId, tokenId, limit = 100) => {
    try {
        let token;
        if (tokenId) {
            const tokenDoc = await FbToken_1.default.findById(tokenId);
            if (!tokenDoc) {
                throw new Error(`Token ${tokenId} not found`);
            }
            token = tokenDoc.token;
        }
        else {
            token = facebook_token_pool_1.tokenPool.getNextToken();
            if (!token) {
                throw new Error('No available token in token pool');
            }
        }
        logger_1.default.info(`[Pixels] Fetching events for pixel ${pixelId}`);
        const response = await facebook_api_1.fbClient.get(`/${pixelId}/events`, {
            access_token: token,
            limit,
            fields: ['event_name', 'event_time', 'event_id', 'user_data', 'custom_data'].join(','),
        });
        const events = (response.data || []).map((event) => ({
            event_name: event.event_name,
            event_time: event.event_time,
            event_id: event.event_id,
            user_data: event.user_data,
            custom_data: event.custom_data,
            raw: event,
        }));
        logger_1.default.info(`[Pixels] Fetched ${events.length} events for pixel ${pixelId}`);
        return events;
    }
    catch (error) {
        logger_1.default.error(`[Pixels] Failed to fetch events for pixel ${pixelId}:`, error);
        throw error;
    }
};
exports.getPixelEvents = getPixelEvents;
/**
 * 获取所有 Token 的 Pixels（汇总）
 */
const getAllPixelsFromAllTokens = async () => {
    try {
        const tokens = await FbToken_1.default.find({ status: 'active' }).lean();
        const allPixels = [];
        for (const token of tokens) {
            try {
                const pixels = await (0, exports.getPixelsByToken)(token._id.toString());
                for (const pixel of pixels) {
                    allPixels.push({
                        ...pixel,
                        tokenId: token._id.toString(),
                        fbUserId: token.fbUserId,
                        fbUserName: token.fbUserName,
                    });
                }
            }
            catch (error) {
                logger_1.default.warn(`[Pixels] Failed to fetch pixels for token ${token._id}:`, error);
                // 继续处理其他 token
            }
        }
        logger_1.default.info(`[Pixels] Fetched ${allPixels.length} pixels from ${tokens.length} tokens`);
        return allPixels;
    }
    catch (error) {
        logger_1.default.error('[Pixels] Failed to fetch pixels from all tokens:', error);
        throw error;
    }
};
exports.getAllPixelsFromAllTokens = getAllPixelsFromAllTokens;
