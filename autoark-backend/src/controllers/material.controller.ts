import { Request, Response } from 'express'
import Material from '../models/Material'
import Folder from '../models/Folder'
import { uploadToR2, deleteFromR2, checkR2Config, generatePresignedUploadUrl, generatePresignedUploadUrls } from '../services/r2Storage.service'
import { 
  calculateFingerprint, 
  checkDuplicate, 
  recordFacebookMapping,
  findMaterialByFacebookId,
  getReusableMaterials,
  getMaterialFullData,
  aggregateMetricsToMaterials,
  recordAdMaterialMapping,
  recordAdMaterialMappings,
} from '../services/materialTracking.service'
import logger from '../utils/logger'
import { UserRole } from '../models/User'

/**
 * 素材管理控制器
 */

/**
 * 获取素材过滤条件
 * - 超级管理员：看所有
 * - 组织管理员：看本组织
 * - 普通成员：只看自己上传的
 */
const getMaterialFilter = (req: Request): any => {
  if (!req.user) return { _id: null } // 未认证，返回空结果
  
  // 超级管理员看所有
  if (req.user.role === UserRole.SUPER_ADMIN) return {}
  
  // 组织管理员看本组织
  if (req.user.role === UserRole.ORG_ADMIN && req.user.organizationId) {
    return { organizationId: req.user.organizationId }
  }
  
  // 普通成员只看自己上传的
  return { createdBy: req.user.userId }
}

/**
 * 检查 R2 配置状态
 * GET /api/materials/config-status
 */
