import { Router } from 'express'
import * as bulkAdController from '../controllers/bulkAd.controller'

const router = Router()

// ==================== 独立 OAuth 授权（批量广告专用）====================
router.get('/auth/login-url', bulkAdController.getAuthLoginUrl)
router.get('/auth/callback', bulkAdController.handleAuthCallback)
router.get('/auth/status', bulkAdController.getAuthStatus)
router.get('/auth/ad-accounts', bulkAdController.getAuthAdAccounts)
router.get('/auth/pages', bulkAdController.getAuthPages)
router.get('/auth/pixels', bulkAdController.getAuthPixels)

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

