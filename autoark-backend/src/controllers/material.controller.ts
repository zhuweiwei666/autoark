import { Request, Response } from 'express'
import { createHash } from 'crypto'
import Material from '../models/Material'
import Folder from '../models/Folder'
import Account from '../models/Account'
import Ad from '../models/Ad'
import { uploadToR2, deleteFromR2, getObjectFromR2, checkR2Config, generatePresignedUploadUrl, generatePresignedUploadUrls, getPublicUrlForKey } from '../services/r2Storage.service'
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
import {
  combineFilters,
  isSuperAdmin,
  objectIdValue,
  sanitizeScopedUpdate,
  scopedOwnerFilter,
} from '../utils/accessControl'
import { normalizeForApi, normalizeForStorage } from '../utils/accountId'
import { parsePagination } from '../utils/pagination'

/**
 * 素材管理控制器
 */

/**
 * 获取素材过滤条件
 * - 超级管理员：看所有
 * - 组织管理员：看本组织 + 公共数据
 * - 普通成员：看自己上传的 + 公共数据
 */
const getMaterialFilter = (req: Request): any => {
  return scopedOwnerFilter(req)
}

const MATERIAL_SORT_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'name',
  'type',
  'file.size',
  'metrics.totalSpend',
  'metrics.avgRoas',
  'metrics.qualityScore',
])

const getTenantStorageRoot = (req: Request): string => {
  if (req.user?.organizationId) return `tenants/org-${hashStorageScope(req.user.organizationId)}`
  if (req.user?.userId) return `tenants/user-${hashStorageScope(req.user.userId)}`
  return 'tenants/anonymous'
}

const hashStorageScope = (value: string): string => (
  createHash('sha256').update(String(value)).digest('hex').slice(0, 16)
)

const getScopedStorageFolder = (req: Request, folder?: string): string => {
  const requestedFolder = typeof folder === 'string' && folder.trim() ? folder.trim() : 'materials'
  return `${getTenantStorageRoot(req)}/${requestedFolder.replace(/^\/+/, '')}`
}

const getScopedFingerprintKey = (req: Request, fingerprintKey?: string): string | undefined => {
  if (!fingerprintKey) return undefined
  return `${getTenantStorageRoot(req).replace(/\//g, ':')}:${fingerprintKey}`
}

const normalizeStorageKey = (key: string): string => String(key || '').replace(/^\/+/, '')

const resolveScopedStorageKey = (req: Request, key: string): string | null => {
  const normalizedKey = normalizeStorageKey(key)
  const root = `${getTenantStorageRoot(req)}/`

  if (!normalizedKey || normalizedKey.includes('..') || !normalizedKey.startsWith(root)) {
    return null
  }

  return normalizedKey
}

const validateScopedStorageKey = (req: Request, res: Response, key: string): string | null => {
  const scopedKey = resolveScopedStorageKey(req, key)
  if (!scopedKey) {
    res.status(400).json({ success: false, error: '素材存储路径不属于当前租户' })
  }
  return scopedKey
}

const escapeRegexLiteral = (value: string): string => (
  String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
)

const childPathRegex = (path: string): string => `^${escapeRegexLiteral(path)}/`

const idString = (value: any): string | undefined => (
  value?.toString?.() || (value ? String(value) : undefined)
)

const accountIdVariants = (accountId?: string): string[] => {
  if (!accountId) return []
  return Array.from(new Set([
    normalizeForStorage(accountId),
    normalizeForApi(accountId),
    String(accountId),
  ].filter(Boolean)))
}

const mappingOrgFilter = (organizationId?: string): any => (
  organizationId ? { organizationId: objectIdValue(organizationId) } : {}
)

