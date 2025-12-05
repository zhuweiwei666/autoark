import dayjs from 'dayjs'
import logger from '../utils/logger'
import Ad from '../models/Ad'
import MetricsDaily from '../models/MetricsDaily'
import MaterialMetrics from '../models/MaterialMetrics'
import Material from '../models/Material'

/**
 * 素材指标聚合服务
 * 将广告级别的数据聚合到素材级别
 */

// 从广告数据中提取素材信息
// 优先使用 Ad 模型中存储的字段（同步时已提取），其次从 raw 数据中提取
const extractCreativeInfo = (ad: any): { creativeId?: string; imageHash?: string; videoId?: string; thumbnailUrl?: string } => {
  // 优先使用 Ad 模型中直接存储的字段
  let creativeId = ad.creativeId
  let imageHash = ad.imageHash
  let videoId = ad.videoId
  let thumbnailUrl = ad.thumbnailUrl
  
  // 如果没有，尝试从 raw 数据中提取
  if (!imageHash && !videoId) {
    const raw = ad.raw || {}
    const creative = raw.creative || {}
    
    if (!creativeId) creativeId = creative.id
    
    imageHash = creative.image_hash
    videoId = creative.video_id
    thumbnailUrl = thumbnailUrl || creative.thumbnail_url || creative.image_url
    
    // 从 object_story_spec 提取
    if (!imageHash && !videoId && creative.object_story_spec) {
      const spec = creative.object_story_spec
      imageHash = spec.link_data?.image_hash || spec.photo_data?.image_hash
      videoId = spec.video_data?.video_id || spec.link_data?.video_id
    }
  }
  
  return { creativeId, imageHash, videoId, thumbnailUrl }
}

// 从 action_values 提取购买值
const extractPurchaseValue = (actionValues: any[]): number => {
  if (!actionValues) return 0
  for (const av of actionValues) {
    if (av.action_type === 'purchase' || av.action_type === 'omni_purchase') {
      return parseFloat(av.value) || 0
    }
  }
  return 0
}

// 从 actions 提取特定 action 的数量
const getActionCount = (actions: any[], actionType: string): number => {
  if (!actions) return 0
  const action = actions.find((a: any) => a.action_type === actionType)
  return action ? parseInt(action.value, 10) : 0
}

// 从广告系列名称提取投手
const extractOptimizer = (campaignName: string): string => {
  if (!campaignName) return 'unknown'
  const parts = campaignName.split('_')
  return parts[0] || 'unknown'
}

/**
 * 聚合指定日期的素材级别指标
 */
