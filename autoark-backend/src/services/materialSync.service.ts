/**
 * 素材同步服务
 * 
 * 从 Facebook 同步素材到本地，建立素材指纹归因系统
 * 
 * 核心流程：
 * 1. 从 Facebook API 获取 Creatives（含 imageHash / videoId / thumbnailUrl）
 * 2. 下载素材到 R2 存储
 * 3. 创建 Material 记录，设置 fingerprint
 * 4. 关联 Creative → Material
 */

import axios from 'axios'
import Creative from '../models/Creative'
import Material from '../models/Material'
import { uploadToR2 } from './r2Storage.service'
import logger from '../utils/logger'

/**
 * 生成素材指纹
 * 规则：
 * - 图片：img_{imageHash}
 * - 视频：vid_{videoId}
 * - 无法识别：cre_{creativeId}
 */
export const generateFingerprint = (creative: any): string => {
  if (creative.imageHash) {
    return `img_${creative.imageHash}`
  }
  if (creative.videoId) {
    return `vid_${creative.videoId}`
  }
  // 回退到 creativeId
  return `cre_${creative.creativeId || creative.id}`
}

/**
 * 从 URL 下载文件到 Buffer
 */
const downloadFile = async (url: string): Promise<{ buffer: Buffer; mimeType: string } | null> => {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000, // 30秒超时
      headers: {
        'User-Agent': 'AutoArk/1.0',
      },
    })
    
    const mimeType = response.headers['content-type'] || 'image/jpeg'
    return {
      buffer: Buffer.from(response.data),
      mimeType,
    }
  } catch (error: any) {
    logger.error(`[MaterialSync] Failed to download: ${url}`, error.message)
    return null
  }
}

/**
 * 获取素材的预览图 URL
 */
const getPreviewUrl = (creative: any): string | null => {
  // 优先使用 thumbnailUrl
  if (creative.thumbnailUrl) return creative.thumbnailUrl
  
  // 图片素材使用 imageUrl
  if (creative.imageUrl) return creative.imageUrl
  
  // 从 raw 数据中提取
  if (creative.raw) {
    const oss = creative.raw.object_story_spec
    if (oss) {
      if (oss.video_data?.image_url) return oss.video_data.image_url
      if (oss.video_data?.thumbnail_url) return oss.video_data.thumbnail_url
      if (oss.link_data?.picture) return oss.link_data.picture
      if (oss.link_data?.image_hash) return null // 需要单独处理
    }
    // 直接访问 thumbnail_url
    if (creative.raw.thumbnail_url) return creative.raw.thumbnail_url
    if (creative.raw.image_url) return creative.raw.image_url
  }
  
  return null
}

/**
 * 同步单个 Creative 到 Material
 */
export const syncCreativeToMaterial = async (creative: any): Promise<{
  success: boolean
  materialId?: string
  fingerprint?: string
  error?: string
  skipped?: boolean
}> => {
  try {
    const fingerprint = generateFingerprint(creative)
    
    // 检查是否已存在（使用 fingerprintKey）
    const existingMaterial = await Material.findOne({ fingerprintKey: fingerprint })
    if (existingMaterial) {
      // 已存在，更新 Creative 的 materialId
      await Creative.findOneAndUpdate(
        { creativeId: creative.creativeId || creative.id },
        { materialId: existingMaterial._id }
      )
      return { 
        success: true, 
        materialId: existingMaterial._id.toString(), 
        fingerprint,
        skipped: true 
      }
    }
    
    // 获取预览图 URL
    const previewUrl = getPreviewUrl(creative)
    if (!previewUrl) {
      logger.warn(`[MaterialSync] No preview URL for creative ${creative.creativeId}`)
      return { success: false, error: 'No preview URL available', fingerprint }
    }
    
    // 下载文件
    const downloaded = await downloadFile(previewUrl)
    if (!downloaded) {
      return { success: false, error: 'Download failed', fingerprint }
    }
    
    // 确定文件类型
    const isVideo = creative.type === 'video' || creative.videoId
    const ext = downloaded.mimeType.includes('video') ? '.mp4' : 
                downloaded.mimeType.includes('png') ? '.png' : '.jpg'
    const fileName = `${fingerprint}${ext}`
    
    // 上传到 R2
    const uploadResult = await uploadToR2({
      buffer: downloaded.buffer,
      originalName: fileName,
      mimeType: downloaded.mimeType,
      folder: 'fb-materials', // 专门的 Facebook 素材文件夹
    })
    
    if (!uploadResult.success) {
      return { success: false, error: uploadResult.error, fingerprint }
    }
    
    // 创建 Material 记录
    const material = new Material({
      name: creative.name || `FB素材_${fingerprint.substring(0, 12)}`,
      type: isVideo ? 'video' : 'image',
      status: 'uploaded',
      fingerprint,
      source: {
        type: 'facebook',
        fbCreativeId: creative.creativeId || creative.id,
        fbAccountId: creative.accountId,
        importedAt: new Date(),
      },
      storage: {
        provider: 'r2',
        bucket: process.env.R2_BUCKET_NAME,
        key: uploadResult.key,
        url: uploadResult.url,
      },
      file: {
        originalName: fileName,
        mimeType: downloaded.mimeType,
        size: downloaded.buffer.length,
        width: creative.width,
        height: creative.height,
        duration: creative.duration,
      },
      facebook: {
        imageHash: creative.imageHash,
        videoId: creative.videoId,
      },
      folder: 'Facebook导入',
      tags: ['facebook', 'auto-import'],
    })
    
    await material.save()
    
    // 更新 Creative 的 materialId
    await Creative.findOneAndUpdate(
      { creativeId: creative.creativeId || creative.id },
      { materialId: material._id }
    )
    
    logger.info(`[MaterialSync] Synced creative ${creative.creativeId} → material ${material._id}`)
    
    return {
      success: true,
      materialId: material._id.toString(),
      fingerprint,
    }
  } catch (error: any) {
    logger.error(`[MaterialSync] Error syncing creative:`, error)
    return { success: false, error: error.message }
  }
}

