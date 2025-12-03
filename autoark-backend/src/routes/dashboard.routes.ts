import { Router } from 'express'
import * as dashboardController from '../controllers/dashboard.controller'

const router = Router()

// Analytics
router.get('/daily', dashboardController.getDaily)
router.get('/by-country', dashboardController.getByCountry)
router.get('/by-adset', dashboardController.getByAdSet)

// API: /dashboard/api/xxx (mounted at /dashboard in app.ts, so /api/health becomes /dashboard/api/health)
router.get('/api/health', dashboardController.getSystemHealthHandler)
router.get(
  '/api/facebook-overview',
  dashboardController.getFacebookOverviewHandler,
)
router.get('/api/cron-logs', dashboardController.getCronLogsHandler)
router.get('/api/ops-logs', dashboardController.getOpsLogsHandler)

// 数据看板 V1 API
router.get('/api/core-metrics', dashboardController.getCoreMetricsHandler)
router.get('/api/today-spend-trend', dashboardController.getTodaySpendTrendHandler)
router.get('/api/campaign-spend-ranking', dashboardController.getCampaignRankingHandler)
router.get('/api/country-spend-ranking', dashboardController.getCountrySpendRankingHandler)

// Dashboard UI 已迁移到 React 前端，不再需要后端返回 HTML
// 所有 /dashboard 路由现在由前端 React Router 处理
// 只保留 API 路由，UI 路由已删除

export default router
