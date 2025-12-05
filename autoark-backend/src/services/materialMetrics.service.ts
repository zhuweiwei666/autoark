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

// 从广告的 raw 数据中提取素材信息
const extractCreativeInfo = (ad: any): { imageHash?: string; videoId?: string; thumbnailUrl?: string } => {
  const raw = ad.raw || {}
  const creative = raw.creative || {}
  
  // 尝试从不同位置提取
  let imageHash = creative.image_hash || creative.object_story_spec?.link_data?.image_hash
  let videoId = creative.video_id || creative.object_story_spec?.video_data?.video_id
  let thumbnailUrl = creative.thumbnail_url || creative.image_url
  
  // 也检查 object_story_spec
  if (!imageHash && !videoId) {
    const linkData = creative.object_story_spec?.link_data
    if (linkData) {
      imageHash = linkData.image_hash
      if (linkData.video_data) {
        videoId = linkData.video_data.video_id
      }
    }
  }
  
  return { imageHash, videoId, thumbnailUrl }
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
    
    // 2. 构建 adId -> 素材信息 的映射
    const adCreativeMap = new Map<string, { imageHash?: string; videoId?: string; thumbnailUrl?: string }>()
    for (const ad of ads) {
      const creativeInfo = extractCreativeInfo(ad)
      if (creativeInfo.imageHash || creativeInfo.videoId) {
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
    
    // 4. 按素材聚合指标
    const materialAggregation = new Map<string, any>()
    
    for (const metric of adMetrics) {
      const creativeInfo = adCreativeMap.get(metric.adId)
      if (!creativeInfo) continue
      
      // 使用 imageHash 或 videoId 作为 key
      const materialKey = creativeInfo.imageHash || creativeInfo.videoId
      if (!materialKey) continue
      
      stats.processed++
      
      // 提取 actions 数据
      const rawActions = metric.raw?.actions || []
      const rawActionValues = metric.raw?.action_values || []
      
      if (!materialAggregation.has(materialKey)) {
        materialAggregation.set(materialKey, {
          date,
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
        if (agg.imageHash) filter.imageHash = agg.imageHash
        else if (agg.videoId) filter.videoId = agg.videoId
        
        const result = await MaterialMetrics.findOneAndUpdate(
          filter,
          {
            date,
            materialId: materialDoc?._id,
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

export default {
  aggregateMaterialMetrics,
  getMaterialRankings,
  getMaterialTrend,
}