export const aggregateMaterialMetrics = async (date: string): Promise<{ 
  processed: number
  created: number
  updated: number
  errors: number 
}> => {
  logger.info(`[MaterialMetrics] Aggregating material metrics for ${date}`)
  
  const stats = { processed: 0, created: 0, updated: 0, errors: 0 }
  
  try {
    // 1. 获取所有广告及其素材信息
    const ads = await Ad.find({}).lean()
    logger.info(`[MaterialMetrics] Found ${ads.length} ads to process`)
    
    // 2. 构建 adId -> 素材信息 的映射（使用 creativeId 作为主要标识）
    const adCreativeMap = new Map<string, { creativeId?: string; imageHash?: string; videoId?: string; thumbnailUrl?: string }>()
    for (const ad of ads) {
      const creativeInfo = extractCreativeInfo(ad)
      // 只要有 creativeId 就可以追踪
      if (creativeInfo.creativeId) {
        adCreativeMap.set(ad.adId, creativeInfo)
      }
    }
    logger.info(`[MaterialMetrics] Built creative map for ${adCreativeMap.size} ads with creatives`)
    
    // 3. 获取当天的 ad 级别指标
    const adMetrics = await MetricsDaily.find({
      date,
      adId: { $exists: true, $ne: null },
      spendUsd: { $gt: 0 }
    }).lean()
    logger.info(`[MaterialMetrics] Found ${adMetrics.length} ad metrics for ${date}`)
    
    // 4. 按素材聚合指标（使用 creativeId 作为 key）
    const materialAggregation = new Map<string, any>()
    
    for (const metric of adMetrics) {
      const creativeInfo = adCreativeMap.get(metric.adId)
      if (!creativeInfo || !creativeInfo.creativeId) continue
      
      // 使用 creativeId 作为 key（优先），或者 imageHash/videoId
      const materialKey = creativeInfo.creativeId
      
      stats.processed++
      
      // 提取 actions 数据
      const rawActions = metric.raw?.actions || []
      const rawActionValues = metric.raw?.action_values || []
      
      if (!materialAggregation.has(materialKey)) {
        materialAggregation.set(materialKey, {
          date,
          creativeId: creativeInfo.creativeId,
          imageHash: creativeInfo.imageHash,
          videoId: creativeInfo.videoId,
          thumbnailUrl: creativeInfo.thumbnailUrl,
          materialType: creativeInfo.videoId ? 'video' : 'image',
          
          accountIds: new Set(),
          campaignIds: new Set(),
          adsetIds: new Set(),
          adIds: new Set(),
          optimizers: new Set(),
          
          spend: 0,
          impressions: 0,
          clicks: 0,
          conversions: 0,
          installs: 0,
          purchases: 0,
          purchaseValue: 0,
          leads: 0,
          videoViews: 0,
          postEngagement: 0,
        })
      }
      
      const agg = materialAggregation.get(materialKey)
      
      // 聚合维度
      if (metric.accountId) agg.accountIds.add(metric.accountId)
      if (metric.campaignId) agg.campaignIds.add(metric.campaignId)
      if (metric.adsetId) agg.adsetIds.add(metric.adsetId)
      if (metric.adId) agg.adIds.add(metric.adId)
      // 从 raw 数据获取 campaign name，或者从 campaignId 推断投手
      const campaignName = (metric as any).campaignName || metric.raw?.campaign_name || ''
      if (campaignName) agg.optimizers.add(extractOptimizer(campaignName))
      
      // 聚合指标
      agg.spend += metric.spendUsd || 0
      agg.impressions += metric.impressions || 0
      agg.clicks += metric.clicks || 0
      agg.conversions += metric.conversions || 0
      
      // 从 raw 数据提取详细指标
      agg.installs += getActionCount(rawActions, 'mobile_app_install')
      agg.purchases += getActionCount(rawActions, 'purchase') || getActionCount(rawActions, 'omni_purchase')
      agg.leads += getActionCount(rawActions, 'lead')
      agg.videoViews += getActionCount(rawActions, 'video_view')
      agg.postEngagement += getActionCount(rawActions, 'post_engagement')
      
      // 购买价值
      const purchaseVal = metric.purchase_value || extractPurchaseValue(rawActionValues)
      agg.purchaseValue += purchaseVal
    }
    
    logger.info(`[MaterialMetrics] Aggregated ${materialAggregation.size} unique materials`)
    
    // 5. 保存到数据库
    for (const [materialKey, agg] of materialAggregation) {
      try {
        // 尝试匹配 Material 表
        let materialDoc = null
        if (agg.imageHash) {
          materialDoc = await Material.findOne({ 'facebook.imageHash': agg.imageHash }).lean()
        } else if (agg.videoId) {
          materialDoc = await Material.findOne({ 'facebook.videoId': agg.videoId }).lean()
        }
        
        // 计算派生指标
        const ctr = agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0
        const cpc = agg.clicks > 0 ? agg.spend / agg.clicks : 0
        const cpm = agg.impressions > 0 ? (agg.spend / agg.impressions) * 1000 : 0
        const cpi = agg.installs > 0 ? agg.spend / agg.installs : 0
        const roas = agg.spend > 0 ? agg.purchaseValue / agg.spend : 0
        
        // 计算质量评分
        let qualityScore = 50
        if (roas >= 3) qualityScore += 30
        else if (roas >= 2) qualityScore += 25
        else if (roas >= 1.5) qualityScore += 20
        else if (roas >= 1) qualityScore += 10
        else if (roas < 0.5) qualityScore -= 10
        
        if (ctr >= 2) qualityScore += 10
        else if (ctr >= 1) qualityScore += 5
        else if (ctr < 0.5) qualityScore -= 5
        
        qualityScore = Math.max(0, Math.min(100, qualityScore))
        
        const filter: any = { date }
        // 优先使用 creativeId，其次使用 imageHash/videoId
        if (agg.creativeId) filter.creativeId = agg.creativeId
        else if (agg.imageHash) filter.imageHash = agg.imageHash
        else if (agg.videoId) filter.videoId = agg.videoId
        
        const result = await MaterialMetrics.findOneAndUpdate(
          filter,
          {
            date,
            materialId: materialDoc?._id,
            creativeId: agg.creativeId,
            imageHash: agg.imageHash,
            videoId: agg.videoId,
            thumbnailUrl: agg.thumbnailUrl,
            materialType: agg.materialType,
            materialName: materialDoc?.name,
            
            accountIds: Array.from(agg.accountIds),
            campaignIds: Array.from(agg.campaignIds),
            adsetIds: Array.from(agg.adsetIds),
            adIds: Array.from(agg.adIds),
            optimizers: Array.from(agg.optimizers),
            
            spend: agg.spend,
            impressions: agg.impressions,
            clicks: agg.clicks,
            conversions: agg.conversions,
            installs: agg.installs,
            purchases: agg.purchases,
            purchaseValue: agg.purchaseValue,
            leads: agg.leads,
            videoViews: agg.videoViews,
            postEngagement: agg.postEngagement,
            
            ctr,
            cpc,
            cpm,
            cpi,
            roas,
            qualityScore,
            
            activeAdsCount: agg.adIds.size,
            totalAdsCount: agg.adIds.size,
          },
          { upsert: true, new: true }
        )
        
        if (result.createdAt === result.updatedAt) {
          stats.created++
        } else {
          stats.updated++
        }
      } catch (err) {
        logger.error(`[MaterialMetrics] Error saving material ${materialKey}:`, err)
        stats.errors++
      }
    }
    
    logger.info(`[MaterialMetrics] Aggregation complete: ${JSON.stringify(stats)}`)
    return stats
    
  } catch (error) {
    logger.error('[MaterialMetrics] Aggregation failed:', error)
    throw error
  }
}

