"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateToken = validateToken;
exports.checkAndUpdateTokenStatus = checkAndUpdateTokenStatus;
exports.checkAllTokensStatus = checkAllTokensStatus;
const axios_1 = __importDefault(require("axios"));
const FbToken_1 = __importDefault(require("../models/FbToken"));
const logger_1 = __importDefault(require("../utils/logger"));
const FB_API_VERSION = 'v19.0';
const FB_BASE_URL = 'https://graph.facebook.com';
/**
 * 验证单个 token 是否有效
 * @param token Facebook access token
 * @returns { isValid: boolean, fbUser?: any, expiresAt?: Date }
 */
async function validateToken(token) {
    try {
        // 检查 token 基本信息
        const userResponse = await axios_1.default.get(`${FB_BASE_URL}/${FB_API_VERSION}/me`, {
            params: {
                access_token: token,
                fields: 'id,name,email',
            },
            timeout: 10000, // 10 秒超时
        });
        if (!userResponse.data || !userResponse.data.id) {
            return { isValid: false, error: 'Invalid token response' };
        }
        // 检查 token 的权限和过期时间
        let expiresAt;
        try {
            const debugResponse = await axios_1.default.get(`${FB_BASE_URL}/${FB_API_VERSION}/debug_token`, {
                params: {
                    input_token: token,
                    access_token: token, // 需要 app access token，这里用 user token 也可以
                },
                timeout: 10000,
            });
            if (debugResponse.data?.data) {
                const data = debugResponse.data.data;
                // expires_at 是 Unix 时间戳（秒）
                if (data.expires_at && data.expires_at > 0) {
                    expiresAt = new Date(data.expires_at * 1000);
                }
            }
        }
        catch (debugErr) {
            // debug_token 可能失败，但不影响基本验证
            logger_1.default.warn('Failed to get token debug info:', debugErr);
        }
        return {
            isValid: true,
            fbUser: userResponse.data,
            expiresAt,
        };
    }
    catch (error) {
        const errorMessage = error.response?.data?.error?.message || error.message || 'Unknown error';
        const errorCode = error.response?.data?.error?.code;
        // Facebook API 错误码：
        // 190: Invalid OAuth 2.0 Access Token
        // 102: Session key invalid or no longer valid
        if (errorCode === 190 || errorCode === 102) {
            return { isValid: false, error: errorMessage };
        }
        // 网络错误或其他错误
        logger_1.default.error('Token validation error:', error);
        return { isValid: false, error: errorMessage };
    }
}
/**
 * 检查并更新 token 状态
 * @param tokenDoc FbToken 文档
 * @returns 更新后的状态
 */
async function checkAndUpdateTokenStatus(tokenDoc) {
    const startTime = Date.now();
    logger_1.default.info(`[Token Validation] Checking token for user: ${tokenDoc.userId}`);
    try {
        const validation = await validateToken(tokenDoc.token);
        let newStatus = 'active';
        const updateData = {
            lastCheckedAt: new Date(),
        };
        if (validation.isValid) {
            newStatus = 'active';
            if (validation.fbUser) {
                updateData.fbUserId = validation.fbUser.id;
                updateData.fbUserName = validation.fbUser.name;
            }
            if (validation.expiresAt) {
                updateData.expiresAt = validation.expiresAt;
                // 如果过期时间已过，标记为 expired
                if (validation.expiresAt < new Date()) {
                    newStatus = 'expired';
                }
            }
            logger_1.default.info(`[Token Validation] Token is valid for user: ${tokenDoc.userId}`);
        }
        else {
            newStatus = 'invalid';
            logger_1.default.warn(`[Token Validation] Token is invalid for user: ${tokenDoc.userId}, error: ${validation.error}`);
        }
        updateData.status = newStatus;
        // 更新数据库
        await FbToken_1.default.findByIdAndUpdate(tokenDoc._id, updateData);
        logger_1.default.timerLog(`[Token Validation] Check completed for user: ${tokenDoc.userId}`, startTime);
        return newStatus;
    }
    catch (error) {
        logger_1.default.error(`[Token Validation] Failed to check token for user: ${tokenDoc.userId}`, error);
        // 标记为 invalid
        await FbToken_1.default.findByIdAndUpdate(tokenDoc._id, {
            status: 'invalid',
            lastCheckedAt: new Date(),
        });
        return 'invalid';
    }
}
/**
 * 检查所有 token 的状态
 */
async function checkAllTokensStatus() {
    logger_1.default.info('[Token Validation] Starting batch token validation');
    try {
        const tokens = await FbToken_1.default.find({});
        logger_1.default.info(`[Token Validation] Found ${tokens.length} tokens to check`);
        const results = await Promise.allSettled(tokens.map((token) => checkAndUpdateTokenStatus(token)));
        const successCount = results.filter((r) => r.status === 'fulfilled').length;
        const failedCount = results.filter((r) => r.status === 'rejected').length;
        logger_1.default.info(`[Token Validation] Batch validation completed: ${successCount} succeeded, ${failedCount} failed`);
    }
    catch (error) {
        logger_1.default.error('[Token Validation] Batch validation failed:', error);
    }
}
