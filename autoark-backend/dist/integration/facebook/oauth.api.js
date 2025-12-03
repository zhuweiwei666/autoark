"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateOAuthConfig = exports.getUserInfo = exports.exchangeForLongLivedToken = exports.exchangeCodeForToken = exports.getFacebookLoginUrl = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../../utils/logger"));
const FB_API_VERSION = 'v19.0';
const FB_GRAPH_BASE_URL = 'https://graph.facebook.com';
const FB_OAUTH_BASE_URL = 'https://www.facebook.com';
const FB_APP_ID = process.env.FACEBOOK_APP_ID || '';
const FB_APP_SECRET = process.env.FACEBOOK_APP_SECRET || '';
const FB_REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI || 'http://localhost:3001/api/facebook/oauth/callback';
/**
 * 生成 Facebook 登录 URL
 */
const getFacebookLoginUrl = (state) => {
    const scopes = [
        'ads_read',
        'ads_management',
        'business_management',
        'pages_read_engagement',
        'pages_manage_metadata',
        'pixel_read',
        'pixel_write',
        'offline_access', // 重要：获取长期 token
    ].join(',');
    const params = new URLSearchParams({
        client_id: FB_APP_ID,
        redirect_uri: FB_REDIRECT_URI,
        scope: scopes,
        response_type: 'code',
        state: state || '',
        auth_type: 'rerequest', // 重新请求权限（如果之前拒绝过）
    });
    return `${FB_OAUTH_BASE_URL}/${FB_API_VERSION}/dialog/oauth?${params.toString()}`;
};
exports.getFacebookLoginUrl = getFacebookLoginUrl;
/**
 * 将授权码（code）交换为 Access Token
 */
const exchangeCodeForToken = async (code) => {
    try {
        logger_1.default.info('[OAuth] Exchanging code for access token');
        const response = await axios_1.default.get(`${FB_GRAPH_BASE_URL}/${FB_API_VERSION}/oauth/access_token`, {
            params: {
                client_id: FB_APP_ID,
                client_secret: FB_APP_SECRET,
                redirect_uri: FB_REDIRECT_URI,
                code,
            },
        });
        if (!response.data.access_token) {
            throw new Error('Failed to get access token from Facebook');
        }
        logger_1.default.info('[OAuth] Successfully exchanged code for access token');
        return response.data;
    }
    catch (error) {
        logger_1.default.error('[OAuth] Failed to exchange code for token:', error.response?.data || error.message);
        throw new Error(`Failed to exchange code: ${error.response?.data?.error?.message || error.message}`);
    }
};
exports.exchangeCodeForToken = exchangeCodeForToken;
/**
 * 将 Short-Lived Token 交换为 Long-Lived Token
 */
const exchangeForLongLivedToken = async (shortLivedToken) => {
    try {
        logger_1.default.info('[OAuth] Exchanging short-lived token for long-lived token');
        const response = await axios_1.default.get(`${FB_GRAPH_BASE_URL}/${FB_API_VERSION}/oauth/access_token`, {
            params: {
                grant_type: 'fb_exchange_token',
                client_id: FB_APP_ID,
                client_secret: FB_APP_SECRET,
                fb_exchange_token: shortLivedToken,
            },
        });
        if (!response.data.access_token) {
            throw new Error('Failed to get long-lived token from Facebook');
        }
        logger_1.default.info(`[OAuth] Successfully exchanged for long-lived token, expires in ${response.data.expires_in} seconds`);
        return response.data;
    }
    catch (error) {
        logger_1.default.error('[OAuth] Failed to exchange for long-lived token:', error.response?.data || error.message);
        throw new Error(`Failed to exchange for long-lived token: ${error.response?.data?.error?.message || error.message}`);
    }
};
exports.exchangeForLongLivedToken = exchangeForLongLivedToken;
/**
 * 获取用户信息
 */
const getUserInfo = async (accessToken) => {
    try {
        const response = await axios_1.default.get(`${FB_GRAPH_BASE_URL}/${FB_API_VERSION}/me`, {
            params: {
                access_token: accessToken,
                fields: 'id,name,email',
            },
        });
        return {
            id: response.data.id,
            name: response.data.name || 'Unknown User',
            email: response.data.email,
        };
    }
    catch (error) {
        logger_1.default.error('[OAuth] Failed to get user info:', error.response?.data || error.message);
        throw new Error(`Failed to get user info: ${error.response?.data?.error?.message || error.message}`);
    }
};
exports.getUserInfo = getUserInfo;
/**
 * 验证 OAuth 配置
 */
const validateOAuthConfig = () => {
    const missing = [];
    if (!FB_APP_ID) {
        missing.push('FACEBOOK_APP_ID');
    }
    if (!FB_APP_SECRET) {
        missing.push('FACEBOOK_APP_SECRET');
    }
    if (!FB_REDIRECT_URI) {
        missing.push('FACEBOOK_REDIRECT_URI');
    }
    return {
        valid: missing.length === 0,
        missing,
    };
};
exports.validateOAuthConfig = validateOAuthConfig;
