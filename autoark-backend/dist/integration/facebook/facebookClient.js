"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.facebookClient = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../../utils/logger"));
const fbToken_1 = require("../../utils/fbToken");
const tokenPool_1 = require("./tokenPool");
const FB_API_VERSION = 'v19.0';
const FB_BASE_URL = 'https://graph.facebook.com';
const handleApiError = (context, error, token) => {
    const errMsg = error.response?.data?.error?.message || error.message;
    const errorCode = error.response?.data?.error?.code;
    // 限流错误：通知 Token Pool
    if (errorCode === 4 || // Application request limit reached
        errorCode === 17 || // User request limit reached
        errMsg.includes('rate limit') ||
        errMsg.includes('request limit')) {
        if (token) {
            // 通知 Token Pool
            tokenPool_1.tokenPool.markTokenFailure(token, error);
        }
        logger_1.default.warn(`Facebook API Rate Limit [${context}]: ${errMsg}`);
        throw new Error(`RATE_LIMIT: ${errMsg}`);
    }
    logger_1.default.error(`Facebook API Error [${context}]: ${errMsg}`, error.response?.data);
    throw new Error(`Facebook API [${context}] failed: ${errMsg}`);
};
exports.facebookClient = {
    get: async (endpoint, params = {}) => {
        // ... (existing get logic implementation details omitted for brevity, but logically present)
        return request('GET', endpoint, params);
    },
    post: async (endpoint, data = {}, params = {}) => {
        return request('POST', endpoint, { ...params, ...data }); // FB API often takes data as params/query for POST too, but typically body. 
        // Graph API can take params in URL or body. Axios 'params' is URL query, 'data' is body.
        // For FB Graph API, simple fields can go in params or formData.
        // Let's refine the request helper.
    }
};
// 统一请求处理函数
const request = async (method, endpoint, dataOrParams = {}) => {
    const startTime = Date.now();
    const url = `${FB_BASE_URL}/${FB_API_VERSION}${endpoint}`;
    // 尝试使用 Token Pool（如果可用）
    let token = dataOrParams.access_token;
    if (!token) {
        if (tokenPool_1.tokenPool && tokenPool_1.tokenPool.getNextToken) {
            token = tokenPool_1.tokenPool.getNextToken();
        }
        if (!token) {
            token = await (0, fbToken_1.getFacebookAccessToken)();
        }
    }
    let retries = 0;
    const maxRetries = 3;
    while (retries < maxRetries) {
        try {
            const config = {
                method,
                url,
            };
            if (method === 'GET') {
                config.params = {
                    access_token: token,
                    ...dataOrParams,
                };
            }
            else {
                // POST
                config.params = { access_token: token }; // Token 通常放在 URL 参数中
                config.data = dataOrParams;
            }
            const res = await (0, axios_1.default)(config);
            // 标记成功
            if (tokenPool_1.tokenPool && tokenPool_1.tokenPool.markTokenSuccess) {
                tokenPool_1.tokenPool.markTokenSuccess(token);
            }
            logger_1.default.timerLog(`[Facebook API] ${method} ${endpoint}`, startTime);
            return res.data;
        }
        catch (error) {
            const errorCode = error.response?.data?.error?.code;
            const errMsg = error.response?.data?.error?.message || error.message;
            // 限流错误：尝试切换 token 或等待
            if ((errorCode === 4 || errorCode === 17 || errMsg.includes('rate limit')) &&
                retries < maxRetries - 1) {
                // 标记当前 token 失败
                if (tokenPool_1.tokenPool && tokenPool_1.tokenPool.markTokenFailure) {
                    tokenPool_1.tokenPool.markTokenFailure(token, error);
                }
                // 尝试获取新 token
                if (tokenPool_1.tokenPool && tokenPool_1.tokenPool.getNextToken) {
                    const newToken = tokenPool_1.tokenPool.getNextToken();
                    if (newToken && newToken !== token) {
                        token = newToken;
                        logger_1.default.info(`[Facebook API] Switched to new token due to rate limit`);
                        retries++;
                        continue;
                    }
                }
                // 随机退避
                const backoff = 2000 + Math.random() * 500;
                logger_1.default.warn(`[Facebook API] Rate limited, backing off ${backoff}ms`);
                await new Promise((resolve) => setTimeout(resolve, backoff));
                retries++;
                continue;
            }
            // 其他错误：直接抛出
            handleApiError(`${method} ${endpoint}`, error, token);
        }
    }
    // 所有重试都失败
    throw new Error(`Facebook API [${method} ${endpoint}] failed after ${maxRetries} retries`);
};
