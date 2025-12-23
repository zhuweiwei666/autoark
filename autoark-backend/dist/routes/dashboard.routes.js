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
const express_1 = require("express");
const dashboardController = __importStar(require("../controllers/dashboard.controller"));
const auth_1 = require("../middlewares/auth");
const router = (0, express_1.Router)();
// 所有路由都需要认证
router.use(auth_1.authenticate);
// Analytics
router.get('/daily', dashboardController.getDaily);
router.get('/by-country', dashboardController.getByCountry);
router.get('/by-adset', dashboardController.getByAdSet);
// API: /dashboard/api/xxx (mounted at /dashboard in app.ts, so /api/health becomes /dashboard/api/health)
router.get('/api/health', dashboardController.getSystemHealthHandler);
router.get('/api/facebook-overview', dashboardController.getFacebookOverviewHandler);
router.get('/api/cron-logs', dashboardController.getCronLogsHandler);
router.get('/api/ops-logs', dashboardController.getOpsLogsHandler);
// 数据看板 V1 API
router.get('/api/core-metrics', dashboardController.getCoreMetricsHandler);
router.get('/api/today-spend-trend', dashboardController.getTodaySpendTrendHandler);
router.get('/api/campaign-spend-ranking', dashboardController.getCampaignSpendRankingHandler);
router.get('/api/country-spend-ranking', dashboardController.getCountrySpendRankingHandler);
// Dashboard UI 已迁移到 React 前端，不再需要后端返回 HTML
// 所有 /dashboard 路由现在由前端 React Router 处理
// 只保留 API 路由，UI 路由已删除
exports.default = router;
