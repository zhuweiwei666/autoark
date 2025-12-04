"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllPixelsFromAllTokens = exports.getPixelEvents = exports.getPixelDetails = exports.getPixelsByToken = exports.getAllPixels = void 0;
const logger_1 = __importDefault(require("../utils/logger"));
const FbToken_1 = __importDefault(require("../models/FbToken"));
const facebook_token_pool_1 = require("./facebook.token.pool");
const pixels_api_1 = require("../integration/facebook/pixels.api");
/**
 * 获取所有 Pixels（通过 Token Pool 自动选择 token）
 */
const getAllPixels = async () => {
    try {
        // 使用 Token Pool 获取 token
        let token = facebook_token_pool_1.tokenPool.getNextToken();
        // 如果 Token Pool 没有可用 token，尝试从数据库获取第一个活跃的 token
        if (!token) {
            logger_1.default.warn('[Pixels] No token from token pool, trying to get from database');
            const tokenDoc = await FbToken_1.default.findOne({ status: 'active' }).sort({ createdAt: 1 }).lean();
            if (tokenDoc) {
                token = tokenDoc.token;
                logger_1.default.info('[Pixels] Using token from database as fallback');
            }
            else {
                throw new Error('No available token in token pool or database');
            }
        }
        logger_1.default.info('[Pixels] Fetching pixels using token pool');
        // 使用集成层的 API
        const pixels = await (0, pixels_api_1.getPixels)(token);
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
        // 使用集成层的 API
        const pixels = await (0, pixels_api_1.getPixels)(tokenDoc.token);
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
        // 使用集成层的 API
        const pixel = await (0, pixels_api_1.getPixelDetails)(pixelId, token);
        return pixel;
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
        // 使用集成层的 API
        const events = await (0, pixels_api_1.getPixelEvents)(pixelId, token, limit);
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
