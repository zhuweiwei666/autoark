"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CACHE_TTL = exports.clearCache = exports.deleteFromCache = exports.setToCache = exports.getFromCache = exports.getCacheKey = void 0;
const redis_1 = require("../config/redis");
const logger_1 = __importDefault(require("./logger"));
const CACHE_TTL = {
    TODAY: 5 * 60, // 5 分钟（今天的数据）
    DATE_RANGE: 10 * 60, // 10 分钟（日期范围的数据）
};
exports.CACHE_TTL = CACHE_TTL;
/**
 * 生成缓存键
 */
const getCacheKey = (prefix, params) => {
    const sortedParams = Object.keys(params)
        .sort()
        .map((key) => `${key}:${params[key]}`)
        .join('|');
    return `cache:${prefix}:${sortedParams}`;
};
exports.getCacheKey = getCacheKey;
/**
 * 从缓存获取数据
 */
const getFromCache = async (key) => {
    const redis = (0, redis_1.getRedisClient)();
    if (!redis) {
        return null;
    }
    try {
        const data = await redis.get(key);
        if (data) {
            return JSON.parse(data);
        }
        return null;
    }
    catch (error) {
        logger_1.default.error(`Cache get error for key ${key}:`, error);
        return null;
    }
};
exports.getFromCache = getFromCache;
/**
 * 设置缓存数据
 */
const setToCache = async (key, data, ttl = CACHE_TTL.TODAY) => {
    const redis = (0, redis_1.getRedisClient)();
    if (!redis) {
        return false;
    }
    try {
        await redis.setex(key, ttl, JSON.stringify(data));
        return true;
    }
    catch (error) {
        logger_1.default.error(`Cache set error for key ${key}:`, error);
        return false;
    }
};
exports.setToCache = setToCache;
/**
 * 删除缓存
 */
const deleteFromCache = async (pattern) => {
    const redis = (0, redis_1.getRedisClient)();
    if (!redis) {
        return 0;
    }
    try {
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
            return await redis.del(...keys);
        }
        return 0;
    }
    catch (error) {
        logger_1.default.error(`Cache delete error for pattern ${pattern}:`, error);
        return 0;
    }
};
exports.deleteFromCache = deleteFromCache;
/**
 * 清除所有缓存
 */
const clearCache = async (prefix = 'cache:*') => {
    return (0, exports.deleteFromCache)(prefix);
};
exports.clearCache = clearCache;
