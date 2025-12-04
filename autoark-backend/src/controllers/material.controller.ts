import { Request, Response } from 'express'
import Material from '../models/Material'
import { uploadToR2, deleteFromR2, checkR2Config } from '../services/r2Storage.service'
import logger from '../utils/logger'

/**
 * 素材管理控制器
 */

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
 * 上传素材
 * POST /api/materials/upload
 */
export const uploadMaterial = async (req: Request, res: Response) => {
  try {
    const file = (req as any).file
    if (!file) {
      return res.status(400).json({ success: false, error: '请选择要上传的文件' })
    }
    
    const { folder, tags, notes } = req.body
    
    // 判断文件类型
    const isImage = file.mimetype.startsWith('image/')
    const isVideo = file.mimetype.startsWith('video/')
    
    if (!isImage && !isVideo) {
      return res.status(400).json({ success: false, error: '只支持图片和视频文件' })
    }
    
    // 上传到 R2
    const uploadResult = await uploadToR2({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      folder: folder || 'materials',
    })
    
    if (!uploadResult.success) {
      return res.status(500).json({ success: false, error: uploadResult.error || '上传失败' })
    }
    
    // 创建素材记录
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
      notes,
    })
    
    await material.save()
    logger.info(`[Material] Uploaded: ${material._id} - ${material.name}`)
    
    res.json({ success: true, data: material })
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
    
    const filter: any = { status }
    
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
 * 重命名文件夹
 * POST /api/materials/rename-folder
 */
export const renameFolder = async (req: Request, res: Response) => {
  try {
    const { oldName, newName } = req.body
    
    if (!oldName || !newName) {
      return res.status(400).json({ success: false, error: '请提供文件夹名称' })
    }
    
    // 更新所有该文件夹下的素材
    const result = await Material.updateMany(
      { folder: oldName, status: 'uploaded' },
      { folder: newName }
    )
    
    logger.info(`[Material] Renamed folder: ${oldName} -> ${newName}, ${result.modifiedCount} items updated`)
    res.json({ success: true, data: { modifiedCount: result.modifiedCount } })
  } catch (error: any) {
    logger.error('[Material] Rename folder failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 删除文件夹（素材移至默认文件夹）
 * POST /api/materials/delete-folder
 */
export const deleteFolder = async (req: Request, res: Response) => {
  try {
    const { folderName } = req.body
    
    if (!folderName) {
      return res.status(400).json({ success: false, error: '请提供文件夹名称' })
    }
    
    // 将该文件夹下的素材移至默认文件夹
    const result = await Material.updateMany(
      { folder: folderName, status: 'uploaded' },
      { folder: '默认' }
    )
    
    logger.info(`[Material] Deleted folder: ${folderName}, ${result.modifiedCount} items moved to default`)
    res.json({ success: true, data: { modifiedCount: result.modifiedCount } })
  } catch (error: any) {
    logger.error('[Material] Delete folder failed:', error)
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