/**
 * 获取素材排行榜
 */
export const getMaterialRankings = async (options: {
  dateRange: { start: string; end: string }
  sortBy?: 'roas' | 'spend' | 'qualityScore' | 'impressions'
  limit?: number
  materialType?: 'image' | 'video'
}) => {
  const { dateRange, sortBy = 'roas', limit = 20, materialType } = options
  
  const match: any = {
    date: { $gte: dateRange.start, $lte: dateRange.end },
    spend: { $gt: 5 }
  }
  if (materialType) match.materialType = materialType
  
  return MaterialMetrics.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $ifNull: ['$imageHash', '$videoId'] },
        materialId: { $first: '$materialId' },
        materialType: { $first: '$materialType' },
        materialName: { $first: '$materialName' },
        thumbnailUrl: { $first: '$thumbnailUrl' },
        imageHash: { $first: '$imageHash' },
        videoId: { $first: '$videoId' },
        
        totalSpend: { $sum: '$spend' },
        totalImpressions: { $sum: '$impressions' },
        totalClicks: { $sum: '$clicks' },
        totalPurchaseValue: { $sum: '$purchaseValue' },
        totalInstalls: { $sum: '$installs' },
        totalPurchases: { $sum: '$purchases' },
        avgQualityScore: { $avg: '$qualityScore' },
        
        daysActive: { $sum: 1 },
        allAdIds: { $push: '$adIds' },
        allCampaignIds: { $push: '$campaignIds' },
        allOptimizers: { $push: '$optimizers' },
      }
    },
    {
      $addFields: {
        roas: { $cond: [{ $gt: ['$totalSpend', 0] }, { $divide: ['$totalPurchaseValue', '$totalSpend'] }, 0] },
        ctr: { $cond: [{ $gt: ['$totalImpressions', 0] }, { $multiply: [{ $divide: ['$totalClicks', '$totalImpressions'] }, 100] }, 0] },
        cpi: { $cond: [{ $gt: ['$totalInstalls', 0] }, { $divide: ['$totalSpend', '$totalInstalls'] }, 0] },
      }
    },
    { $sort: { [sortBy === 'qualityScore' ? 'avgQualityScore' : sortBy === 'spend' ? 'totalSpend' : sortBy]: -1 } },
    { $limit: limit },
    {
      $project: {
        materialKey: '$_id',
        materialId: 1,
        materialType: 1,
        materialName: 1,
        thumbnailUrl: 1,
        imageHash: 1,
        videoId: 1,
        
        spend: { $round: ['$totalSpend', 2] },
        impressions: '$totalImpressions',
        clicks: '$totalClicks',
        purchaseValue: { $round: ['$totalPurchaseValue', 2] },
        installs: '$totalInstalls',
        purchases: '$totalPurchases',
        
        roas: { $round: ['$roas', 2] },
        ctr: { $round: ['$ctr', 2] },
        cpi: { $round: ['$cpi', 2] },
        qualityScore: { $round: ['$avgQualityScore', 0] },
        
        daysActive: 1,
        uniqueAdsCount: { 
          $size: { 
            $reduce: { 
              input: '$allAdIds', 
              initialValue: [], 
              in: { $setUnion: ['$$value', '$$this'] } 
            } 
          } 
        },
        uniqueCampaignsCount: { 
          $size: { 
            $reduce: { 
              input: '$allCampaignIds', 
              initialValue: [], 
              in: { $setUnion: ['$$value', '$$this'] } 
            } 
          } 
        },
        optimizers: { 
          $reduce: { 
            input: '$allOptimizers', 
            initialValue: [], 
            in: { $setUnion: ['$$value', '$$this'] } 
          } 
        },
      }
    }
  ])
}

