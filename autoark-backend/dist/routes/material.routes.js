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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const materialController = __importStar(require("../controllers/material.controller"));
const auth_1 = require("../middlewares/auth");
const router = (0, express_1.Router)();
// 所有路由都需要认证
router.use(auth_1.authenticate);
// 配置 multer（内存存储）
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: {
        fileSize: 100 * 1024 * 1024, // 100MB 限制
    },
    fileFilter: (req, file, cb) => {
        // 只允许图片和视频
        if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
            cb(null, true);
        }
        else {
            cb(new Error('只支持图片和视频文件'));
        }
    },
});
// R2 配置状态
router.get('/config-status', materialController.getConfigStatus);
// ==================== 直传 R2 接口（推荐，更快） ====================
// 获取预签名上传 URL（单文件）
router.post('/presigned-url', materialController.getPresignedUrl);
// 批量获取预签名上传 URL
router.post('/presigned-urls', materialController.getPresignedUrls);
// 确认直传上传完成（创建素材记录）
router.post('/confirm-upload', materialController.confirmUpload);
// 批量确认直传上传
router.post('/confirm-uploads', materialController.confirmUploads);
// ==================== 传统上传接口（经过服务器） ====================
// 单文件上传
router.post('/upload', upload.single('file'), materialController.uploadMaterial);
// 批量上传（最多 10 个）
router.post('/upload-batch', upload.array('files', 10), materialController.uploadMaterialBatch);
// 素材列表
router.get('/', materialController.getMaterialList);
// 文件夹列表（旧接口，保留兼容）
router.get('/folders', materialController.getFolders);
// 文件夹树（新接口，支持层级）
router.get('/folder-tree', materialController.getFolderTree);
// 创建文件夹
router.post('/create-folder', materialController.createFolder);
// 重命名文件夹
router.post('/rename-folder', materialController.renameFolder);
// 删除文件夹
router.post('/delete-folder', materialController.deleteFolder);
// 移动素材到文件夹
router.post('/move-to-folder', materialController.moveToFolder);
// 标签列表
router.get('/tags', materialController.getTags);
// ==================== 素材追踪 API ====================
// 记录 Facebook 映射（旧方式，兼容）
router.post('/record-fb-mapping', materialController.recordFbMapping);
// 根据 Facebook 标识查找素材
router.get('/find-by-fb', materialController.findByFacebookId);
// 获取可复用的高质量素材（AI Agent 使用）
router.get('/reusable', materialController.getReusable);
// 手动触发指标归因
router.post('/aggregate-metrics', materialController.aggregateMetrics);
// ==================== 精准归因 API（核心）====================
// 记录广告-素材映射（发布广告后调用，精准归因的关键！）
router.post('/record-ad-mapping', materialController.recordAdMapping);
// 批量记录广告-素材映射
router.post('/record-ad-mappings', materialController.recordAdMappingsBatch);
// 素材详情（含完整数据）
router.get('/:id/full-data', materialController.getFullData);
// 素材详情
router.get('/:id', materialController.getMaterial);
// 更新素材
router.put('/:id', materialController.updateMaterial);
// 删除素材
router.delete('/:id', materialController.deleteMaterial);
// 批量删除
router.post('/delete-batch', materialController.deleteMaterialBatch);
exports.default = router;
