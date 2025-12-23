import { Router } from 'express'
import * as bulkAdController from '../controllers/bulkAd.controller'
import { authenticate } from '../middlewares/auth'

const router = Router()

// 所有路由都需要认证（除了 OAuth 回调）
router.use((req, res, next) => {
  // OAuth 回调不需要认证
  if (req.path === '/auth/callback') {
    return next()
  }
  return authenticate(req, res, next)
})

// ==================== 独立 OAuth 授权（批量广告专用）====================
router.get('/auth/apps', bulkAdController.getAvailableApps) // 获取可用的 Facebook Apps
router.get('/auth/login-url', bulkAdController.getAuthLoginUrl)
router.get('/auth/callback', bulkAdController.handleAuthCallback)
router.get('/auth/status', bulkAdController.getAuthStatus)
router.get('/auth/ad-accounts', bulkAdController.getAuthAdAccounts)
router.get('/auth/pages', bulkAdController.getAuthPages)
router.get('/auth/pixels', bulkAdController.getAuthPixels)
router.get('/auth/cached-pixels', bulkAdController.getCachedPixels)
router.get('/auth/cached-catalogs', bulkAdController.getCachedCatalogs)
router.get('/auth/sync-status', bulkAdController.getPixelSyncStatus)
router.post('/auth/resync', bulkAdController.resyncFacebookAssets)

// ==================== 草稿管理 ====================
router.post('/drafts', bulkAdController.createDraft)
router.get('/drafts', bulkAdController.getDraftList)
router.get('/drafts/:id', bulkAdController.getDraft)
router.put('/drafts/:id', bulkAdController.updateDraft)
router.delete('/drafts/:id', bulkAdController.deleteDraft)
router.post('/drafts/:id/validate', bulkAdController.validateDraft)
router.post('/drafts/:id/publish', bulkAdController.publishDraft)

// ==================== 任务管理 ====================
router.get('/tasks', bulkAdController.getTaskList)
router.get('/tasks/:id', bulkAdController.getTask)
router.post('/tasks/:id/cancel', bulkAdController.cancelTask)
router.post('/tasks/:id/retry', bulkAdController.retryTask)
router.post('/tasks/:id/rerun', bulkAdController.rerunTask)

// ==================== 广告审核状态 ====================
router.get('/tasks/:id/review-status', bulkAdController.getTaskReviewStatus)
router.post('/tasks/:id/check-review', bulkAdController.checkTaskReviewStatus)
router.get('/ads/review-overview', bulkAdController.getAdsReviewOverview)
router.post('/ads/refresh-review', bulkAdController.refreshAdsReviewStatus)

// ==================== 定向包管理 ====================
router.post('/targeting-packages', bulkAdController.createTargetingPackage)
router.get('/targeting-packages', bulkAdController.getTargetingPackageList)
router.put('/targeting-packages/:id', bulkAdController.updateTargetingPackage)
router.delete('/targeting-packages/:id', bulkAdController.deleteTargetingPackage)

// ==================== 文案包管理 ====================
router.post('/copywriting-packages', bulkAdController.createCopywritingPackage)
router.get('/copywriting-packages', bulkAdController.getCopywritingPackageList)
router.put('/copywriting-packages/:id', bulkAdController.updateCopywritingPackage)
router.delete('/copywriting-packages/:id', bulkAdController.deleteCopywritingPackage)
router.post('/copywriting-packages/parse-products', bulkAdController.parseAllCopywritingProducts) // 批量解析产品信息

// ==================== 创意组管理 ====================
router.post('/creative-groups', bulkAdController.createCreativeGroup)
router.get('/creative-groups', bulkAdController.getCreativeGroupList)
router.put('/creative-groups/:id', bulkAdController.updateCreativeGroup)
router.delete('/creative-groups/:id', bulkAdController.deleteCreativeGroup)
router.post('/creative-groups/:id/materials', bulkAdController.addMaterial)
router.delete('/creative-groups/:id/materials/:materialId', bulkAdController.removeMaterial)

// ==================== Facebook 搜索 API ====================
router.get('/search/interests', bulkAdController.searchInterests)
router.get('/search/locations', bulkAdController.searchLocations)

// ==================== Facebook 资产 API（旧版，保留兼容）====================
router.get('/facebook/pages', bulkAdController.getFacebookPages)
router.get('/facebook/instagram-accounts', bulkAdController.getFacebookInstagramAccounts)
router.get('/facebook/pixels', bulkAdController.getFacebookPixels)
router.get('/facebook/custom-conversions', bulkAdController.getFacebookCustomConversions)

export default router