/**
 * 获取素材历史趋势
 */
export const getMaterialTrend = async (
  materialKey: { imageHash?: string; videoId?: string },
  days: number = 7
) => {
  const endDate = dayjs().format('YYYY-MM-DD')
  const startDate = dayjs().subtract(days, 'day').format('YYYY-MM-DD')
  
  const match: any = {
    date: { $gte: startDate, $lte: endDate }
  }
  if (materialKey.imageHash) match.imageHash = materialKey.imageHash
  if (materialKey.videoId) match.videoId = materialKey.videoId
  
  return MaterialMetrics.find(match)
    .sort({ date: 1 })
    .select('date spend impressions clicks purchaseValue installs roas ctr qualityScore')
    .lean()
}

// ==================== 素材去重 ====================

/**
 * 识别重复素材
 * 基于 imageHash 或 thumbnailUrl 识别使用相同素材的创意
 */
export const findDuplicateMaterials = async () => {
  const Creative = require('../models/Creative').default
  
  // 按 imageHash 分组找重复
  const duplicatesByHash = await Creative.aggregate([
    {
      $match: {
        imageHash: { $exists: true, $ne: null }
      }
    },
    {
      $group: {
        _id: '$imageHash',
        count: { $sum: 1 },
        creativeIds: { $push: '$creativeId' },
        accounts: { $addToSet: '$accountId' },
        thumbnails: { $addToSet: '$thumbnailUrl' },
      }
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 50 }
  ])
  
  // 按 videoId 分组找重复
  const duplicatesByVideo = await Creative.aggregate([
    {
      $match: {
        videoId: { $exists: true, $ne: null }
      }
    },
    {
      $group: {
        _id: '$videoId',
        count: { $sum: 1 },
        creativeIds: { $push: '$creativeId' },
        accounts: { $addToSet: '$accountId' },
        thumbnails: { $addToSet: '$thumbnailUrl' },
      }
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 50 }
  ])
  
  return {
    byImageHash: duplicatesByHash.map((d: any) => ({
      imageHash: d._id,
      usageCount: d.count,
      creativeIds: d.creativeIds,
      accountsCount: d.accounts.length,
      thumbnail: d.thumbnails[0],
    })),
    byVideoId: duplicatesByVideo.map((d: any) => ({
      videoId: d._id,
      usageCount: d.count,
      creativeIds: d.creativeIds,
      accountsCount: d.accounts.length,
      thumbnail: d.thumbnails[0],
    })),
  }
}

