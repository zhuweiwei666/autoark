"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshTiktokToken = exports.exchangeTiktokCodeForToken = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../../utils/logger"));
const TIKTOK_AUTH_BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3';
/**
 * TikTok OAuth API
 */
const exchangeTiktokCodeForToken = async (appId, secret, authCode) => {
    try {
        const response = await axios_1.default.post(`${TIKTOK_AUTH_BASE_URL}/oauth2/access_token/`, {
            app_id: appId,
            secret,
            auth_code: authCode,
        });
        if (response.data.code !== 0) {
            throw new Error(`TikTok OAuth Error: ${response.data.message} (code: ${response.data.code})`);
        }
        return response.data.data;
    }
    catch (error) {
        logger_1.default.error(`[TikTokOAuth] exchange token failed:`, error.response?.data || error.message);
        throw error;
    }
};
exports.exchangeTiktokCodeForToken = exchangeTiktokCodeForToken;
const refreshTiktokToken = async (appId, secret, refreshToken) => {
    try {
        const response = await axios_1.default.post(`${TIKTOK_AUTH_BASE_URL}/oauth2/refresh_token/`, {
            app_id: appId,
            secret,
            refresh_token: refreshToken,
        });
        if (response.data.code !== 0) {
            throw new Error(`TikTok OAuth Error: ${response.data.message} (code: ${response.data.code})`);
        }
        return response.data.data;
    }
    catch (error) {
        logger_1.default.error(`[TikTokOAuth] refresh token failed:`, error.response?.data || error.message);
        throw error;
    }
};
exports.refreshTiktokToken = refreshTiktokToken;
