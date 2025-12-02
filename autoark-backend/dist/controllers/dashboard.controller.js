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
exports.getByAdSet = exports.getByCountry = exports.getDaily = void 0;
exports.getSystemHealthHandler = getSystemHealthHandler;
exports.getFacebookOverviewHandler = getFacebookOverviewHandler;
exports.getCronLogsHandler = getCronLogsHandler;
exports.getOpsLogsHandler = getOpsLogsHandler;
exports.getCoreMetricsHandler = getCoreMetricsHandler;
exports.getTodaySpendTrendHandler = getTodaySpendTrendHandler;
exports.getCampaignSpendRankingHandler = getCampaignSpendRankingHandler;
exports.getCountrySpendRankingHandler = getCountrySpendRankingHandler;
const dashboardService = __importStar(require("../services/dashboard.service"));
const getFilters = (req) => {
    const { startDate, endDate, channel, country } = req.query;
    // Default to last 7 days if not provided
    const end = endDate || new Date().toISOString().split('T')[0];
    const start = startDate ||
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    return {
        startDate: start,
        endDate: end,
        channel: channel,
        country: country,
    };
};
const getDaily = async (req, res, next) => {
    try {
        const filters = getFilters(req);
        const data = await dashboardService.getDaily(filters);
        res.json(data);
    }
    catch (error) {
        next(error);
    }
};
exports.getDaily = getDaily;
const getByCountry = async (req, res, next) => {
    try {
        const filters = getFilters(req);
        const data = await dashboardService.getByCountry(filters);
        res.json(data);
    }
    catch (error) {
        next(error);
    }
};
exports.getByCountry = getByCountry;
const getByAdSet = async (req, res, next) => {
    try {
        const filters = getFilters(req);
        const data = await dashboardService.getByAdSet(filters);
        res.json(data);
    }
    catch (error) {
        next(error);
    }
};
exports.getByAdSet = getByAdSet;
// --- New Handlers for Read-Only Dashboard ---
async function getSystemHealthHandler(req, res, next) {
    try {
        const data = await dashboardService.getSystemHealth();
        res.json({ success: true, data });
    }
    catch (err) {
        next(err);
    }
}
async function getFacebookOverviewHandler(req, res, next) {
    try {
        const data = await dashboardService.getFacebookOverview();
        res.json({ success: true, data });
    }
    catch (err) {
        next(err);
    }
}
async function getCronLogsHandler(req, res, next) {
    try {
        const limit = Number(req.query.limit) || 50;
        const data = await dashboardService.getCronLogs(limit);
        res.json({ success: true, data });
    }
    catch (err) {
        next(err);
    }
}
async function getOpsLogsHandler(req, res, next) {
    try {
        const limit = Number(req.query.limit) || 50;
        const data = await dashboardService.getOpsLogs(limit);
        res.json({ success: true, data });
    }
    catch (err) {
        next(err);
    }
}
// ========== 数据看板 V1 API Handlers ==========
async function getCoreMetricsHandler(req, res, next) {
    try {
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;
        const data = await dashboardService.getCoreMetrics(startDate, endDate);
        res.json({ success: true, data });
    }
    catch (err) {
        next(err);
    }
}
async function getTodaySpendTrendHandler(req, res, next) {
    try {
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;
        const data = await dashboardService.getTodaySpendTrend(startDate, endDate);
        res.json({ success: true, data });
    }
    catch (err) {
        next(err);
    }
}
async function getCampaignSpendRankingHandler(req, res, next) {
    try {
        const limit = Number(req.query.limit) || 10;
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;
        const data = await dashboardService.getCampaignSpendRanking(limit, startDate, endDate);
        res.json({ success: true, data });
    }
    catch (err) {
        next(err);
    }
}
async function getCountrySpendRankingHandler(req, res, next) {
    try {
        const limit = Number(req.query.limit) || 10;
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;
        const data = await dashboardService.getCountrySpendRanking(limit, startDate, endDate);
        res.json({ success: true, data });
    }
    catch (err) {
        next(err);
    }
}