/**
 * 获取某个素材的所有使用情况
 */
export const getMaterialUsage = async (params: { imageHash?: string; videoId?: string; creativeId?: string }) => {
  const Creative = require('../models/Creative').default
  const Ad = require('../models/Ad').default
  
  const match: any = {}
  if (params.imageHash) match.imageHash = params.imageHash
  if (params.videoId) match.videoId = params.videoId
  if (params.creativeId) match.creativeId = params.creativeId
  
  // 找到所有使用该素材的 Creative
  const creatives = await Creative.find(match).lean()
  const creativeIds = creatives.map((c: any) => c.creativeId)
  
  // 找到所有使用这些 Creative 的 Ad
  const ads = await Ad.find({ creativeId: { $in: creativeIds } })
    .select('adId name status campaignId adsetId accountId')
    .lean()
  
  // 获取这些广告的历史表现
  const adIds = ads.map((a: any) => a.adId)
  const metrics = await MaterialMetrics.aggregate([
    {
      $match: {
        adIds: { $elemMatch: { $in: adIds } }
      }
    },
    {
      $group: {
        _id: null,
        totalSpend: { $sum: '$spend' },
        totalRevenue: { $sum: '$purchaseValue' },
        totalImpressions: { $sum: '$impressions' },
        totalClicks: { $sum: '$clicks' },
        daysActive: { $sum: 1 },
      }
    }
  ])
  
  const performance = metrics[0] || { totalSpend: 0, totalRevenue: 0, totalImpressions: 0, totalClicks: 0, daysActive: 0 }
  
  return {
    material: {
      imageHash: params.imageHash,
      videoId: params.videoId,
      thumbnail: creatives[0]?.thumbnailUrl,
      type: creatives[0]?.type,
    },
    usage: {
      creativeCount: creatives.length,
      adCount: ads.length,
      accountCount: new Set(ads.map((a: any) => a.accountId)).size,
      campaignCount: new Set(ads.map((a: any) => a.campaignId)).size,
    },
    performance: {
      spend: Math.round(performance.totalSpend * 100) / 100,
      revenue: Math.round(performance.totalRevenue * 100) / 100,
      roas: performance.totalSpend > 0 ? Math.round((performance.totalRevenue / performance.totalSpend) * 100) / 100 : 0,
      impressions: performance.totalImpressions,
      clicks: performance.totalClicks,
      daysActive: performance.daysActive,
    },
    ads: ads.slice(0, 20), // 限制返回数量
  }
}

// ==================== 素材推荐 ====================

/**
 * 获取推荐素材
 * 基于历史表现数据，推荐高质量素材用于新广告
 */
