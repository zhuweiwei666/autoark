"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllFacebookTokens = exports.getFacebookAccessToken = void 0;
const FbToken_1 = __importDefault(require("../models/FbToken"));
/**
 * 获取 Facebook access token
 * @param options 选项
 * @param options.userId 用户 ID，默认为 'default-user'
 * @param options.optimizer 优化师名称，可选
 * @param options.status token 状态，默认为 'active'
 * @returns Facebook access token
 */
const getFacebookAccessToken = async (options) => {
    const userId = options?.userId || 'default-user';
    const status = options?.status || 'active';
    const query = { userId, status };
    if (options?.optimizer) {
        query.optimizer = options.optimizer;
    }
    const saved = await FbToken_1.default.findOne(query).sort({ createdAt: -1 }); // 获取最新的
    if (!saved) {
        const errorMsg = options?.optimizer
            ? `Facebook token not found for optimizer: ${options.optimizer}. Please set it in Settings.`
            : 'Facebook token not found. Please set it in Settings.';
        throw new Error(errorMsg);
    }
    return saved.token;
};
exports.getFacebookAccessToken = getFacebookAccessToken;
/**
 * 获取所有有效的 token（支持筛选）
 * @param options 选项
 * @returns token 数组
 */
const getAllFacebookTokens = async (options) => {
    const userId = options?.userId || 'default-user';
    const status = options?.status || 'active';
    const query = { userId, status };
    if (options?.optimizer) {
        query.optimizer = options.optimizer;
    }
    const tokens = await FbToken_1.default.find(query).sort({ createdAt: -1 });
    return tokens.map((token) => ({
        id: token._id,
        token: token.token,
        optimizer: token.optimizer,
        status: token.status,
        fbUserId: token.fbUserId,
        fbUserName: token.fbUserName,
        expiresAt: token.expiresAt,
        lastCheckedAt: token.lastCheckedAt,
    }));
};
exports.getAllFacebookTokens = getAllFacebookTokens;