/**
 * 批量同步 Creatives 到 Materials
 */
export const syncCreativesToMaterials = async (options?: {
  limit?: number
  accountId?: string
  onlyMissing?: boolean // 只同步没有 materialId 的
}): Promise<{
  total: number
  synced: number
  skipped: number
  failed: number
  errors: string[]
}> => {
  const { limit = 100, accountId, onlyMissing = true } = options || {}
  
  const query: any = {}
  if (accountId) query.accountId = accountId
  if (onlyMissing) query.materialId = { $exists: false }
  
  // 只处理有素材标识的
  query.$or = [
    { imageHash: { $exists: true, $ne: null } },
    { videoId: { $exists: true, $ne: null } },
    { thumbnailUrl: { $exists: true, $ne: null } },
  ]
  
  const creatives = await Creative.find(query).limit(limit).lean()
  
  logger.info(`[MaterialSync] Starting sync for ${creatives.length} creatives`)
  
  const stats = { total: creatives.length, synced: 0, skipped: 0, failed: 0, errors: [] as string[] }
  
  for (const creative of creatives) {
    const result = await syncCreativeToMaterial(creative)
    if (result.success) {
      if (result.skipped) {
        stats.skipped++
      } else {
        stats.synced++
      }
    } else {
      stats.failed++
      if (result.error) {
        stats.errors.push(`${creative.creativeId}: ${result.error}`)
      }
    }
  }
  
  logger.info(`[MaterialSync] Sync complete: ${JSON.stringify(stats)}`)
  
  return stats
}

/**
 * 获取 Material 的预览信息（用于前端展示）
 * 通过 fingerprintKey 快速查找
 */
export const getMaterialPreviewByFingerprint = async (fingerprint: string): Promise<{
  materialId?: string
  name?: string
  thumbnailUrl?: string
  type?: string
} | null> => {
  const material = await Material.findOne({ fingerprintKey: fingerprint }).lean()
  if (!material) return null
  
  return {
    materialId: (material._id as any).toString(),
    name: (material as any).name,
    thumbnailUrl: (material as any).storage?.url,
    type: (material as any).type,
  }
}

/**
 * 批量获取 Materials 预览信息
 */
export const getMaterialPreviewsByFingerprints = async (fingerprints: string[]): Promise<Map<string, {
  materialId: string
  name: string
  thumbnailUrl: string
  type: string
}>> => {
  const materials = await Material.find({ 
    fingerprintKey: { $in: fingerprints } 
  }).lean()
  
  const map = new Map()
  for (const m of materials) {
    const material = m as any
    if (material.fingerprintKey) {
      map.set(material.fingerprintKey, {
        materialId: material._id.toString(),
        name: material.name,
        thumbnailUrl: material.storage?.url,
        type: material.type,
      })
    }
  }
  
  return map
}

export default {
  generateFingerprint,
  syncCreativeToMaterial,
  syncCreativesToMaterials,
  getMaterialPreviewByFingerprint,
  getMaterialPreviewsByFingerprints,
}