export const getRecommendedMaterials = async (options: {
  type?: 'image' | 'video'
  minSpend?: number       // 最低消耗门槛（确保有足够数据）
  minRoas?: number        // 最低 ROAS 门槛
  minDays?: number        // 最少活跃天数
  excludeCreativeIds?: string[]  // 排除已使用的 creative
  limit?: number
} = {}) => {
  const {
    type,
    minSpend = 50,
    minRoas = 1.0,
    minDays = 3,
    excludeCreativeIds = [],
    limit = 20
  } = options
  
  const sevenDaysAgo = dayjs().subtract(7, 'day').format('YYYY-MM-DD')
  const today = dayjs().format('YYYY-MM-DD')
  
  const matchStage: any = {
    date: { $gte: sevenDaysAgo, $lte: today },
    spend: { $gt: 0 }
  }
  if (type) matchStage.materialType = type
  
  const recommendations = await MaterialMetrics.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: '$creativeId',
        imageHash: { $first: '$imageHash' },
        videoId: { $first: '$videoId' },
        thumbnailUrl: { $first: '$thumbnailUrl' },
        materialType: { $first: '$materialType' },
        
        totalSpend: { $sum: '$spend' },
        totalRevenue: { $sum: '$purchaseValue' },
        totalImpressions: { $sum: '$impressions' },
        totalClicks: { $sum: '$clicks' },
        totalInstalls: { $sum: '$installs' },
        avgQualityScore: { $avg: '$qualityScore' },
        daysActive: { $sum: 1 },
        
        optimizers: { $push: '$optimizers' },
        campaigns: { $push: '$campaignIds' },
      }
    },
    {
      $addFields: {
        roas: { $cond: [{ $gt: ['$totalSpend', 0] }, { $divide: ['$totalRevenue', '$totalSpend'] }, 0] },
        ctr: { $cond: [{ $gt: ['$totalImpressions', 0] }, { $multiply: [{ $divide: ['$totalClicks', '$totalImpressions'] }, 100] }, 0] },
      }
    },
    {
      $match: {
        totalSpend: { $gte: minSpend },
        roas: { $gte: minRoas },
        daysActive: { $gte: minDays },
        _id: { $nin: excludeCreativeIds }
      }
    },
    {
      $addFields: {
        // 综合推荐分：ROAS权重50% + 质量分权重30% + 活跃天数权重20%
        recommendScore: {
          $add: [
            { $multiply: [{ $min: ['$roas', 5] }, 10] }, // ROAS 最高贡献 50 分
            { $multiply: ['$avgQualityScore', 0.3] },    // 质量分贡献 30 分
            { $multiply: ['$daysActive', 2.86] }         // 7天活跃贡献 20 分
          ]
        }
      }
    },
    { $sort: { recommendScore: -1 } },
    { $limit: limit },
    {
      $project: {
        creativeId: '$_id',
        imageHash: 1,
        videoId: 1,
        thumbnailUrl: 1,
        materialType: 1,
        
        spend: { $round: ['$totalSpend', 2] },
        revenue: { $round: ['$totalRevenue', 2] },
        roas: { $round: ['$roas', 2] },
        ctr: { $round: ['$ctr', 2] },
        impressions: '$totalImpressions',
        clicks: '$totalClicks',
        installs: '$totalInstalls',
        
        qualityScore: { $round: ['$avgQualityScore', 0] },
        daysActive: 1,
        recommendScore: { $round: ['$recommendScore', 0] },
        
        // 使用该素材的投手（展开嵌套数组）
        usedByOptimizers: {
          $reduce: {
            input: '$optimizers',
            initialValue: [],
            in: { $setUnion: ['$$value', '$$this'] }
          }
        },
        // 使用的广告系列数
        campaignCount: {
          $size: {
            $reduce: {
              input: '$campaigns',
              initialValue: [],
              in: { $setUnion: ['$$value', '$$this'] }
            }
          }
        },
        
        // 推荐理由
        reason: {
          $concat: [
            'ROAS ', { $toString: { $round: ['$roas', 2] } },
            ', 消耗 $', { $toString: { $round: ['$totalSpend', 0] } },
            ', 活跃 ', { $toString: '$daysActive' }, ' 天'
          ]
        }
      }
    }
  ])
  
  return {
    recommendations,
    criteria: {
      minSpend,
      minRoas,
      minDays,
      dateRange: { from: sevenDaysAgo, to: today },
    },
    totalFound: recommendations.length,
  }
}

