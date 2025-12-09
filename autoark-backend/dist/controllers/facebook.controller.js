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
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateCampaignStatus = exports.getAccounts = exports.getInsightsDaily = exports.getAds = exports.getAdSets = exports.getCampaigns = exports.getCountriesList = exports.getAccountsList = exports.syncAccounts = exports.getCampaignsList = exports.getPurchaseValueInfo = exports.getTokenPoolStatus = exports.diagnoseTokens = exports.getQueueStatus = exports.syncCampaigns = void 0;
const facebookService = __importStar(require("../services/facebook.service"));
const facebookAccountsService = __importStar(require("../services/facebook.accounts.service"));
const facebookCampaignsService = __importStar(require("../services/facebook.campaigns.service"));
const facebookCampaignsV2Service = __importStar(require("../services/facebook.campaigns.v2.service"));
const facebookPermissionsService = __importStar(require("../services/facebook.permissions.service"));
const facebookPurchaseCorrectionService = __importStar(require("../services/facebook.purchase.correction"));
const facebook_token_pool_1 = require("../services/facebook.token.pool");
const facebookCountriesService = __importStar(require("../services/facebook.countries.service"));
const facebook_sync_service_1 = require("../services/facebook.sync.service");
const syncCampaigns = async (req, res, next) => {
    try {
        // 使用新的队列系统（V2）
        const useV2 = req.query.v2 === 'true' || process.env.USE_QUEUE_SYNC === 'true';
        if (useV2) {
            const result = await facebookCampaignsV2Service.syncCampaignsFromAdAccountsV2();
            res.json({
                success: true,
                message: 'Campaigns sync queued (using BullMQ)',
                data: result,
            });
        }
        else {
            // 旧版本（同步执行）
            const result = await facebookCampaignsService.syncCampaignsFromAdAccounts();
            res.json({
                success: true,
                message: 'Campaigns sync completed',
                data: result,
            });
        }
    }
    catch (error) {
        next(error);
    }
};
exports.syncCampaigns = syncCampaigns;
// 获取队列状态
const getQueueStatus = async (req, res, next) => {
    try {
        const status = await facebookCampaignsV2Service.getQueueStatus();
        res.json({
            success: true,
            data: status,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getQueueStatus = getQueueStatus;
// 诊断 Token 权限
const diagnoseTokens = async (req, res, next) => {
    try {
        const { tokenId } = req.query;
        if (tokenId) {
            // 诊断单个 token
            const result = await facebookPermissionsService.diagnoseToken(tokenId);
            res.json({
                success: true,
                data: result,
            });
        }
        else {
            // 诊断所有 token
            const results = await facebookPermissionsService.diagnoseAllTokens();
            res.json({
                success: true,
                data: results,
            });
        }
    }
    catch (error) {
        next(error);
    }
};
exports.diagnoseTokens = diagnoseTokens;
// 获取 Token Pool 状态
const getTokenPoolStatus = async (req, res, next) => {
    try {
        const status = facebook_token_pool_1.tokenPool.getTokenStatus();
        res.json({
            success: true,
            data: status,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getTokenPoolStatus = getTokenPoolStatus;
// 获取 Purchase 值信息（用于前端 Tooltip）
const getPurchaseValueInfo = async (req, res, next) => {
    try {
        const { campaignId, date, country } = req.query;
        if (!campaignId || !date) {
            return res.status(400).json({
                success: false,
                message: 'campaignId and date are required',
            });
        }
        const info = await facebookPurchaseCorrectionService.getPurchaseValueInfo(campaignId, date, country);
        res.json({
            success: true,
            data: info,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getPurchaseValueInfo = getPurchaseValueInfo;
const getCampaignsList = async (req, res, next) => {
    try {
        // 确保设置正确的 Content-Type
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const sortBy = req.query.sortBy || 'spend'; // 默认按消耗排序
        const sortOrder = req.query.sortOrder || 'desc';
        const filters = {
            name: req.query.name,
            accountId: req.query.accountId,
            status: req.query.status,
            objective: req.query.objective,
            startDate: req.query.startDate,
            endDate: req.query.endDate,
        };
        const result = await facebookCampaignsService.getCampaigns(filters, { page, limit, sortBy, sortOrder });
        res.json({
            success: true,
            ...result
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getCampaignsList = getCampaignsList;
const syncAccounts = async (req, res, next) => {
    try {
        const result = await facebookAccountsService.syncAccountsFromTokens();
        res.json({
            success: true,
            message: 'Accounts sync completed',
            data: result,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.syncAccounts = syncAccounts;
const getAccountsList = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const sortBy = req.query.sortBy || 'periodSpend';
        const sortOrder = req.query.sortOrder || 'desc';
        const filters = {
            optimizer: req.query.optimizer,
            status: req.query.status,
            accountId: req.query.accountId,
            name: req.query.name,
            startDate: req.query.startDate,
            endDate: req.query.endDate,
        };
        const result = await facebookAccountsService.getAccounts(filters, { page, limit, sortBy, sortOrder });
        res.json({
            success: true,
            ...result
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getAccountsList = getAccountsList;
const getCountriesList = async (req, res, next) => {
    try {
        // 确保设置正确的 Content-Type
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const sortBy = req.query.sortBy || 'spend';
        const sortOrder = req.query.sortOrder || 'desc';
        const filters = {
            name: req.query.name,
            accountId: req.query.accountId,
            status: req.query.status,
            objective: req.query.objective,
            startDate: req.query.startDate,
            endDate: req.query.endDate,
        };
        const result = await facebookCountriesService.getCountries(filters, { page, limit, sortBy, sortOrder });
        res.json({
            success: true,
            ...result
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getCountriesList = getCountriesList;
const getCampaigns = async (req, res, next) => {
    try {
        const { id } = req.params;
        const data = await facebookService.getCampaigns(id);
        res.json(data);
    }
    catch (error) {
        next(error);
    }
};
exports.getCampaigns = getCampaigns;
const getAdSets = async (req, res, next) => {
    try {
        const { id } = req.params;
        const data = await facebookService.getAdSets(id);
        res.json(data);
    }
    catch (error) {
        next(error);
    }
};
exports.getAdSets = getAdSets;
const getAds = async (req, res, next) => {
    try {
        const { id } = req.params;
        const data = await facebookService.getAds(id);
        res.json(data);
    }
    catch (error) {
        next(error);
    }
};
exports.getAds = getAds;
const getInsightsDaily = async (req, res, next) => {
    try {
        const { id } = req.params;
        const data = await facebookService.getInsightsDaily(id);
        res.json(data);
    }
    catch (error) {
        next(error);
    }
};
exports.getInsightsDaily = getInsightsDaily;
const getAccounts = async (req, res, next) => {
    try {
        const accounts = await (0, facebook_sync_service_1.getEffectiveAdAccounts)();
        res.json({
            success: true,
            accounts,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getAccounts = getAccounts;
// 更新 Campaign 状态 (ACTIVE/PAUSED)
const updateCampaignStatus = async (req, res, next) => {
    try {
        const { campaignId } = req.params;
        const { status } = req.body;
        if (!campaignId) {
            return res.status(400).json({ success: false, error: 'Campaign ID is required' });
        }
        if (!status || !['ACTIVE', 'PAUSED'].includes(status)) {
            return res.status(400).json({ success: false, error: 'Status must be ACTIVE or PAUSED' });
        }
        // 获取 token
        const token = facebook_token_pool_1.tokenPool.getNextToken();
        if (!token) {
            return res.status(500).json({ success: false, error: 'No valid Facebook token available' });
        }
        // 调用 Facebook API 更新状态
        const response = await fetch(`https://graph.facebook.com/v21.0/${campaignId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                access_token: token,
                status: status,
            }),
        });
        const result = await response.json();
        if (result.error) {
            return res.status(400).json({
                success: false,
                error: result.error.message || 'Failed to update campaign status'
            });
        }
        // 更新本地数据库
        const Campaign = require('../models/Campaign').default;
        await Campaign.findOneAndUpdate({ campaignId }, { status, updatedAt: new Date() });
        res.json({
            success: true,
            message: `Campaign status updated to ${status}`,
            data: { campaignId, status }
        });
    }
    catch (error) {
        next(error);
    }
};
exports.updateCampaignStatus = updateCampaignStatus;
