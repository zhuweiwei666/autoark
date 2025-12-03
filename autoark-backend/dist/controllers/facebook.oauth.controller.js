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
exports.getOAuthConfig = exports.handleCallback = exports.getLoginUrl = void 0;
const oauthService = __importStar(require("../services/facebook.oauth.service"));
const logger_1 = __importDefault(require("../utils/logger"));
/**
 * 获取 Facebook 登录 URL
 */
const getLoginUrl = async (req, res, next) => {
    try {
        // 验证配置
        const config = oauthService.validateOAuthConfig();
        if (!config.valid) {
            return res.status(500).json({
                success: false,
                message: `OAuth 配置不完整，缺少: ${config.missing.join(', ')}`,
                missing: config.missing,
            });
        }
        const { state } = req.query;
        const loginUrl = oauthService.getFacebookLoginUrl(state);
        res.json({
            success: true,
            data: {
                loginUrl,
            },
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getLoginUrl = getLoginUrl;
/**
 * OAuth 回调处理
 */
const handleCallback = async (req, res, next) => {
    try {
        const { code, error, error_reason, error_description } = req.query;
        // 检查是否有错误
        if (error) {
            logger_1.default.error('[OAuth] Facebook returned error:', { error, error_reason, error_description });
            return res.redirect(`/fb-token?oauth_error=${encodeURIComponent(error_description || error)}`);
        }
        if (!code) {
            return res.redirect('/fb-token?oauth_error=No authorization code received');
        }
        // 处理 OAuth 回调
        const result = await oauthService.handleOAuthCallback(code);
        // 重定向到 Token 管理页面，显示成功消息和用户信息
        const params = new URLSearchParams({
            oauth_success: 'true',
            token_id: result.tokenId,
            fb_user_id: result.fbUserId,
            fb_user_name: encodeURIComponent(result.fbUserName || ''),
        });
        // 如果有用户详细信息，也传递过去
        if (result.userDetails) {
            if (result.userDetails.email) {
                params.append('fb_user_email', result.userDetails.email);
            }
        }
        res.redirect(`/fb-token?${params.toString()}`);
    }
    catch (error) {
        logger_1.default.error('[OAuth] Callback handler failed:', error);
        res.redirect(`/fb-token?oauth_error=${encodeURIComponent(error.message || 'OAuth callback failed')}`);
    }
};
exports.handleCallback = handleCallback;
/**
 * 验证 OAuth 配置状态
 */
const getOAuthConfig = async (req, res, next) => {
    try {
        const config = oauthService.validateOAuthConfig();
        res.json({
            success: true,
            data: {
                configured: config.valid,
                missing: config.missing,
                redirectUri: process.env.FACEBOOK_REDIRECT_URI || '',
            },
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getOAuthConfig = getOAuthConfig;