/**
 * 获取表现下滑的素材（预警）
 * 用于识别需要替换的素材
 */
export const getDecliningMaterials = async (options: {
  minSpend?: number
  declineThreshold?: number  // ROAS 下降百分比阈值
  limit?: number
} = {}) => {
  const { minSpend = 30, declineThreshold = 30, limit = 20 } = options
  
  const today = dayjs().format('YYYY-MM-DD')
  const threeDaysAgo = dayjs().subtract(3, 'day').format('YYYY-MM-DD')
  const sevenDaysAgo = dayjs().subtract(7, 'day').format('YYYY-MM-DD')
  
  // 获取最近3天和前4天的数据对比
  const recentData = await MaterialMetrics.aggregate([
    {
      $match: {
        date: { $gte: threeDaysAgo, $lte: today },
        spend: { $gt: 0 }
      }
    },
    {
      $group: {
        _id: '$creativeId',
        recentSpend: { $sum: '$spend' },
        recentRevenue: { $sum: '$purchaseValue' },
        thumbnailUrl: { $first: '$thumbnailUrl' },
        materialType: { $first: '$materialType' },
      }
    },
    {
      $addFields: {
        recentRoas: { $cond: [{ $gt: ['$recentSpend', 0] }, { $divide: ['$recentRevenue', '$recentSpend'] }, 0] }
      }
    }
  ])
  
  const olderData = await MaterialMetrics.aggregate([
    {
      $match: {
        date: { $gte: sevenDaysAgo, $lt: threeDaysAgo },
        spend: { $gt: 0 }
      }
    },
    {
      $group: {
        _id: '$creativeId',
        olderSpend: { $sum: '$spend' },
        olderRevenue: { $sum: '$purchaseValue' },
      }
    },
    {
      $addFields: {
        olderRoas: { $cond: [{ $gt: ['$olderSpend', 0] }, { $divide: ['$olderRevenue', '$olderSpend'] }, 0] }
      }
    }
  ])
  
  // 创建 olderData 的 map
  const olderMap = new Map(olderData.map((d: any) => [d._id, d]))
  
  // 计算下滑的素材
  const declining = recentData
    .map((recent: any) => {
      const older = olderMap.get(recent._id) as any
      if (!older || older.olderRoas === 0) return null
      
      const roasChange = ((recent.recentRoas - older.olderRoas) / older.olderRoas) * 100
      
      if (roasChange < -declineThreshold && recent.recentSpend >= minSpend) {
        return {
          creativeId: recent._id,
          thumbnailUrl: recent.thumbnailUrl,
          materialType: recent.materialType,
          recentRoas: Math.round(recent.recentRoas * 100) / 100,
          olderRoas: Math.round(older.olderRoas * 100) / 100,
          roasChange: Math.round(roasChange * 10) / 10,
          recentSpend: Math.round(recent.recentSpend * 100) / 100,
          warning: `ROAS 下降 ${Math.abs(Math.round(roasChange))}%`,
          suggestion: recent.recentRoas < 0.5 ? '建议暂停' : '建议观察',
        }
      }
      return null
    })
    .filter(Boolean)
    .sort((a: any, b: any) => a.roasChange - b.roasChange)
    .slice(0, limit)
  
  return {
    decliningMaterials: declining,
    threshold: {
      minSpend,
      declineThreshold: `${declineThreshold}%`,
      comparisonPeriod: '最近3天 vs 前4天',
    },
  }
}

export default {
  aggregateMaterialMetrics,
  getMaterialRankings,
  getMaterialTrend,
  findDuplicateMaterials,
  getMaterialUsage,
  getRecommendedMaterials,
  getDecliningMaterials,
}

