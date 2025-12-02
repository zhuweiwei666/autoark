"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteToken = exports.updateToken = exports.checkTokenStatus = exports.getTokenById = exports.getTokens = exports.bindToken = void 0;
const FbToken_1 = __importDefault(require("../models/FbToken"));
const fbToken_validation_service_1 = require("../services/fbToken.validation.service");
const logger_1 = __importDefault(require("../utils/logger"));
/**
 * 绑定/保存 Facebook token
 * POST /api/fb-token
 * Body: { token: string, optimizer?: string }
 */
const bindToken = async (req, res, next) => {
    try {
        const { token, optimizer } = req.body;
        const userId = req.body.userId || 'default-user'; // 暂时使用 default-user
        if (!token) {
            return res.status(400).json({
                success: false,
                message: 'Token is required',
            });
        }
        // 验证 token
        logger_1.default.info(`[Token Bind] Validating token for user: ${userId}`);
        const validation = await (0, fbToken_validation_service_1.validateToken)(token);
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                message: `Invalid Facebook token: ${validation.error || 'Unknown error'}`,
            });
        }
        // 保存或更新 token
        const tokenData = {
            userId,
            token,
            status: 'active',
            lastCheckedAt: new Date(),
            fbUserId: validation.fbUser?.id,
            fbUserName: validation.fbUser?.name,
        };
        if (optimizer) {
            tokenData.optimizer = optimizer;
        }
        if (validation.expiresAt) {
            tokenData.expiresAt = validation.expiresAt;
        }
        const savedToken = await FbToken_1.default.findOneAndUpdate({ userId }, tokenData, { new: true, upsert: true });
        logger_1.default.info(`[Token Bind] Token saved successfully for user: ${userId}`);
        return res.json({
            success: true,
            message: 'Facebook token saved successfully',
            data: {
                id: savedToken._id,
                userId: savedToken.userId,
                optimizer: savedToken.optimizer,
                status: savedToken.status,
                fbUserId: savedToken.fbUserId,
                fbUserName: savedToken.fbUserName,
                expiresAt: savedToken.expiresAt,
                lastCheckedAt: savedToken.lastCheckedAt,
            },
        });
    }
    catch (error) {
        logger_1.default.error('[Token Bind] Error:', error);
        next(error);
    }
};
exports.bindToken = bindToken;
/**
 * 获取 token 列表（支持筛选）
 * GET /api/fb-token?optimizer=xxx&startDate=xxx&endDate=xxx&status=xxx
 */
const getTokens = async (req, res, next) => {
    try {
        const { optimizer, startDate, endDate, status } = req.query;
        // 构建查询条件
        const query = {};
        if (optimizer) {
            query.optimizer = optimizer;
        }
        if (status) {
            query.status = status;
        }
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) {
                query.createdAt.$gte = new Date(startDate);
            }
            if (endDate) {
                query.createdAt.$lte = new Date(endDate);
            }
        }
        // 查询 tokens
        const tokens = await FbToken_1.default.find(query)
            .sort({ createdAt: -1 })
            .lean();
        // 移除敏感信息（token）
        const safeTokens = tokens.map((token) => ({
            id: token._id,
            userId: token.userId,
            optimizer: token.optimizer,
            status: token.status,
            fbUserId: token.fbUserId,
            fbUserName: token.fbUserName,
            expiresAt: token.expiresAt,
            lastCheckedAt: token.lastCheckedAt,
            createdAt: token.createdAt,
            updatedAt: token.updatedAt,
            // 不返回 token 本身（安全考虑）
        }));
        return res.json({
            success: true,
            data: safeTokens,
            count: safeTokens.length,
        });
    }
    catch (error) {
        logger_1.default.error('[Token Get] Error:', error);
        next(error);
    }
};
exports.getTokens = getTokens;
/**
 * 获取单个 token 详情
 * GET /api/fb-token/:id
 */
const getTokenById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const token = await FbToken_1.default.findById(id).lean();
        if (!token) {
            return res.status(404).json({
                success: false,
                message: 'Token not found',
            });
        }
        // 返回 token 信息（但不返回 token 本身）
        return res.json({
            success: true,
            data: {
                id: token._id,
                userId: token.userId,
                optimizer: token.optimizer,
                status: token.status,
                fbUserId: token.fbUserId,
                fbUserName: token.fbUserName,
                expiresAt: token.expiresAt,
                lastCheckedAt: token.lastCheckedAt,
                createdAt: token.createdAt,
                updatedAt: token.updatedAt,
            },
        });
    }
    catch (error) {
        logger_1.default.error('[Token GetById] Error:', error);
        next(error);
    }
};
exports.getTokenById = getTokenById;
/**
 * 手动检查 token 状态
 * POST /api/fb-token/:id/check
 */
const checkTokenStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const token = await FbToken_1.default.findById(id);
        if (!token) {
            return res.status(404).json({
                success: false,
                message: 'Token not found',
            });
        }
        // 检查 token 状态
        const newStatus = await (0, fbToken_validation_service_1.checkAndUpdateTokenStatus)(token);
        // 重新获取更新后的 token
        const updatedToken = await FbToken_1.default.findById(id).lean();
        return res.json({
            success: true,
            message: 'Token status checked',
            data: {
                id: updatedToken?._id,
                status: newStatus,
                lastCheckedAt: updatedToken?.lastCheckedAt,
                expiresAt: updatedToken?.expiresAt,
            },
        });
    }
    catch (error) {
        logger_1.default.error('[Token Check] Error:', error);
        next(error);
    }
};
exports.checkTokenStatus = checkTokenStatus;
/**
 * 更新 token（如更新优化师）
 * PUT /api/fb-token/:id
 * Body: { optimizer?: string }
 */
const updateToken = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { optimizer } = req.body;
        const updateData = {
            updatedAt: new Date(),
        };
        if (optimizer !== undefined) {
            updateData.optimizer = optimizer;
        }
        const updatedToken = await FbToken_1.default.findByIdAndUpdate(id, updateData, {
            new: true,
        }).lean();
        if (!updatedToken) {
            return res.status(404).json({
                success: false,
                message: 'Token not found',
            });
        }
        return res.json({
            success: true,
            message: 'Token updated successfully',
            data: {
                id: updatedToken._id,
                userId: updatedToken.userId,
                optimizer: updatedToken.optimizer,
                status: updatedToken.status,
                fbUserId: updatedToken.fbUserId,
                fbUserName: updatedToken.fbUserName,
                expiresAt: updatedToken.expiresAt,
                lastCheckedAt: updatedToken.lastCheckedAt,
                createdAt: updatedToken.createdAt,
                updatedAt: updatedToken.updatedAt,
            },
        });
    }
    catch (error) {
        logger_1.default.error('[Token Update] Error:', error);
        next(error);
    }
};
exports.updateToken = updateToken;
/**
 * 删除 token
 * DELETE /api/fb-token/:id
 */
const deleteToken = async (req, res, next) => {
    try {
        const { id } = req.params;
        const token = await FbToken_1.default.findByIdAndDelete(id);
        if (!token) {
            return res.status(404).json({
                success: false,
                message: 'Token not found',
            });
        }
        return res.json({
            success: true,
            message: 'Token deleted successfully',
        });
    }
    catch (error) {
        logger_1.default.error('[Token Delete] Error:', error);
        next(error);
    }
};
exports.deleteToken = deleteToken;
