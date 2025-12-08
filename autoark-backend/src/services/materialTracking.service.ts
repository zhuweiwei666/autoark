import crypto from 'crypto'
import sharp from 'sharp'
import logger from '../utils/logger'
import Material from '../models/Material'
import MaterialMetrics from '../models/MaterialMetrics'
import AdMaterialMapping from '../models/AdMaterialMapping'

/**
 * 素材追踪服务
 * 
 * 核心功能：
 * 1. 素材指纹计算（上传时）
 * 2. 去重检测
 * 3. Facebook 映射管理
 * 4. 数据归因聚合
 */

// ==================== 指纹计算 ====================

/**
 * 计算感知哈希（pHash）- 抗压缩、抗缩放
 * 适用于图片素材的相似度匹配
 */
async function calculatePHash(imageBuffer: Buffer): Promise<string> {
  try {
    // 1. 缩放到 32x32 灰度图
    const resizedBuffer = await sharp(imageBuffer)
      .resize(32, 32, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer()
    
    // 2. 计算 8x8 的平均值块
    const blockSize = 4
    const blocks: number[] = []
    
    for (let blockY = 0; blockY < 8; blockY++) {
      for (let blockX = 0; blockX < 8; blockX++) {
        let sum = 0
        for (let y = 0; y < blockSize; y++) {
          for (let x = 0; x < blockSize; x++) {
            const pixelIndex = (blockY * blockSize + y) * 32 + (blockX * blockSize + x)
            sum += resizedBuffer[pixelIndex] || 0
          }
        }
        blocks.push(sum / (blockSize * blockSize))
      }
    }
    
    // 3. 计算均值并生成二进制哈希
    const avg = blocks.reduce((a, b) => a + b, 0) / blocks.length
    let hash = ''
    for (const block of blocks) {
      hash += block >= avg ? '1' : '0'
    }
    
    // 4. 转换为十六进制
    return parseInt(hash, 2).toString(16).padStart(16, '0')
  } catch (error: any) {
    logger.error('[MaterialTracking] pHash calculation failed:', error.message)
    return ''
  }
}

/**
 * 计算文件指纹
 */
export async function calculateFingerprint(
  buffer: Buffer,
  type: 'image' | 'video'
): Promise<{
  pHash?: string
  md5: string
  sha256: string
  videoHash?: string
  fingerprintKey: string
}> {
  const md5 = crypto.createHash('md5').update(buffer).digest('hex')
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
  
  let pHash: string | undefined
  let videoHash: string | undefined
  
  if (type === 'image') {
    pHash = await calculatePHash(buffer)
  } else {
    // 视频：使用前 1MB 内容的 hash 作为标识
    const sampleBuffer = buffer.slice(0, Math.min(buffer.length, 1024 * 1024))
    videoHash = crypto.createHash('md5').update(sampleBuffer).digest('hex')
  }
  
  // 组合指纹 key（用于唯一索引）
  const fingerprintKey = type === 'image' 
    ? `img_${pHash || md5}`
    : `vid_${videoHash || md5}`
  
  return { pHash, md5, sha256, videoHash, fingerprintKey }
}

// ==================== 去重检测 ====================

/**
 * 检查素材是否已存在（基于指纹）
 */
export async function checkDuplicate(
  fingerprint: { pHash?: string; md5?: string; videoHash?: string },
  type: 'image' | 'video'
): Promise<{ isDuplicate: boolean; existingMaterial?: any }> {
  const query: any = { type }
  
  if (type === 'image' && fingerprint.pHash) {
    // 图片：优先用 pHash 匹配
    query['fingerprint.pHash'] = fingerprint.pHash
  } else if (fingerprint.md5) {
    // 精确匹配 MD5
    query['fingerprint.md5'] = fingerprint.md5
  } else if (type === 'video' && fingerprint.videoHash) {
    query['fingerprint.videoHash'] = fingerprint.videoHash
  }
  
  const existingMaterial = await Material.findOne(query).lean()
  
  return {
    isDuplicate: !!existingMaterial,
    existingMaterial,
  }
}

// ==================== Facebook 映射管理 ====================

/**
 * 记录素材上传到 Facebook 的映射关系
 * 当素材被上传到某个 Facebook 账户时调用
 */
export async function recordFacebookMapping(
  materialId: string,
  accountId: string,
  mapping: { imageHash?: string; videoId?: string }
): Promise<boolean> {
  try {
    const material = await Material.findById(materialId)
    if (!material) {
      logger.error(`[MaterialTracking] Material not found: ${materialId}`)
      return false
    }
    
    // 检查是否已有该账户的映射
    const mappings = material.facebookMappings || []
    const existingMapping = mappings.find(
      (m: any) => m.accountId === accountId
    )
    
    if (existingMapping) {
      // 更新现有映射
      existingMapping.imageHash = mapping.imageHash || existingMapping.imageHash
      existingMapping.videoId = mapping.videoId || existingMapping.videoId
      existingMapping.uploadedAt = new Date()
      existingMapping.status = 'uploaded'
    } else {
      // 添加新映射
      mappings.push({
        accountId,
        imageHash: mapping.imageHash,
        videoId: mapping.videoId,
        uploadedAt: new Date(),
        status: 'uploaded',
      } as any)
      material.facebookMappings = mappings as any
    }
    
    // 同时更新旧的 facebook 字段（兼容）
    if (!material.facebook) {
      material.facebook = {}
    }
    if (mapping.imageHash) material.facebook.imageHash = mapping.imageHash
    if (mapping.videoId) material.facebook.videoId = mapping.videoId
    material.facebook.uploadedAt = new Date()
    
    await material.save()
    
    logger.info(`[MaterialTracking] Recorded FB mapping: Material ${materialId} -> Account ${accountId} (hash: ${mapping.imageHash || mapping.videoId})`)
    
    return true
  } catch (error: any) {
    logger.error(`[MaterialTracking] Failed to record FB mapping:`, error)
    return false
  }
}

/**
 * 根据 Facebook 素材标识找到对应的素材库素材
 */
export async function findMaterialByFacebookId(
  identifier: { imageHash?: string; videoId?: string }
): Promise<any | null> {
  const query: any = { $or: [] }
  
  if (identifier.imageHash) {
    query.$or.push({ 'facebook.imageHash': identifier.imageHash })
    query.$or.push({ 'facebookMappings.imageHash': identifier.imageHash })
  }
  
  if (identifier.videoId) {
    query.$or.push({ 'facebook.videoId': identifier.videoId })
    query.$or.push({ 'facebookMappings.videoId': identifier.videoId })
  }
  
  if (query.$or.length === 0) return null
  
  return Material.findOne(query).lean()
}

// ==================== 精准归因（通过 adId）====================

/**
 * 记录广告-素材映射（发布广告时调用）
 * 这是精准归因的核心！
 * 
 * @param data - 映射数据
 * @returns 是否成功
 */
export async function recordAdMaterialMapping(data: {
  adId: string
  materialId: string
  accountId?: string
  campaignId?: string
  adsetId?: string
  creativeId?: string
  materialType?: 'image' | 'video'
  materialName?: string
  materialUrl?: string
  fbImageHash?: string
  fbVideoId?: string
  publishedBy?: string
  taskId?: string
}): Promise<boolean> {
  try {
    if (!data.adId || !data.materialId) {
      logger.error('[MaterialTracking] recordAdMaterialMapping: missing adId or materialId')
      return false
    }
    
    await (AdMaterialMapping as any).recordMapping(data)
    
    logger.info(`[MaterialTracking] Recorded ad-material mapping: Ad ${data.adId} -> Material ${data.materialId}`)
    
    // 同时更新素材的使用统计
    await Material.findByIdAndUpdate(data.materialId, {
      $inc: { 'usage.totalAds': 1 },
      $addToSet: {
        'usage.accounts': data.accountId,
        'usage.optimizers': data.publishedBy,
      },
      $set: { 'usage.lastUsedAt': new Date() },
    })
    
    return true
  } catch (error: any) {
    logger.error('[MaterialTracking] Failed to record ad-material mapping:', error)
    return false
  }
}

/**
 * 批量记录广告-素材映射
 */
export async function recordAdMaterialMappings(
  mappings: Array<{
    adId: string
    materialId: string
    accountId?: string
    campaignId?: string
    adsetId?: string
    creativeId?: string
    publishedBy?: string
  }>
): Promise<{ success: number; failed: number }> {
  let success = 0
  let failed = 0
  
  for (const mapping of mappings) {
    const result = await recordAdMaterialMapping(mapping)
    if (result) success++
    else failed++
  }
  
  return { success, failed }
}

/**
 * 根据 adId 获取素材 ID（精准归因）
 */
export async function getMaterialIdByAdId(adId: string): Promise<string | null> {
  return (AdMaterialMapping as any).getMaterialId(adId)
}

/**
 * 批量根据 adIds 获取素材 IDs
 */
export async function getMaterialIdsByAdIds(adIds: string[]): Promise<Map<string, string>> {
  return (AdMaterialMapping as any).getMaterialIds(adIds)
}

// ==================== 数据归因 ====================

/**
 * 将 Facebook 指标数据归因到素材库
 * 每日运行，聚合 MetricsDaily 数据到 Material
 * 
 * 归因优先级：
 * 1. 通过 AdMaterialMapping 表精准匹配（最可靠）
 * 2. 通过 MaterialMetrics.materialId 匹配
 * 3. 通过 Facebook imageHash/videoId 反查（兜底）
 */
export async function aggregateMetricsToMaterials(date: string): Promise<{
  processed: number
  matched: number
  matchedByAdMapping: number
  matchedByFbId: number
  unmatched: number
}> {
  logger.info(`[MaterialTracking] Aggregating metrics to materials for ${date}`)
  
  const stats = { 
    processed: 0, 
    matched: 0, 
    matchedByAdMapping: 0, 
    matchedByFbId: 0, 
    unmatched: 0 
  }
  
  try {
    // 1. 获取当日 ad 级别的指标（用于精准归因）
    const MetricsDaily = (await import('../models/MetricsDaily')).default
    const adMetrics = await MetricsDaily.find({
      date,
      adId: { $exists: true, $ne: null },
    }).lean()
    
    logger.info(`[MaterialTracking] Found ${adMetrics.length} ad metrics for ${date}`)
    
    // 2. 批量获取 adId → materialId 映射
    const adIds = adMetrics.map((m: any) => m.adId).filter(Boolean)
    const adMaterialMap = await getMaterialIdsByAdIds(adIds)
    logger.info(`[MaterialTracking] Found ${adMaterialMap.size} ad-material mappings`)
    
    // 3. 按素材聚合
    const materialAggregation = new Map<string, {
      materialId: string
      spend: number
      revenue: number
      impressions: number
      clicks: number
      installs: number
      purchases: number
    }>()
    
    for (const metric of adMetrics) {
      stats.processed++
      const m = metric as any
      
      let materialId: string | null = null
      
      // 方式1：通过 AdMaterialMapping 精准匹配（优先）
      if (m.adId && adMaterialMap.has(m.adId)) {
        materialId = adMaterialMap.get(m.adId)!
        stats.matchedByAdMapping++
      }
      
      // 方式2：通过 Facebook 标识反查（兜底）
      if (!materialId && (m.raw?.image_hash || m.raw?.video_id)) {
        const material = await findMaterialByFacebookId({
          imageHash: m.raw?.image_hash,
          videoId: m.raw?.video_id,
        })
        if (material) {
          materialId = material._id.toString()
          stats.matchedByFbId++
        }
      }
      
      if (!materialId) {
        stats.unmatched++
        continue
      }
      
      stats.matched++
      
      if (!materialAggregation.has(materialId)) {
        materialAggregation.set(materialId, {
          materialId,
          spend: 0,
          revenue: 0,
          impressions: 0,
          clicks: 0,
          installs: 0,
          purchases: 0,
        })
      }
      
      const agg = materialAggregation.get(materialId)!
      agg.spend += m.spendUsd || 0
      agg.revenue += m.purchase_value || 0
      agg.impressions += m.impressions || 0
      agg.clicks += m.clicks || 0
      agg.installs += m.raw?.actions?.find((a: any) => a.action_type === 'mobile_app_install')?.value || 0
      agg.purchases += m.raw?.actions?.find((a: any) => a.action_type === 'purchase')?.value || 0
    }
    
    logger.info(`[MaterialTracking] Aggregated ${materialAggregation.size} materials`)
    
    // 4. 更新 Material 表的累计指标
    for (const [materialId, agg] of materialAggregation) {
      try {
        const material = await Material.findById(materialId)
        if (!material) continue
        
        // 初始化 metrics
        if (!material.metrics) {
          material.metrics = {
            totalSpend: 0,
            totalRevenue: 0,
            totalImpressions: 0,
            totalClicks: 0,
            totalInstalls: 0,
            totalPurchases: 0,
            avgRoas: 0,
            avgCtr: 0,
            avgCpi: 0,
            qualityScore: 50,
            activeDays: 0,
          }
        }
        
        // 累加指标
        material.metrics.totalSpend = (material.metrics.totalSpend || 0) + agg.spend
        material.metrics.totalRevenue = (material.metrics.totalRevenue || 0) + agg.revenue
        material.metrics.totalImpressions = (material.metrics.totalImpressions || 0) + agg.impressions
        material.metrics.totalClicks = (material.metrics.totalClicks || 0) + agg.clicks
        material.metrics.totalInstalls = (material.metrics.totalInstalls || 0) + agg.installs
        material.metrics.totalPurchases = (material.metrics.totalPurchases || 0) + agg.purchases
        
        // 计算平均值
        if (material.metrics.totalSpend > 0) {
          material.metrics.avgRoas = material.metrics.totalRevenue / material.metrics.totalSpend
        }
        if (material.metrics.totalImpressions > 0) {
          material.metrics.avgCtr = (material.metrics.totalClicks / material.metrics.totalImpressions) * 100
        }
        if (material.metrics.totalInstalls > 0) {
          material.metrics.avgCpi = material.metrics.totalSpend / material.metrics.totalInstalls
        }
        
        // 更新活跃天数
        if (agg.spend > 0) {
          material.metrics.activeDays = (material.metrics.activeDays || 0) + 1
          material.metrics.lastActiveDate = date
          if (!material.metrics.firstUsedDate) {
            material.metrics.firstUsedDate = date
          }
        }
        
        // 计算质量评分
        material.metrics.qualityScore = calculateQualityScore(material.metrics)
        material.metrics.updatedAt = new Date()
        
        await material.save()
        
      } catch (err: any) {
        logger.error(`[MaterialTracking] Failed to update material ${materialId}:`, err.message)
      }
    }
    
    logger.info(`[MaterialTracking] Aggregation complete: ${JSON.stringify(stats)}`)
    return stats
    
  } catch (error: any) {
    logger.error(`[MaterialTracking] Aggregation failed:`, error)
    throw error
  }
}

/**
 * 计算素材质量评分
 */
function calculateQualityScore(metrics: any): number {
  let score = 50
  
  const roas = metrics.avgRoas || 0
  const ctr = metrics.avgCtr || 0
  const spend = metrics.totalSpend || 0
  
  // ROAS 评分（最高 30 分）
  if (roas >= 3) score += 30
  else if (roas >= 2) score += 25
  else if (roas >= 1.5) score += 20
  else if (roas >= 1) score += 10
  else if (roas > 0 && roas < 0.5) score -= 10
  
  // CTR 评分（最高 10 分）
  if (ctr >= 2) score += 10
  else if (ctr >= 1) score += 5
  else if (ctr > 0 && ctr < 0.3) score -= 5
  
  // 消耗规模加分（最高 10 分）
  if (spend >= 1000) score += 10
  else if (spend >= 500) score += 5
  else if (spend >= 100) score += 2
  
  return Math.max(0, Math.min(100, score))
}

// ==================== 素材库查询 ====================

/**
 * 获取高质量可复用素材（供 AI Agent 使用）
 */
export async function getReusableMaterials(options: {
  type?: 'image' | 'video'
  minRoas?: number
  minSpend?: number
  minQualityScore?: number
  limit?: number
  sortBy?: 'roas' | 'spend' | 'qualityScore'
}): Promise<any[]> {
  const {
    type,
    minRoas = 1,
    minSpend = 50,
    minQualityScore = 60,
    limit = 20,
    sortBy = 'qualityScore'
  } = options
  
  const query: any = {
    status: 'uploaded',
    'metrics.totalSpend': { $gte: minSpend },
    'metrics.avgRoas': { $gte: minRoas },
    'metrics.qualityScore': { $gte: minQualityScore },
  }
  
  if (type) query.type = type
  
  const sortField = sortBy === 'roas' 
    ? 'metrics.avgRoas'
    : sortBy === 'spend'
    ? 'metrics.totalSpend'
    : 'metrics.qualityScore'
  
  return Material.find(query)
    .sort({ [sortField]: -1 })
    .limit(limit)
    .lean()
}

/**
 * 获取素材的完整数据（含历史趋势）
 */
export async function getMaterialFullData(materialId: string): Promise<{
  material: any
  dailyMetrics: any[]
  facebookCreatives: any[]
}> {
  const material = await Material.findById(materialId).lean()
  if (!material) throw new Error('Material not found')
  
  // 获取历史指标
  const dailyMetrics = await MaterialMetrics.find({ materialId })
    .sort({ date: -1 })
    .limit(30)
    .lean()
  
  // 获取关联的 Facebook Creatives
  const Creative = (await import('../models/Creative')).default
  const facebookCreatives = await Creative.find({ materialId }).lean()
  
  return { material, dailyMetrics, facebookCreatives }
}

export default {
  calculateFingerprint,
  checkDuplicate,
  recordFacebookMapping,
  findMaterialByFacebookId,
  aggregateMetricsToMaterials,
  getReusableMaterials,
  getMaterialFullData,
}

