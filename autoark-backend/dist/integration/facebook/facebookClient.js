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
class FacebookApiError extends Error {
    constructor(message, responseData) {
        super(message);
        this.name = 'FacebookApiError';
        this.response = responseData;
        if (responseData?.error) {
            this.code = responseData.error.code;
            this.subcode = responseData.error.error_subcode;
            this.userMessage = responseData.error.error_user_msg || responseData.error.error_user_title;
        }
    }
}
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
        const rateLimitError = new FacebookApiError(`RATE_LIMIT: ${errMsg}`, error.response?.data);
        throw rateLimitError;
    }
    logger_1.default.error(`Facebook API Error [${context}]: ${errMsg}`);
    logger_1.default.error(`Facebook API Full Response: ${JSON.stringify(error.response?.data, null, 2)}`);
    const apiError = new FacebookApiError(`Facebook API [${context}] failed: ${errMsg}`, error.response?.data);
    throw apiError;
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
                timeout: 60000, // 60s timeout
            };
            if (method === 'GET') {
                // GET 请求：所有参数都放在 URL query string 中
                const allParams = {
                    access_token: token,
                };
                // 处理参数，确保不重复添加 access_token
                for (const [key, value] of Object.entries(dataOrParams)) {
                    if (key !== 'access_token' && value !== undefined) {
                        allParams[key] = value;
                    }
                }
                // 使用自定义序列化器确保 JSON 字符串正确编码
                config.params = allParams;
                config.paramsSerializer = (params) => {
                    const parts = [];
                    for (const [key, value] of Object.entries(params)) {
                        if (value !== undefined && value !== null) {
                            parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
                        }
                    }
                    return parts.join('&');
                };
            }
            else {
                // POST 请求：access_token 放在 URL 参数中，其他数据放在请求体中
                // Facebook Graph API 要求 POST 请求使用 application/x-www-form-urlencoded 格式
                // 这样可以避免 URL 长度限制，并符合 Facebook API 的标准要求
                config.params = {
                    access_token: token,
                };
                // 构建请求体数据（排除 access_token）
                const bodyParts = [];
                for (const [key, value] of Object.entries(dataOrParams)) {
                    if (key !== 'access_token' && value !== undefined && value !== null) {
                        bodyParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
                    }
                }
                // 使用 application/x-www-form-urlencoded 格式发送数据
                config.data = bodyParts.join('&');
                config.headers = {
                    'Content-Type': 'application/x-www-form-urlencoded',
                };
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
