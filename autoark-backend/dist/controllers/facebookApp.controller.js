"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetAppStats = exports.getAppStats = exports.getAvailableApps = exports.validateApp = exports.deleteApp = exports.updateCompliance = exports.getPublicOAuthRequirements = exports.updateApp = exports.createApp = exports.getApp = exports.getApps = void 0;
exports.getNextAvailableApp = getNextAvailableApp;
exports.incrementAppLoad = incrementAppLoad;
exports.decrementAppLoad = decrementAppLoad;
exports.recordAppRequest = recordAppRequest;
const FacebookApp_1 = __importDefault(require("../models/FacebookApp"));
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../utils/logger"));
// 公开 OAuth 最低需要的权限（用于“任意 FB 号可授权”）
const PUBLIC_OAUTH_REQUIRED_PERMISSIONS = [
    'ads_management',
    'ads_read',
    'business_management',
    'pages_show_list',
    'pages_read_engagement',
];
const computePublicOauthReady = (app) => {
    const perms = Array.isArray(app?.compliance?.permissions) ? app.compliance.permissions : [];
    const map = new Map(perms.map((p) => [String(p.name), p]));
    return PUBLIC_OAUTH_REQUIRED_PERMISSIONS.every((name) => {
        const p = map.get(name);
        // 这里用“Advanced 且 Approved”作为可对外授权的判定
        return p && p.access === 'advanced' && p.status === 'approved';
    });
};
/**
 * 获取所有 Facebook Apps
 */
