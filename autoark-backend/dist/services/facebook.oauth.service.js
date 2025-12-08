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
exports.handleOAuthCallback = exports.validateOAuthConfigSync = exports.validateOAuthConfig = exports.getAvailableApps = exports.getFacebookLoginUrlSync = exports.getFacebookLoginUrl = void 0;
const logger_1 = __importDefault(require("../utils/logger"));
const FbToken_1 = __importDefault(require("../models/FbToken"));
const facebook_token_pool_1 = require("./facebook.token.pool");
const facebook_api_1 = require("./facebook.api");
const facebookPermissionsService = __importStar(require("./facebook.permissions.service"));
const oauthApi = __importStar(require("../integration/facebook/oauth.api"));
/**
 * Facebook OAuth 服务
 * 处理 Facebook 登录、授权码交换、Token 存储
 * 支持多 App 负载均衡
 */
/**
 * 生成 Facebook 登录 URL（异步，支持多 App）
 */
const getFacebookLoginUrl = async (state, appId) => {
    return oauthApi.getFacebookLoginUrl(state, appId);
};
exports.getFacebookLoginUrl = getFacebookLoginUrl;
/**
 * 生成 Facebook 登录 URL（同步版本，兼容旧代码）
 */
const getFacebookLoginUrlSync = (state) => {
    return oauthApi.getFacebookLoginUrlSync(state);
};
exports.getFacebookLoginUrlSync = getFacebookLoginUrlSync;
/**
 * 获取可用的 Apps 列表
 */
const getAvailableApps = async () => {
    return oauthApi.getAvailableApps();
};
exports.getAvailableApps = getAvailableApps;
/**
 * 验证 OAuth 配置（异步）
 */
const validateOAuthConfig = async () => {
    return oauthApi.validateOAuthConfig();
};
exports.validateOAuthConfig = validateOAuthConfig;
/**
 * 验证 OAuth 配置（同步，兼容旧代码）
 */
const validateOAuthConfigSync = () => {
    return oauthApi.validateOAuthConfigSync();
};
exports.validateOAuthConfigSync = validateOAuthConfigSync;
/**
 * 处理 OAuth 回调：获取 code → 交换 token → 存储 → 检查权限
 * 支持从 state 中解析使用的 App
 */
const handleOAuthCallback = async (code, state) => {
    try {
        logger_1.default.info('[OAuth] Handling OAuth callback');
        // 解析 state 获取 appId
        let appId;
        let originalState = '';
        if (state) {
            const stateData = oauthApi.parseStateParam(state);
            appId = stateData.appId;
            originalState = stateData.originalState;
            logger_1.default.info(`[OAuth] Using App ${appId || 'default'} from state`);
        }
        // 1. 将 code 交换为 Short-Lived Token
        const shortLivedTokenData = await oauthApi.exchangeCodeForToken(code, appId);
        const shortLivedToken = shortLivedTokenData.access_token;
        // 2. 获取用户信息
        const userInfo = await oauthApi.getUserInfo(shortLivedToken);
        // 3. 将 Short-Lived Token 交换为 Long-Lived Token
        const longLivedTokenData = await oauthApi.exchangeForLongLivedToken(shortLivedToken, appId);
        const longLivedToken = longLivedTokenData.access_token;
        // 计算过期时间
        const expiresIn = longLivedTokenData.expires_in || 5184000; // 默认 60 天
        const expiresAt = new Date(Date.now() + expiresIn * 1000);
        // 4. 存储或更新 Token（记录使用的 App）
        const tokenDoc = await FbToken_1.default.findOneAndUpdate({ fbUserId: userInfo.id }, {
            token: longLivedToken,
            fbUserId: userInfo.id,
            fbUserName: userInfo.name,
            status: 'active',
            expiresAt,
            lastCheckedAt: new Date(),
            // 记录使用的 App
            ...(appId && { lastAuthAppId: appId }),
        }, {
            upsert: true,
            new: true,
        });
        logger_1.default.info(`[OAuth] Token saved/updated for user ${userInfo.id} (${userInfo.name}) via App ${appId || 'env'}`);
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
            accessToken: longLivedToken,
            userDetails,
            permissions,
            appId,
        };
    }
    catch (error) {
        logger_1.default.error('[OAuth] Failed to handle OAuth callback:', error);
        throw error;
    }
};
exports.handleOAuthCallback = handleOAuthCallback;
