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
exports.handleOAuthCallback = exports.validateOAuthConfig = exports.getFacebookLoginUrl = void 0;
const logger_1 = __importDefault(require("../utils/logger"));
const FbToken_1 = __importDefault(require("../models/FbToken"));
const facebook_token_pool_1 = require("./facebook.token.pool");
const facebook_api_1 = require("./facebook.api");
const facebookPermissionsService = __importStar(require("./facebook.permissions.service"));
const oauthApi = __importStar(require("../integration/facebook/oauth.api"));
/**
 * Facebook OAuth 服务
 * 处理 Facebook 登录、授权码交换、Token 存储
 */
/**
 * 生成 Facebook 登录 URL
 */
const getFacebookLoginUrl = (state) => {
    return oauthApi.getFacebookLoginUrl(state);
};
exports.getFacebookLoginUrl = getFacebookLoginUrl;
/**
 * 验证 OAuth 配置
 */
const validateOAuthConfig = () => {
    return oauthApi.validateOAuthConfig();
};
exports.validateOAuthConfig = validateOAuthConfig;
/**
 * 处理 OAuth 回调：获取 code → 交换 token → 存储 → 检查权限
 */
const handleOAuthCallback = async (code) => {
    try {
        logger_1.default.info('[OAuth] Handling OAuth callback');
        // 1. 将 code 交换为 Short-Lived Token
        const shortLivedTokenData = await oauthApi.exchangeCodeForToken(code);
        const shortLivedToken = shortLivedTokenData.access_token;
        // 2. 获取用户信息
        const userInfo = await oauthApi.getUserInfo(shortLivedToken);
        // 3. 将 Short-Lived Token 交换为 Long-Lived Token
        const longLivedTokenData = await oauthApi.exchangeForLongLivedToken(shortLivedToken);
        const longLivedToken = longLivedTokenData.access_token;
        // 计算过期时间
        const expiresIn = longLivedTokenData.expires_in || 5184000; // 默认 60 天
        const expiresAt = new Date(Date.now() + expiresIn * 1000);
        // 4. 存储或更新 Token
        const tokenDoc = await FbToken_1.default.findOneAndUpdate({ fbUserId: userInfo.id }, {
            token: longLivedToken,
            fbUserId: userInfo.id,
            fbUserName: userInfo.name,
            status: 'active',
            expiresAt,
            lastCheckedAt: new Date(),
        }, {
            upsert: true,
            new: true,
        });
        logger_1.default.info(`[OAuth] Token saved/updated for user ${userInfo.id} (${userInfo.name})`);
        // 5. 重新初始化 Token Pool（包含新 token）
        await facebook_token_pool_1.tokenPool.initialize();
        // 6. 获取用户详细信息（包括邮箱等）
        let userDetails = {
            id: userInfo.id,
            name: userInfo.name,
            email: userInfo.email,
        };
        try {
            // 尝试获取更多用户信息
            const userData = await facebook_api_1.fbClient.get('/me', {
                access_token: longLivedToken,
                fields: 'id,name,email,picture',
            });
            userDetails = {
                ...userDetails,
                ...userData,
            };
        }
        catch (error) {
            logger_1.default.warn(`[OAuth] Failed to get additional user info:`, error);
            // 获取额外信息失败不影响主要流程
        }
        // 7. 检查权限（可选，不阻塞）
        let permissions = null;
        try {
            const diagnosis = await facebookPermissionsService.diagnoseToken(tokenDoc._id.toString());
            permissions = diagnosis;
        }
        catch (error) {
            logger_1.default.warn(`[OAuth] Failed to diagnose permissions for token ${tokenDoc._id}:`, error);
            // 权限检查失败不影响 token 存储
        }
        return {
            tokenId: tokenDoc._id.toString(),
            fbUserId: userInfo.id,
            fbUserName: userInfo.name,
            userDetails,
            permissions,
        };
    }
    catch (error) {
        logger_1.default.error('[OAuth] Failed to handle OAuth callback:', error);
        throw error;
    }
};
exports.handleOAuthCallback = handleOAuthCallback;