const validateMappingAssetScope = async (
  req: Request,
  mapping: { adId?: string; accountId?: string; campaignId?: string },
  materialOrganizationId?: string,
): Promise<string | null> => {
  const organizationId = materialOrganizationId || req.user?.organizationId

  if (!organizationId && isSuperAdmin(req)) return null
  if (!organizationId) return '当前用户缺少组织信息，无法校验广告资产归属'

  if (mapping.adId) {
    const ad = await Ad.findOne(combineFilters(
      { adId: mapping.adId },
      mappingOrgFilter(organizationId),
    )).select('adId accountId campaignId organizationId').lean()

    if (ad) {
      if (
        mapping.accountId &&
        ad.accountId &&
        normalizeForStorage(mapping.accountId) !== normalizeForStorage(ad.accountId)
      ) {
        return '广告账户与广告记录不匹配'
      }

      if (mapping.campaignId && ad.campaignId && String(mapping.campaignId) !== String(ad.campaignId)) {
        return '广告系列与广告记录不匹配'
      }

      return null
    }
  }

  if (mapping.accountId) {
    const account = await Account.findOne(combineFilters(
      {
        channel: 'facebook',
        accountId: { $in: accountIdVariants(mapping.accountId) },
      },
      mappingOrgFilter(organizationId),
    )).select('_id accountId organizationId').lean()

    return account ? null : '广告账户不存在或无权访问'
  }

  return '缺少可校验的广告或账户归属信息'
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
 * 公开读取 R2 素材
 * GET /api/materials/public/:key
 */
export const streamPublicMaterial = async (req: Request, res: Response) => {
  try {
    const rawKey = req.params[0] || ''
    let key = ''

    try {
      key = decodeURIComponent(rawKey).replace(/^\/+/, '')
    } catch {
      return res.status(400).json({ success: false, error: '无效的素材路径' })
    }

    if (!key || key.includes('..')) {
      return res.status(400).json({ success: false, error: '无效的素材路径' })
    }

    const material = await Material.findOne({
      'storage.key': key,
      status: { $ne: 'deleted' },
    }).select('_id storage.key').lean()

    if (!material) {
      return res.status(404).json({ success: false, error: '素材不存在' })
    }

    const object = await getObjectFromR2(key)
    if (object.ContentType) res.setHeader('Content-Type', object.ContentType)
    if (object.ContentLength) res.setHeader('Content-Length', String(object.ContentLength))
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')

    const body = object.Body as any
    if (body && typeof body.pipe === 'function') {
      return body.pipe(res)
    }

    if (body) {
      return res.send(body)
    }

    return res.status(404).json({ success: false, error: '素材不存在' })
  } catch (error: any) {
    logger.warn('[Material] Public material stream failed:', error.message)
    const status = error?.$metadata?.httpStatusCode === 404 ? 404 : 500
    res.status(status).json({ success: false, error: status === 404 ? '素材不存在' : '读取素材失败' })
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
      folder: getScopedStorageFolder(req, folder || 'materials'),
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
    const { files, folder } = req.body
    
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
    
    const result = await generatePresignedUploadUrls(files, getScopedStorageFolder(req, folder || 'materials'))
    
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
    const { key, fileName, mimeType, size, folder, tags, notes } = req.body
    
    if (!key || !fileName) {
      return res.status(400).json({ success: false, error: '参数不完整' })
    }

    const scopedKey = validateScopedStorageKey(req, res, key)
    if (!scopedKey) return
    
    const isImage = mimeType?.startsWith('image/')
    const isVideo = mimeType?.startsWith('video/')
    if (!isImage && !isVideo) {
      return res.status(400).json({ success: false, error: '只支持图片和视频文件' })
    }
    
    const material = new Material({
      name: fileName,
      type: isImage ? 'image' : (isVideo ? 'video' : 'other'),
      status: 'uploaded',
      storage: {
        provider: 'r2',
        bucket: process.env.R2_BUCKET_NAME,
        key: scopedKey,
        url: getPublicUrlForKey(scopedKey),
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
        if (!isImage && !isVideo) {
          errors.push({ fileName: file.fileName, error: '只支持图片和视频文件' })
          continue
        }
        const scopedKey = resolveScopedStorageKey(req, file.key)
        if (!scopedKey) {
          errors.push({ fileName: file.fileName, error: '素材存储路径不属于当前租户' })
          continue
        }
        
        const material = new Material({
          name: file.fileName,
          type: isImage ? 'image' : (isVideo ? 'video' : 'other'),
          status: 'uploaded',
          storage: {
            provider: 'r2',
            bucket: process.env.R2_BUCKET_NAME,
            key: scopedKey,
            url: getPublicUrlForKey(scopedKey),
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
      const duplicateCheck = await checkDuplicate(fingerprint, materialType, getMaterialFilter(req))
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
      folder: getScopedStorageFolder(req, folder || 'materials'),
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
      fingerprintKey: getScopedFingerprintKey(req, fingerprint.fingerprintKey),
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
          folder: getScopedStorageFolder(req, folder || 'materials'),
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
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query
    const { page, pageSize, skip } = parsePagination(req.query)
    
    // 根据用户权限过滤
    let filter: any = combineFilters({ status }, getMaterialFilter(req))
    
    if (type) filter = combineFilters(filter, { type })
    if (folder) filter = combineFilters(filter, { folder })
    if (tags) {
      const tagList = (tags as string).split(',').map(t => t.trim())
      filter = combineFilters(filter, { tags: { $in: tagList } })
    }
    if (search) {
      filter = combineFilters(filter, {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { notes: { $regex: search, $options: 'i' } },
        ],
      })
    }
    
    const sort: any = {}
    const safeSortBy = MATERIAL_SORT_FIELDS.has(String(sortBy)) ? String(sortBy) : 'createdAt'
    sort[safeSortBy] = sortOrder === 'asc' ? 1 : -1
    
    const [list, total] = await Promise.all([
      Material.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(pageSize)
        .lean(),
      Material.countDocuments(filter),
    ])
    
    res.json({
      success: true,
      data: {
        list,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
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
    const material = await Material.findOne(combineFilters({ _id: req.params.id }, getMaterialFilter(req)))
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
    const { name, tags, folder, notes } = sanitizeScopedUpdate(req.body)
    
    const material = await Material.findOneAndUpdate(
      combineFilters({ _id: req.params.id }, getMaterialFilter(req)),
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
    const material: any = await Material.findOne(combineFilters({ _id: req.params.id }, getMaterialFilter(req)))
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
    
    const materials = await Material.find(combineFilters({ _id: { $in: ids } }, getMaterialFilter(req)))
    
    // 从 R2 删除文件
    for (const material of materials) {
      const m = material as any
      if (m.storage?.key) {
        await deleteFromR2(m.storage.key)
      }
    }
    
    // 批量软删除
    await Material.updateMany(
      combineFilters({ _id: { $in: ids } }, getMaterialFilter(req)),
      { status: 'deleted' }
    )
    
    logger.info(`[Material] Batch deleted: ${materials.length} items`)
    res.json({ success: true, data: { deletedCount: materials.length } })
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
    // 添加用户过滤
    const userFilter = getMaterialFilter(req)
    const baseFilter = { status: 'uploaded', ...userFilter }
    
    const folders = await Material.distinct('folder', baseFilter)
    const folderStats = await Material.aggregate([
      { $match: baseFilter },
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
      { $match: combineFilters({ status: 'uploaded' }, getMaterialFilter(req)) },
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
      combineFilters({ _id: { $in: ids }, status: 'uploaded' }, getMaterialFilter(req)),
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
    // 添加用户过滤
    const userFilter = getMaterialFilter(req)
    const baseFilter = { status: 'uploaded', ...userFilter }
    
    // 获取用户可见文件夹
    const folders = await Folder.find(getMaterialFilter(req)).sort({ path: 1 }).lean()
    
    // 获取每个文件夹的素材数量（仅统计用户可见的素材）
    const folderStats = await Material.aggregate([
      { $match: baseFilter },
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
      const parent = await Folder.findOne(combineFilters({ _id: parentId }, getMaterialFilter(req)))
      if (!parent) {
        return res.status(400).json({ success: false, error: '父文件夹不存在' })
      }
      path = `${parent.path}/${name.trim()}`
      level = parent.level + 1
    }
    
    // 检查是否已存在
    const existing = await Folder.findOne(combineFilters(
      { parentId: parentId || null, name: name.trim() },
      getMaterialFilter(req),
    ))
    if (existing) {
      return res.status(400).json({ success: false, error: '同名文件夹已存在' })
    }
    
    const folder = new Folder({
      name: name.trim(),
      parentId: parentId || null,
      path,
      level,
      createdBy: req.user?.userId,
      organizationId: req.user?.organizationId,
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
    
    const folder: any = await Folder.findOne(combineFilters({ _id: folderId }, getMaterialFilter(req)))
    if (!folder) {
      return res.status(404).json({ success: false, error: '文件夹不存在' })
    }
    
    const oldPath = folder.path
    const oldName = folder.name
    
    // 计算新路径
    let newPath: string
    if (folder.parentId) {
      const parent = await Folder.findOne(combineFilters({ _id: folder.parentId }, getMaterialFilter(req)))
      newPath = parent ? `${parent.path}/${newName.trim()}` : newName.trim()
    } else {
      newPath = newName.trim()
    }
    
    // 检查同级是否有重名
    const existing = await Folder.findOne(combineFilters({
      parentId: folder.parentId, 
      name: newName.trim(),
      _id: { $ne: folderId }
    }, getMaterialFilter(req)))
    if (existing) {
      return res.status(400).json({ success: false, error: '同名文件夹已存在' })
    }
    
    // 更新当前文件夹
    folder.name = newName.trim()
    folder.path = newPath
    await folder.save()
    
    // 更新所有子文件夹的路径
    await Folder.updateMany(
      combineFilters({ path: { $regex: childPathRegex(oldPath) } }, getMaterialFilter(req)),
      [{ $set: { path: { $replaceOne: { input: '$path', find: oldPath, replacement: newPath } } } }]
    )
    
    // 更新素材的文件夹路径
    await Material.updateMany(
      combineFilters({ folder: oldPath, status: 'uploaded' }, getMaterialFilter(req)),
      { folder: newPath }
    )
    
    // 更新子文件夹下素材的路径
    await Material.updateMany(
      combineFilters({ folder: { $regex: childPathRegex(oldPath) }, status: 'uploaded' }, getMaterialFilter(req)),
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
    
    const folder: any = await Folder.findOne(combineFilters({ _id: folderId }, getMaterialFilter(req)))
    if (!folder) {
      return res.status(404).json({ success: false, error: '文件夹不存在' })
    }
    
    const folderPath = folder.path
    const targetPath = moveToPath || '默认'
    
    // 移动该文件夹及子文件夹下的素材到目标文件夹
    await Material.updateMany(
      combineFilters({
        $or: [
          { folder: folderPath },
          { folder: { $regex: childPathRegex(folderPath) } }
        ],
        status: 'uploaded' 
      }, getMaterialFilter(req)),
      { folder: targetPath }
    )

    // 删除所有子文件夹
    await Folder.deleteMany(combineFilters({ path: { $regex: childPathRegex(folderPath) } }, getMaterialFilter(req)))
    
    // 删除当前文件夹
    await Folder.deleteOne(combineFilters({ _id: folderId }, getMaterialFilter(req)))
    
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

    const material = await Material.findOne(combineFilters({ _id: materialId }, getMaterialFilter(req))).lean()
    if (!material) {
      return res.status(404).json({ success: false, error: '素材不存在或无权访问' })
    }
    const scopeError = await validateMappingAssetScope(
      req,
      { accountId },
      idString((material as any).organizationId),
    )
    if (scopeError) {
      return res.status(403).json({ success: false, error: scopeError })
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
    const visibleMaterial = await Material.findOne(combineFilters({ _id: material._id }, getMaterialFilter(req))).lean()
    if (!visibleMaterial) {
      return res.status(404).json({ success: false, error: '未找到对应素材' })
    }
    
    res.json({ success: true, data: visibleMaterial })
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
      scopeFilter: getMaterialFilter(req),
    })
    const visibleMaterials = await Material.find(combineFilters(
      { _id: { $in: materials.map((material: any) => material._id) } },
      getMaterialFilter(req),
    )).lean()
    
    res.json({ success: true, data: visibleMaterials })
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
    const material = await Material.findOne(combineFilters({ _id: req.params.id }, getMaterialFilter(req))).lean()
    if (!material) {
      return res.status(404).json({ success: false, error: '素材不存在或无权访问' })
    }
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
    if (!isSuperAdmin(req)) {
      return res.status(403).json({ success: false, error: '只有超级管理员可以触发全局素材归因' })
    }
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

    const material = await Material.findOne(combineFilters({ _id: materialId }, getMaterialFilter(req))).lean()
    if (!material) {
      return res.status(404).json({ success: false, error: '素材不存在或无权访问' })
    }
    const materialOrganizationId = idString((material as any).organizationId) || req.user?.organizationId
    const scopeError = await validateMappingAssetScope(
      req,
      { adId, accountId, campaignId },
      materialOrganizationId,
    )
    if (scopeError) {
      return res.status(403).json({ success: false, error: scopeError })
    }
    
    const success = await recordAdMaterialMapping({
      adId,
      materialId,
      organizationId: materialOrganizationId,
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

    const materialIds = mappings.map((mapping: any) => mapping.materialId).filter(Boolean)
    const visibleMaterials = await Material.find(combineFilters(
      { _id: { $in: materialIds } },
      getMaterialFilter(req),
    )).select('_id organizationId').lean()
    const visibleMaterialIds = new Set(visibleMaterials.map((material: any) => material._id.toString()))
    const materialOrgById = new Map(
      visibleMaterials.map((material: any) => [
        material._id.toString(),
        idString(material.organizationId) || req.user?.organizationId,
      ]),
    )
    const candidateMappings = mappings
      .filter((mapping: any) => visibleMaterialIds.has(String(mapping.materialId)))
      .map((mapping: any) => {
        const organizationId = materialOrgById.get(String(mapping.materialId))
        return {
          ...mapping,
          organizationId,
        }
      })

    const scopedMappings: any[] = []
    for (const mapping of candidateMappings) {
      const scopeError = await validateMappingAssetScope(req, mapping, mapping.organizationId)
      if (!scopeError) {
        scopedMappings.push(mapping)
      }
    }
    const filteredCount = mappings.length - scopedMappings.length

    const result = await recordAdMaterialMappings(scopedMappings)
    
    res.json({
      success: true,
      data: result,
      filteredMappingCount: filteredCount,
      message: `批量记录完成：成功 ${result.success} 条，失败 ${result.failed} 条`,
    })
  } catch (error: any) {
    logger.error('[Material] Record ad mappings batch failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}
