import { Router } from 'express'
import multer from 'multer'
import * as materialController from '../controllers/material.controller'

const router = Router()

// 配置 multer（内存存储）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB 限制
  },
  fileFilter: (req, file, cb) => {
    // 只允许图片和视频
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true)
    } else {
      cb(new Error('只支持图片和视频文件'))
    }
  },
})

// R2 配置状态
router.get('/config-status', materialController.getConfigStatus)

// 单文件上传
router.post('/upload', upload.single('file'), materialController.uploadMaterial)

// 批量上传（最多 10 个）
router.post('/upload-batch', upload.array('files', 10), materialController.uploadMaterialBatch)

// 素材列表
router.get('/', materialController.getMaterialList)

// 文件夹列表
router.get('/folders', materialController.getFolders)

// 重命名文件夹
router.post('/rename-folder', materialController.renameFolder)

// 删除文件夹
router.post('/delete-folder', materialController.deleteFolder)

// 移动素材到文件夹
router.post('/move-to-folder', materialController.moveToFolder)

// 标签列表
router.get('/tags', materialController.getTags)

// 素材详情
router.get('/:id', materialController.getMaterial)

// 更新素材
router.put('/:id', materialController.updateMaterial)

// 删除素材
router.delete('/:id', materialController.deleteMaterial)

// 批量删除
router.post('/delete-batch', materialController.deleteMaterialBatch)

export default router

