"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRedisConnection = exports.getRedisClient = exports.initRedis = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const logger_1 = __importDefault(require("../utils/logger"));
let redisClient = null;
let redisInitialized = false;
let redisWarningLogged = false;
const initRedis = () => {
    if (redisClient) {
        return redisClient;
    }
    // 如果已经初始化过但没有配置，直接返回 null，不再打印警告
    if (redisInitialized) {
        return null;
    }
    redisInitialized = true;
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
        // 只打印一次警告
        if (!redisWarningLogged) {
            logger_1.default.warn('REDIS_URL not configured, Redis caching will be disabled');
            redisWarningLogged = true;
        }
        return null;
    }
    try {
        redisClient = new ioredis_1.default(redisUrl, {
            retryStrategy: (times) => {
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
            maxRetriesPerRequest: 3,
        });
        redisClient.on('connect', () => {
            logger_1.default.info('Redis Connected');
        });
        redisClient.on('error', (err) => {
            logger_1.default.error('Redis connection error:', err);
        });
        redisClient.on('ready', () => {
            logger_1.default.info('Redis Ready');
        });
        return redisClient;
    }
    catch (error) {
        logger_1.default.error('Failed to initialize Redis:', error);
        return null;
    }
};
exports.initRedis = initRedis;
const getRedisClient = () => {
    if (!redisClient) {
        return (0, exports.initRedis)();
    }
    return redisClient;
};
exports.getRedisClient = getRedisClient;
// BullMQ 需要的连接函数
const getRedisConnection = () => {
    const client = (0, exports.getRedisClient)();
    if (!client) {
        throw new Error('Redis connection not available. Please configure REDIS_URL environment variable.');
    }
    return client;
};
exports.getRedisConnection = getRedisConnection;
exports.default = exports.getRedisClient;
