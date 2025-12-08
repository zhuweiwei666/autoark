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
const bulkAdController = __importStar(require("../controllers/bulkAd.controller"));
const router = (0, express_1.Router)();
// ==================== 独立 OAuth 授权（批量广告专用）====================
router.get('/auth/apps', bulkAdController.getAvailableApps); // 获取可用的 Facebook Apps
router.get('/auth/login-url', bulkAdController.getAuthLoginUrl);
router.get('/auth/callback', bulkAdController.handleAuthCallback);
router.get('/auth/status', bulkAdController.getAuthStatus);
router.get('/auth/ad-accounts', bulkAdController.getAuthAdAccounts);
router.get('/auth/pages', bulkAdController.getAuthPages);
router.get('/auth/pixels', bulkAdController.getAuthPixels);
router.get('/auth/cached-pixels', bulkAdController.getCachedPixels); // 预加载的 Pixels
router.get('/auth/sync-status', bulkAdController.getPixelSyncStatus); // 同步状态
router.post('/auth/resync', bulkAdController.resyncFacebookAssets); // 手动重新同步
// ==================== 草稿管理 ====================
router.post('/drafts', bulkAdController.createDraft);
router.get('/drafts', bulkAdController.getDraftList);
router.get('/drafts/:id', bulkAdController.getDraft);
router.put('/drafts/:id', bulkAdController.updateDraft);
router.delete('/drafts/:id', bulkAdController.deleteDraft);
router.post('/drafts/:id/validate', bulkAdController.validateDraft);
router.post('/drafts/:id/publish', bulkAdController.publishDraft);
// ==================== 任务管理 ====================
router.get('/tasks', bulkAdController.getTaskList);
router.get('/tasks/:id', bulkAdController.getTask);
router.post('/tasks/:id/cancel', bulkAdController.cancelTask);
router.post('/tasks/:id/retry', bulkAdController.retryTask);
router.post('/tasks/:id/rerun', bulkAdController.rerunTask);
// ==================== 广告审核状态 ====================
router.get('/tasks/:id/review-status', bulkAdController.getTaskReviewStatus);
router.post('/tasks/:id/check-review', bulkAdController.checkTaskReviewStatus);
router.get('/ads/review-overview', bulkAdController.getAdsReviewOverview);
router.post('/ads/refresh-review', bulkAdController.refreshAdsReviewStatus);
// ==================== 定向包管理 ====================
router.post('/targeting-packages', bulkAdController.createTargetingPackage);
router.get('/targeting-packages', bulkAdController.getTargetingPackageList);
router.put('/targeting-packages/:id', bulkAdController.updateTargetingPackage);
router.delete('/targeting-packages/:id', bulkAdController.deleteTargetingPackage);
// ==================== 文案包管理 ====================
router.post('/copywriting-packages', bulkAdController.createCopywritingPackage);
router.get('/copywriting-packages', bulkAdController.getCopywritingPackageList);
router.put('/copywriting-packages/:id', bulkAdController.updateCopywritingPackage);
router.delete('/copywriting-packages/:id', bulkAdController.deleteCopywritingPackage);
router.post('/copywriting-packages/parse-products', bulkAdController.parseAllCopywritingProducts); // 批量解析产品信息
// ==================== 创意组管理 ====================
router.post('/creative-groups', bulkAdController.createCreativeGroup);
router.get('/creative-groups', bulkAdController.getCreativeGroupList);
router.put('/creative-groups/:id', bulkAdController.updateCreativeGroup);
router.delete('/creative-groups/:id', bulkAdController.deleteCreativeGroup);
router.post('/creative-groups/:id/materials', bulkAdController.addMaterial);
router.delete('/creative-groups/:id/materials/:materialId', bulkAdController.removeMaterial);
// ==================== Facebook 搜索 API ====================
router.get('/search/interests', bulkAdController.searchInterests);
router.get('/search/locations', bulkAdController.searchLocations);
// ==================== Facebook 资产 API（旧版，保留兼容）====================
router.get('/facebook/pages', bulkAdController.getFacebookPages);
router.get('/facebook/instagram-accounts', bulkAdController.getFacebookInstagramAccounts);
router.get('/facebook/pixels', bulkAdController.getFacebookPixels);
router.get('/facebook/custom-conversions', bulkAdController.getFacebookCustomConversions);
exports.default = router;