export const getConfigStatus = async (req: Request, res: Response) => {
  try {
    const status = checkR2Config()
    res.json({ success: true, data: status })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取预签名上传 URL（单文件）
 * POST /api/materials/presigned-url
 * 客户端可使用此 URL 直接上传到 R2，无需经过服务器
 */
export const getPresignedUrl = async (req: Request, res: Response) => {
  try {
    const { fileName, mimeType, folder } = req.body
    
    if (!fileName || !mimeType) {
      return res.status(400).json({ success: false, error: '请提供文件名和类型' })
    }
    
    // 验证文件类型
    const isImage = mimeType.startsWith('image/')
    const isVideo = mimeType.startsWith('video/')
    if (!isImage && !isVideo) {
      return res.status(400).json({ success: false, error: '只支持图片和视频文件' })
    }
    
    const result = await generatePresignedUploadUrl({
      fileName,
      mimeType,
      folder: folder || 'materials',
    })
    
    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error })
    }
    
    logger.info(`[Material] Presigned URL generated for: ${fileName}`)
    
    res.json({
      success: true,
      data: {
        uploadUrl: result.uploadUrl,
        key: result.key,
        publicUrl: result.publicUrl,
      },
    })
  } catch (error: any) {
    logger.error('[Material] Get presigned URL failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 批量获取预签名上传 URL
 * POST /api/materials/presigned-urls
 */
export const getPresignedUrls = async (req: Request, res: Response) => {
  try {
    const { files } = req.body
    
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ success: false, error: '请提供文件列表' })
    }
    
    // 验证文件类型
    for (const file of files) {
      const isImage = file.mimeType?.startsWith('image/')
      const isVideo = file.mimeType?.startsWith('video/')
      if (!isImage && !isVideo) {
        return res.status(400).json({ 
          success: false, 
          error: `不支持的文件类型: ${file.fileName} (${file.mimeType})` 
        })
      }
    }
    
    const result = await generatePresignedUploadUrls(files)
    
    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error })
    }
    
    logger.info(`[Material] Presigned URLs generated for ${files.length} files`)
    
    res.json({
      success: true,
      data: result.urls,
    })
  } catch (error: any) {
    logger.error('[Material] Get presigned URLs failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 确认直传上传完成（创建素材记录）
 * POST /api/materials/confirm-upload
 * 客户端直传完成后调用此接口创建数据库记录
 */
export const confirmUpload = async (req: Request, res: Response) => {
  try {
    const { key, publicUrl, fileName, mimeType, size, folder, tags, notes } = req.body
    
    if (!key || !publicUrl || !fileName) {
      return res.status(400).json({ success: false, error: '参数不完整' })
    }
    
    const isImage = mimeType?.startsWith('image/')
    const isVideo = mimeType?.startsWith('video/')
    
    const material = new Material({
      name: fileName,
      type: isImage ? 'image' : (isVideo ? 'video' : 'other'),
      status: 'uploaded',
      storage: {
        provider: 'r2',
        bucket: process.env.R2_BUCKET_NAME,
        key,
        url: publicUrl,
      },
      file: {
        originalName: fileName,
        mimeType: mimeType || 'application/octet-stream',
        size: size || 0,
      },
      tags: tags ? (Array.isArray(tags) ? tags : tags.split(',').map((t: string) => t.trim())) : [],
      folder: folder || '默认',
      notes,
      // 记录创建者和组织
      createdBy: req.user?.userId,
      organizationId: req.user?.organizationId,
    })
    
    await material.save()
    logger.info(`[Material] Direct upload confirmed: ${material._id} - ${material.name}`)
    
    res.json({ success: true, data: material })
  } catch (error: any) {
    logger.error('[Material] Confirm upload failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 批量确认直传上传
 * POST /api/materials/confirm-uploads
 */
export const confirmUploads = async (req: Request, res: Response) => {
  try {
    const { files, folder, tags } = req.body
    
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ success: false, error: '请提供文件列表' })
    }
    
    const results: any[] = []
    const errors: any[] = []
    
    for (const file of files) {
      try {
        const isImage = file.mimeType?.startsWith('image/')
        const isVideo = file.mimeType?.startsWith('video/')
        
        const material = new Material({
          name: file.fileName,
          type: isImage ? 'image' : (isVideo ? 'video' : 'other'),
          status: 'uploaded',
          storage: {
            provider: 'r2',
            bucket: process.env.R2_BUCKET_NAME,
            key: file.key,
            url: file.publicUrl,
          },
          file: {
            originalName: file.fileName,
            mimeType: file.mimeType || 'application/octet-stream',
            size: file.size || 0,
          },
          tags: tags ? (Array.isArray(tags) ? tags : tags.split(',').map((t: string) => t.trim())) : [],
          folder: folder || '默认',
          // 记录创建者和组织
          createdBy: req.user?.userId,
          organizationId: req.user?.organizationId,
        })
        
        await material.save()
        results.push(material)
      } catch (err: any) {
        errors.push({ fileName: file.fileName, error: err.message })
      }
    }
    
    logger.info(`[Material] Batch direct upload confirmed: ${results.length} success, ${errors.length} failed`)
    
    res.json({
      success: true,
      data: {
        uploaded: results,
        failed: errors,
        total: files.length,
        successCount: results.length,
        failCount: errors.length,
      },
    })
  } catch (error: any) {
    logger.error('[Material] Confirm uploads failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 上传素材（传统方式，经过服务器）
 * POST /api/materials/upload
 * 
 * 功能增强：
 * 1. 计算素材指纹（pHash/MD5）
 * 2. 去重检测（同一素材不重复存储）
 * 3. 自动关联已有素材
 */
export const uploadMaterial = async (req: Request, res: Response) => {
  logger.info(`[Material] Upload request received`)
  try {
    const file = (req as any).file
    if (!file) {
      logger.warn('[Material] No file in request')
      return res.status(400).json({ success: false, error: '请选择要上传的文件' })
    }
    
    logger.info(`[Material] File received: ${file.originalname}, size: ${file.size}, type: ${file.mimetype}`)
    
    const { folder, tags, notes, skipDuplicateCheck } = req.body
    logger.info(`[Material] Folder: ${folder}, tags: ${tags}`)
    
    // 判断文件类型
    const isImage = file.mimetype.startsWith('image/')
    const isVideo = file.mimetype.startsWith('video/')
    
    if (!isImage && !isVideo) {
      logger.warn(`[Material] Unsupported file type: ${file.mimetype}`)
      return res.status(400).json({ success: false, error: '只支持图片和视频文件' })
    }
    
    const materialType = isImage ? 'image' : 'video'
    
    // ========== 1. 计算素材指纹 ==========
    logger.info(`[Material] Calculating fingerprint...`)
    const fingerprint = await calculateFingerprint(file.buffer, materialType)
    logger.info(`[Material] Fingerprint: ${fingerprint.fingerprintKey}`)
    
    // ========== 2. 去重检测 ==========
    if (!skipDuplicateCheck) {
      const duplicateCheck = await checkDuplicate(fingerprint, materialType)
      if (duplicateCheck.isDuplicate && duplicateCheck.existingMaterial) {
        logger.info(`[Material] Duplicate found: ${duplicateCheck.existingMaterial._id}`)
        return res.json({
          success: true,
          data: duplicateCheck.existingMaterial,
          isDuplicate: true,
          message: '素材已存在，返回现有素材',
        })
      }
    }
    
    logger.info(`[Material] Starting R2 upload...`)
    // 上传到 R2
    const uploadResult = await uploadToR2({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      folder: folder || 'materials',
    })
    logger.info(`[Material] R2 upload result:`, uploadResult.success ? 'success' : uploadResult.error)
    
    if (!uploadResult.success) {
      return res.status(500).json({ success: false, error: uploadResult.error || '上传失败' })
    }
    
    // 创建素材记录（含指纹）
    const material = new Material({
      name: file.originalname,
      type: materialType,
      status: 'uploaded',
      storage: {
        provider: 'r2',
        bucket: process.env.R2_BUCKET_NAME,
        key: uploadResult.key,
        url: uploadResult.url,
      },
      file: {
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      },
      fingerprint,
      fingerprintKey: fingerprint.fingerprintKey,
      tags: tags ? (Array.isArray(tags) ? tags : tags.split(',').map((t: string) => t.trim())) : [],
      folder: folder || '默认',
      notes,
      // 记录创建者和组织
      createdBy: req.user?.userId,
      organizationId: req.user?.organizationId,
    })
    
    await material.save()
    logger.info(`[Material] Uploaded: ${material._id} - ${material.name} (fingerprint: ${fingerprint.fingerprintKey})`)
    
    res.json({ success: true, data: material, isDuplicate: false })
  } catch (error: any) {
    logger.error('[Material] Upload failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 批量上传素材
 * POST /api/materials/upload-batch
 */
export const uploadMaterialBatch = async (req: Request, res: Response) => {
  try {
    const files = (req as any).files
    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, error: '请选择要上传的文件' })
    }
    
    const { folder, tags } = req.body
    const results: any[] = []
    const errors: any[] = []
    
    for (const file of files) {
      try {
        const isImage = file.mimetype.startsWith('image/')
        const isVideo = file.mimetype.startsWith('video/')
        
        if (!isImage && !isVideo) {
          errors.push({ name: file.originalname, error: '不支持的文件类型' })
          continue
        }
        
        const uploadResult = await uploadToR2({
          buffer: file.buffer,
          originalName: file.originalname,
          mimeType: file.mimetype,
          folder: folder || 'materials',
        })
        
        if (!uploadResult.success) {
          errors.push({ name: file.originalname, error: uploadResult.error })
          continue
        }
        
        const material = new Material({
          name: file.originalname,
          type: isImage ? 'image' : 'video',
          status: 'uploaded',
          storage: {
            provider: 'r2',
            bucket: process.env.R2_BUCKET_NAME,
            key: uploadResult.key,
            url: uploadResult.url,
          },
          file: {
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
          },
          tags: tags ? (Array.isArray(tags) ? tags : tags.split(',').map((t: string) => t.trim())) : [],
          folder: folder || '默认',
          // 记录创建者和组织
          createdBy: req.user?.userId,
          organizationId: req.user?.organizationId,
        })
        
        await material.save()
        results.push(material)
      } catch (err: any) {
        errors.push({ name: file.originalname, error: err.message })
      }
    }
    
    logger.info(`[Material] Batch upload: ${results.length} success, ${errors.length} failed`)
    
    res.json({
      success: true,
      data: {
        uploaded: results,
        failed: errors,
        total: files.length,
        successCount: results.length,
        failCount: errors.length,
      },
    })
  } catch (error: any) {
    logger.error('[Material] Batch upload failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取素材列表
 * GET /api/materials
 */
export const getMaterialList = async (req: Request, res: Response) => {
  try {
    const { 
      type, 
      folder, 
      tags, 
      status = 'uploaded',
      search,
      page = 1, 
      pageSize = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query
    
    // 根据用户权限过滤
    const filter: any = { status, ...getMaterialFilter(req) }
    
    if (type) filter.type = type
    if (folder) filter.folder = folder
    if (tags) {
      const tagList = (tags as string).split(',').map(t => t.trim())
      filter.tags = { $in: tagList }
    }
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { notes: { $regex: search, $options: 'i' } },
      ]
    }
    
    const sort: any = {}
    sort[sortBy as string] = sortOrder === 'asc' ? 1 : -1
    
    const [list, total] = await Promise.all([
      Material.find(filter)
        .sort(sort)
        .skip((Number(page) - 1) * Number(pageSize))
        .limit(Number(pageSize))
        .lean(),
      Material.countDocuments(filter),
    ])
    
    res.json({
      success: true,
      data: {
        list,
        total,
        page: Number(page),
        pageSize: Number(pageSize),
        totalPages: Math.ceil(total / Number(pageSize)),
      },
    })
  } catch (error: any) {
    logger.error('[Material] Get list failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取素材详情
 * GET /api/materials/:id
 */
export const getMaterial = async (req: Request, res: Response) => {
  try {
    const material = await Material.findById(req.params.id)
    if (!material) {
      return res.status(404).json({ success: false, error: '素材不存在' })
    }
    res.json({ success: true, data: material })
  } catch (error: any) {
    logger.error('[Material] Get detail failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 更新素材信息
 * PUT /api/materials/:id
 */
export const updateMaterial = async (req: Request, res: Response) => {
  try {
    const { name, tags, folder, notes } = req.body
    
    const material = await Material.findByIdAndUpdate(
      req.params.id,
      { 
        ...(name && { name }),
        ...(tags && { tags: Array.isArray(tags) ? tags : tags.split(',').map((t: string) => t.trim()) }),
        ...(folder && { folder }),
        ...(notes !== undefined && { notes }),
      },
      { new: true }
    )
    
    if (!material) {
      return res.status(404).json({ success: false, error: '素材不存在' })
    }
    
    res.json({ success: true, data: material })
  } catch (error: any) {
    logger.error('[Material] Update failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 删除素材
 * DELETE /api/materials/:id
 */
export const deleteMaterial = async (req: Request, res: Response) => {
  try {
    const material: any = await Material.findById(req.params.id)
    if (!material) {
      return res.status(404).json({ success: false, error: '素材不存在' })
    }
    
    // 从 R2 删除文件
    if (material.storage?.key) {
      await deleteFromR2(material.storage.key)
    }
    
    // 软删除（更新状态）
    material.status = 'deleted'
    await material.save()
    
    logger.info(`[Material] Deleted: ${material._id}`)
    res.json({ success: true })
  } catch (error: any) {
    logger.error('[Material] Delete failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 批量删除素材
 * POST /api/materials/delete-batch
 */
export const deleteMaterialBatch = async (req: Request, res: Response) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: '请选择要删除的素材' })
    }
    
    const materials = await Material.find({ _id: { $in: ids } })
    
    // 从 R2 删除文件
    for (const material of materials) {
      const m = material as any
      if (m.storage?.key) {
        await deleteFromR2(m.storage.key)
      }
    }
    
    // 批量软删除
    await Material.updateMany(
      { _id: { $in: ids } },
      { status: 'deleted' }
    )
    
    logger.info(`[Material] Batch deleted: ${ids.length} items`)
    res.json({ success: true, data: { deletedCount: ids.length } })
  } catch (error: any) {
    logger.error('[Material] Batch delete failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取文件夹列表
 * GET /api/materials/folders
 */
export const getFolders = async (req: Request, res: Response) => {
  try {
    const folders = await Material.distinct('folder', { status: 'uploaded' })
    const folderStats = await Material.aggregate([
      { $match: { status: 'uploaded' } },
      { $group: { _id: '$folder', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ])
    
    res.json({
      success: true,
      data: folderStats.map(f => ({
        name: f._id || '默认',
        count: f.count,
      })),
    })
  } catch (error: any) {
    logger.error('[Material] Get folders failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取标签列表
 * GET /api/materials/tags
 */
export const getTags = async (req: Request, res: Response) => {
  try {
    const tags = await Material.aggregate([
      { $match: { status: 'uploaded' } },
      { $unwind: '$tags' },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 50 },
    ])
    
    res.json({
      success: true,
      data: tags.map(t => ({
        name: t._id,
        count: t.count,
      })),
    })
  } catch (error: any) {
    logger.error('[Material] Get tags failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 移动素材到指定文件夹
 * POST /api/materials/move-to-folder
 */
export const moveToFolder = async (req: Request, res: Response) => {
  try {
    const { ids, folder } = req.body
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: '请选择要移动的素材' })
    }
    if (!folder) {
      return res.status(400).json({ success: false, error: '请选择目标文件夹' })
    }
    
    const result = await Material.updateMany(
      { _id: { $in: ids }, status: 'uploaded' },
      { folder }
    )
    
    logger.info(`[Material] Moved ${result.modifiedCount} items to folder: ${folder}`)
    res.json({ success: true, data: { modifiedCount: result.modifiedCount } })
  } catch (error: any) {
    logger.error('[Material] Move to folder failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ==================== 文件夹管理 API ====================

/**
 * 获取文件夹树
 * GET /api/materials/folder-tree
 */
export const getFolderTree = async (req: Request, res: Response) => {
  try {
    // 获取所有文件夹
    const folders = await Folder.find().sort({ path: 1 }).lean()
    
    // 获取每个文件夹的素材数量
    const folderStats = await Material.aggregate([
      { $match: { status: 'uploaded' } },
      { $group: { _id: '$folder', count: { $sum: 1 } } },
    ])
    
    const countMap: Record<string, number> = {}
    folderStats.forEach(f => {
      countMap[f._id || '默认'] = f.count
    })
    
    // 构建带数量的文件夹列表
    const foldersWithCount = folders.map(f => ({
      ...f,
      count: countMap[f.path] || 0,
    }))
    
    // 计算总数
    const totalCount = folderStats.reduce((sum, f) => sum + f.count, 0)
    
    res.json({
      success: true,
      data: {
        folders: foldersWithCount,
        totalCount,
      },
    })
  } catch (error: any) {
    logger.error('[Folder] Get tree failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 创建文件夹
 * POST /api/materials/create-folder
 */
export const createFolder = async (req: Request, res: Response) => {
  try {
    const { name, parentId } = req.body
    
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: '请输入文件夹名称' })
    }
    
    let path = name.trim()
    let level = 0
    
    // 如果有父文件夹
    if (parentId) {
      const parent = await Folder.findById(parentId)
      if (!parent) {
        return res.status(400).json({ success: false, error: '父文件夹不存在' })
      }
      path = `${parent.path}/${name.trim()}`
      level = parent.level + 1
    }
    
    // 检查是否已存在
    const existing = await Folder.findOne({ parentId: parentId || null, name: name.trim() })
    if (existing) {
      return res.status(400).json({ success: false, error: '同名文件夹已存在' })
    }
    
    const folder = new Folder({
      name: name.trim(),
      parentId: parentId || null,
      path,
      level,
    })
    
    await folder.save()
    logger.info(`[Folder] Created: ${path}`)
    
    res.json({ success: true, data: folder })
  } catch (error: any) {
    logger.error('[Folder] Create failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 重命名文件夹
 * POST /api/materials/rename-folder
 */
export const renameFolder = async (req: Request, res: Response) => {
  try {
    const { folderId, newName } = req.body
    
    if (!folderId || !newName || !newName.trim()) {
      return res.status(400).json({ success: false, error: '参数不完整' })
    }
    
    const folder: any = await Folder.findById(folderId)
    if (!folder) {
      return res.status(404).json({ success: false, error: '文件夹不存在' })
    }
    
    const oldPath = folder.path
    const oldName = folder.name
    
    // 计算新路径
    let newPath: string
    if (folder.parentId) {
      const parent = await Folder.findById(folder.parentId)
      newPath = parent ? `${parent.path}/${newName.trim()}` : newName.trim()
    } else {
      newPath = newName.trim()
    }
    
    // 检查同级是否有重名
    const existing = await Folder.findOne({ 
      parentId: folder.parentId, 
      name: newName.trim(),
      _id: { $ne: folderId }
    })
    if (existing) {
      return res.status(400).json({ success: false, error: '同名文件夹已存在' })
    }
    
    // 更新当前文件夹
    folder.name = newName.trim()
    folder.path = newPath
    await folder.save()
    
    // 更新所有子文件夹的路径
    await Folder.updateMany(
      { path: { $regex: `^${oldPath}/` } },
      [{ $set: { path: { $replaceOne: { input: '$path', find: oldPath, replacement: newPath } } } }]
    )
    
    // 更新素材的文件夹路径
    await Material.updateMany(
      { folder: oldPath, status: 'uploaded' },
      { folder: newPath }
    )
    
    // 更新子文件夹下素材的路径
    await Material.updateMany(
      { folder: { $regex: `^${oldPath}/` }, status: 'uploaded' },
      [{ $set: { folder: { $replaceOne: { input: '$folder', find: oldPath, replacement: newPath } } } }]
    )
    
    logger.info(`[Folder] Renamed: ${oldPath} -> ${newPath}`)
    res.json({ success: true, data: folder })
  } catch (error: any) {
    logger.error('[Folder] Rename failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 删除文件夹
 * POST /api/materials/delete-folder
 */
export const deleteFolder = async (req: Request, res: Response) => {
  try {
    const { folderId, moveToPath } = req.body
    
    if (!folderId) {
      return res.status(400).json({ success: false, error: '请指定要删除的文件夹' })
    }
    
    const folder: any = await Folder.findById(folderId)
    if (!folder) {
      return res.status(404).json({ success: false, error: '文件夹不存在' })
    }
    
    const folderPath = folder.path
    const targetPath = moveToPath || '默认'
    
    // 移动该文件夹及子文件夹下的素材到目标文件夹
    await Material.updateMany(
      { 
        $or: [
          { folder: folderPath },
          { folder: { $regex: `^${folderPath}/` } }
        ],
        status: 'uploaded' 
      },
      { folder: targetPath }
    )
    
    // 删除所有子文件夹
    await Folder.deleteMany({ path: { $regex: `^${folderPath}/` } })
    
    // 删除当前文件夹
    await Folder.findByIdAndDelete(folderId)
    
    logger.info(`[Folder] Deleted: ${folderPath}, materials moved to: ${targetPath}`)
    res.json({ success: true })
  } catch (error: any) {
    logger.error('[Folder] Delete failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ==================== 素材追踪 API ====================

/**
 * 记录素材上传到 Facebook 的映射关系
 * POST /api/materials/record-fb-mapping
 * 
 * 当素材被上传到 Facebook 账户时调用
 * 用于建立 素材库 → Facebook 的精准归因
 */
export const recordFbMapping = async (req: Request, res: Response) => {
  try {
    const { materialId, accountId, imageHash, videoId } = req.body
    
    if (!materialId || !accountId) {
      return res.status(400).json({ success: false, error: '参数不完整' })
    }
    
    if (!imageHash && !videoId) {
      return res.status(400).json({ success: false, error: '请提供 imageHash 或 videoId' })
    }
    
    const success = await recordFacebookMapping(materialId, accountId, { imageHash, videoId })
    
    if (!success) {
      return res.status(500).json({ success: false, error: '记录映射失败' })
    }
    
    logger.info(`[Material] FB mapping recorded: ${materialId} -> ${accountId}`)
    res.json({ success: true })
  } catch (error: any) {
    logger.error('[Material] Record FB mapping failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 根据 Facebook 标识查找素材
 * GET /api/materials/find-by-fb
 * 
 * 用于数据归因：通过 imageHash/videoId 找到对应的素材库素材
 */
export const findByFacebookId = async (req: Request, res: Response) => {
  try {
    const { imageHash, videoId } = req.query
    
    if (!imageHash && !videoId) {
      return res.status(400).json({ success: false, error: '请提供 imageHash 或 videoId' })
    }
    
    const material = await findMaterialByFacebookId({
      imageHash: imageHash as string,
      videoId: videoId as string,
    })
    
    if (!material) {
      return res.status(404).json({ success: false, error: '未找到对应素材' })
    }
    
    res.json({ success: true, data: material })
  } catch (error: any) {
    logger.error('[Material] Find by FB ID failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取可复用的高质量素材（供 AI Agent 使用）
 * GET /api/materials/reusable
 */
export const getReusable = async (req: Request, res: Response) => {
  try {
    const {
      type,
      minRoas = '1',
      minSpend = '50',
      minQualityScore = '60',
      limit = '20',
      sortBy = 'qualityScore',
    } = req.query
    
    const materials = await getReusableMaterials({
      type: type as 'image' | 'video' | undefined,
      minRoas: parseFloat(minRoas as string),
      minSpend: parseFloat(minSpend as string),
      minQualityScore: parseInt(minQualityScore as string),
      limit: parseInt(limit as string),
      sortBy: sortBy as 'roas' | 'spend' | 'qualityScore',
    })
    
    res.json({ success: true, data: materials })
  } catch (error: any) {
    logger.error('[Material] Get reusable failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取素材完整数据（含历史趋势）
 * GET /api/materials/:id/full-data
 */
export const getFullData = async (req: Request, res: Response) => {
  try {
    const data = await getMaterialFullData(req.params.id)
    res.json({ success: true, data })
  } catch (error: any) {
    logger.error('[Material] Get full data failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 手动触发素材指标归因（每日定时任务也会执行）
 * POST /api/materials/aggregate-metrics
 */
export const aggregateMetrics = async (req: Request, res: Response) => {
  try {
    const { date } = req.body
    const targetDate = date || new Date().toISOString().split('T')[0]
    
    logger.info(`[Material] Manual metrics aggregation for ${targetDate}`)
    const result = await aggregateMetricsToMaterials(targetDate)
    
    res.json({
      success: true,
      data: result,
      message: `归因完成：处理 ${result.processed} 条，精准匹配 ${result.matchedByAdMapping} 条，FB匹配 ${result.matchedByFbId} 条，未匹配 ${result.unmatched} 条`,
    })
  } catch (error: any) {
    logger.error('[Material] Aggregate metrics failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ==================== 广告-素材映射 API（精准归因核心）====================

/**
 * 记录广告-素材映射（发布广告时调用）
 * POST /api/materials/record-ad-mapping
 * 
 * 这是精准归因的入口！
 * 当 AutoArk 发布广告成功后，调用此接口记录 adId → materialId 的映射
 */
export const recordAdMapping = async (req: Request, res: Response) => {
  try {
    const {
      adId,
      materialId,
      accountId,
      campaignId,
      adsetId,
      creativeId,
      materialType,
      materialName,
      materialUrl,
      fbImageHash,
      fbVideoId,
      publishedBy,
      taskId,
    } = req.body
    
    if (!adId || !materialId) {
      return res.status(400).json({ success: false, error: '缺少 adId 或 materialId' })
    }
    
    const success = await recordAdMaterialMapping({
      adId,
      materialId,
      accountId,
      campaignId,
      adsetId,
      creativeId,
      materialType,
      materialName,
      materialUrl,
      fbImageHash,
      fbVideoId,
      publishedBy,
      taskId,
    })
    
    if (!success) {
      return res.status(500).json({ success: false, error: '记录映射失败' })
    }
    
    res.json({ success: true, message: '映射记录成功' })
  } catch (error: any) {
    logger.error('[Material] Record ad mapping failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 批量记录广告-素材映射
 * POST /api/materials/record-ad-mappings
 */
export const recordAdMappingsBatch = async (req: Request, res: Response) => {
  try {
    const { mappings } = req.body
    
    if (!mappings || !Array.isArray(mappings) || mappings.length === 0) {
      return res.status(400).json({ success: false, error: '请提供映射列表' })
    }
    
    const result = await recordAdMaterialMappings(mappings)
    
    res.json({
      success: true,
      data: result,
      message: `批量记录完成：成功 ${result.success} 条，失败 ${result.failed} 条`,
    })
  } catch (error: any) {
    logger.error('[Material] Record ad mappings batch failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