const getApps = async (req, res) => {
    try {
        const apps = await FacebookApp_1.default.find().sort({ 'config.priority': -1, createdAt: -1 });
        res.json({ success: true, data: apps });
    }
    catch (error) {
        logger_1.default.error('获取 Facebook Apps 失败:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getApps = getApps;
/**
 * 获取单个 App
 */
const getApp = async (req, res) => {
    try {
        const { id } = req.params;
        const app = await FacebookApp_1.default.findById(id);
        if (!app) {
            return res.status(404).json({ success: false, error: 'App 不存在' });
        }
        res.json({ success: true, data: app });
    }
    catch (error) {
        logger_1.default.error('获取 Facebook App 失败:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getApp = getApp;
/**
 * 创建新 App
 */
const createApp = async (req, res) => {
    try {
        const { appId, appSecret, appName, notes, config } = req.body;
        // 检查是否已存在
        const existing = await FacebookApp_1.default.findOne({ appId });
        if (existing) {
            return res.status(400).json({ success: false, error: '该 App ID 已存在' });
        }
        // 验证 App 凭证
        const validationResult = await validateAppCredentials(appId, appSecret);
        const app = new FacebookApp_1.default({
            appId,
            appSecret,
            appName: appName || `App ${appId.substring(0, 6)}`,
            notes,
            config: config || {},
            validation: {
                isValid: validationResult.isValid,
                validatedAt: new Date(),
                validationError: validationResult.error,
            },
            status: validationResult.isValid ? 'active' : 'inactive',
            createdBy: req.user?.userId, // 记录创建者
        });
        await app.save();
        logger_1.default.info(`创建 Facebook App: ${appName || appId}`);
        res.json({ success: true, data: app });
    }
    catch (error) {
        logger_1.default.error('创建 Facebook App 失败:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.createApp = createApp;
/**
 * 更新 App
 */
const updateApp = async (req, res) => {
    try {
        const { id } = req.params;
        const { appName, appSecret, notes, config, status, compliance } = req.body;
        const app = await FacebookApp_1.default.findById(id);
        if (!app) {
            return res.status(404).json({ success: false, error: 'App 不存在' });
        }
        // 如果更新了 secret，重新验证
        if (appSecret && appSecret !== app.appSecret) {
            const validationResult = await validateAppCredentials(String(app.appId), String(appSecret));
            app.appSecret = appSecret;
            app.validation = {
                isValid: validationResult.isValid,
                validatedAt: new Date(),
                validationError: validationResult.error,
            };
            if (!validationResult.isValid) {
                app.status = 'inactive';
            }
        }
        if (appName)
            app.appName = appName;
        if (notes !== undefined)
            app.notes = notes;
        if (config)
            app.config = { ...app.config, ...config };
        if (status)
            app.status = status;
        // 合规信息允许更新（用于记录 Advanced Access / Business Verification / App Review 状态）
        if (compliance) {
            app.compliance = {
                ...app.compliance,
                ...compliance,
                // 如果传入 permissions，覆盖；否则保留原来的
                ...(compliance.permissions ? { permissions: compliance.permissions } : {}),
            };
            app.compliance.publicOauthReady = computePublicOauthReady(app);
            app.compliance.lastCheckedAt = new Date();
        }
        await app.save();
        logger_1.default.info(`更新 Facebook App: ${app.appName}`);
        res.json({ success: true, data: app });
    }
    catch (error) {
        logger_1.default.error('更新 Facebook App 失败:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.updateApp = updateApp;
/**
 * 返回平台“公开 OAuth”权限要求（用于前端展示/自检）
 */
const getPublicOAuthRequirements = async (req, res) => {
    res.json({
        success: true,
        data: {
            requiredPermissions: PUBLIC_OAUTH_REQUIRED_PERMISSIONS,
            rule: 'All required permissions must be Advanced + Approved, and app must be valid + active.',
        },
    });
};
exports.getPublicOAuthRequirements = getPublicOAuthRequirements;
/**
 * 快速更新某个 App 的合规信息（只写 compliance）
 * PUT /api/facebook-apps/:id/compliance
 */
const updateCompliance = async (req, res) => {
    try {
        const { id } = req.params;
        const app = await FacebookApp_1.default.findById(id);
        if (!app) {
            return res.status(404).json({ success: false, error: 'App 不存在' });
        }
        app.compliance = {
            ...(app.compliance || {}),
            ...(req.body || {}),
            ...(req.body?.permissions ? { permissions: req.body.permissions } : {}),
        };
        app.compliance.publicOauthReady = computePublicOauthReady(app);
        app.compliance.lastCheckedAt = new Date();
        await app.save();
        res.json({ success: true, data: app });
    }
    catch (error) {
        logger_1.default.error('更新 App 合规信息失败:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.updateCompliance = updateCompliance;
/**
 * 删除 App
 */
const deleteApp = async (req, res) => {
    try {
        const { id } = req.params;
        const app = await FacebookApp_1.default.findByIdAndDelete(id);
        if (!app) {
            return res.status(404).json({ success: false, error: 'App 不存在' });
        }
        logger_1.default.info(`删除 Facebook App: ${app.appName}`);
        res.json({ success: true, message: '删除成功' });
    }
    catch (error) {
        logger_1.default.error('删除 Facebook App 失败:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.deleteApp = deleteApp;
/**
 * 验证 App 凭证
 */
const validateApp = async (req, res) => {
    try {
        const { id } = req.params;
        const app = await FacebookApp_1.default.findById(id);
        if (!app) {
            return res.status(404).json({ success: false, error: 'App 不存在' });
        }
        const result = await validateAppCredentials(String(app.appId), String(app.appSecret));
        app.validation = {
            isValid: result.isValid,
            validatedAt: new Date(),
            validationError: result.error,
        };
        if (result.isValid && app.status === 'inactive') {
            app.status = 'active';
        }
        else if (!result.isValid) {
            app.status = 'inactive';
        }
        await app.save();
        res.json({ success: true, data: { ...result, app } });
    }
    catch (error) {
        logger_1.default.error('验证 Facebook App 失败:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.validateApp = validateApp;
/**
 * 获取可用于任务的 Apps（按负载和优先级排序）
 */
const getAvailableApps = async (req, res) => {
    try {
        const { count = 1 } = req.query;
        const apps = await FacebookApp_1.default.find({
            status: 'active',
            'validation.isValid': true,
        }).sort({
            'currentLoad.activeTasks': 1,
            'config.priority': -1,
        }).limit(Number(count));
        res.json({ success: true, data: apps });
    }
    catch (error) {
        logger_1.default.error('获取可用 Apps 失败:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getAvailableApps = getAvailableApps;
/**
 * 获取 App 统计信息
 */
const getAppStats = async (req, res) => {
    try {
        const apps = await FacebookApp_1.default.find();
        const stats = {
            total: apps.length,
            active: apps.filter(a => a.status === 'active').length,
            inactive: apps.filter(a => a.status === 'inactive').length,
            rateLimited: apps.filter(a => a.status === 'rate_limited').length,
            totalRequests: apps.reduce((sum, a) => sum + Number(a.stats?.totalRequests || 0), 0),
            avgHealthScore: apps.length > 0
                ? Math.round(apps.reduce((sum, a) => {
                    const total = Number(a.stats?.totalRequests || 1);
                    const success = Number(a.stats?.successRequests || 0);
                    return sum + (success / total) * 100;
                }, 0) / apps.length)
                : 100,
        };
        res.json({ success: true, data: stats });
    }
    catch (error) {
        logger_1.default.error('获取 App 统计失败:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getAppStats = getAppStats;
/**
 * 重置 App 统计
 */
const resetAppStats = async (req, res) => {
    try {
        const { id } = req.params;
        const app = await FacebookApp_1.default.findById(id);
        if (!app) {
            return res.status(404).json({ success: false, error: 'App 不存在' });
        }
        app.stats = {
            totalRequests: 0,
            successRequests: 0,
            failedRequests: 0,
            lastUsedAt: undefined,
            lastErrorAt: undefined,
            lastError: undefined,
            rateLimitResetAt: undefined,
        };
        app.currentLoad = {
            activeTasks: 0,
            requestsThisMinute: 0,
            lastResetAt: new Date(),
        };
        await app.save();
        res.json({ success: true, data: app });
    }
    catch (error) {
        logger_1.default.error('重置 App 统计失败:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.resetAppStats = resetAppStats;
/**
 * 内部函数：验证 App 凭证
 */
async function validateAppCredentials(appId, appSecret) {
    try {
        // 获取 app access token
        const response = await axios_1.default.get(`https://graph.facebook.com/oauth/access_token`, {
            params: {
                client_id: appId,
                client_secret: appSecret,
                grant_type: 'client_credentials',
            },
            timeout: 10000,
        });
        if (response.data?.access_token) {
            // 进一步验证 token
            const debugResponse = await axios_1.default.get(`https://graph.facebook.com/debug_token`, {
                params: {
                    input_token: response.data.access_token,
                    access_token: response.data.access_token,
                },
                timeout: 10000,
            });
            return {
                isValid: true,
                details: {
                    appId: debugResponse.data?.data?.app_id,
                    isValid: debugResponse.data?.data?.is_valid,
                },
            };
        }
        return { isValid: false, error: '无法获取 access token' };
    }
    catch (error) {
        const errorMessage = error.response?.data?.error?.message || error.message;
        logger_1.default.error(`验证 App ${appId} 失败:`, errorMessage);
        return { isValid: false, error: errorMessage };
    }
}
/**
 * 导出供其他服务使用的函数
 */
async function getNextAvailableApp() {
    const app = await FacebookApp_1.default.findOne({
        status: 'active',
        'validation.isValid': true,
    }).sort({
        'currentLoad.activeTasks': 1,
        'config.priority': -1,
    });
    return app;
}
async function incrementAppLoad(appId) {
    await FacebookApp_1.default.updateOne({ appId }, {
        $inc: { 'currentLoad.activeTasks': 1 },
        $set: { 'stats.lastUsedAt': new Date() }
    });
}
async function decrementAppLoad(appId) {
    await FacebookApp_1.default.updateOne({ appId }, { $inc: { 'currentLoad.activeTasks': -1 } });
}
async function recordAppRequest(appId, success, error) {
    const update = {
        $inc: {
            'stats.totalRequests': 1,
            'stats.successRequests': success ? 1 : 0,
            'stats.failedRequests': success ? 0 : 1,
        }
    };
    if (!success && error) {
        update.$set = {
            'stats.lastErrorAt': new Date(),
            'stats.lastError': error,
        };
        // 检查是否是限流错误
        if (error.includes('rate limit') || error.includes('too many')) {
            update.$set['status'] = 'rate_limited';
            update.$set['stats.rateLimitResetAt'] = new Date(Date.now() + 60 * 60 * 1000); // 1小时后重置
        }
    }
    await FacebookApp_1.default.updateOne({ appId }, update);
}
