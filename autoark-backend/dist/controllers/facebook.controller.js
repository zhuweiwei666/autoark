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
exports.getAccounts = exports.getInsightsDaily = exports.getAds = exports.getAdSets = exports.getCampaigns = exports.getAccountsList = exports.syncAccounts = exports.getCampaignsList = exports.syncCampaigns = void 0;
const facebookService = __importStar(require("../services/facebook.service"));
const facebookAccountsService = __importStar(require("../services/facebook.accounts.service"));
const facebookCampaignsService = __importStar(require("../services/facebook.campaigns.service"));
const facebook_sync_service_1 = require("../services/facebook.sync.service");
const syncCampaigns = async (req, res, next) => {
    try {
        const result = await facebookCampaignsService.syncCampaignsFromAdAccounts();
        res.json({
            success: true,
            message: 'Campaigns sync completed',
            data: result,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.syncCampaigns = syncCampaigns;
const getCampaignsList = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const sortBy = req.query.sortBy || 'createdAt';
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
        const filters = {
            optimizer: req.query.optimizer,
            status: req.query.status,
            accountId: req.query.accountId,
            name: req.query.name,
            startDate: req.query.startDate,
            endDate: req.query.endDate,
        };
        const result = await facebookAccountsService.getAccounts(filters, { page, limit });
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
