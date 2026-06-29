/**
 * 广告审核状态服务
 * 
 * 追踪 AutoArk 发布的广告在 Facebook 的审核状态
 * - PENDING_REVIEW: 审核中
 * - ACTIVE: 审核通过
 * - DISAPPROVED: 被拒绝
 */

import Ad from '../models/Ad'
import AdTask from '../models/AdTask'
import Campaign from '../models/Campaign'
import FbToken from '../models/FbToken'
import { facebookClient } from '../integration/facebook/facebookClient'
import logger from '../utils/logger'

// 审核状态映射（中文展示）
export const REVIEW_STATUS_MAP: Record<string, { label: string; color: string; icon: string }> = {
  PENDING_REVIEW: { label: '审核中', color: 'yellow', icon: '⏳' },
  ACTIVE: { label: '审核通过', color: 'green', icon: '✅' },
  DISAPPROVED: { label: '审核被拒', color: 'red', icon: '❌' },
  PAUSED: { label: '已暂停', color: 'gray', icon: '⏸️' },
  DELETED: { label: '已删除', color: 'gray', icon: '🗑️' },
  PREAPPROVED: { label: '预批准', color: 'blue', icon: '🔵' },
  CAMPAIGN_PAUSED: { label: '系列暂停', color: 'gray', icon: '⏸️' },
  ADSET_PAUSED: { label: '广告组暂停', color: 'gray', icon: '⏸️' },
  WITH_ISSUES: { label: '有问题', color: 'orange', icon: '⚠️' },
  IN_PROCESS: { label: '处理中', color: 'blue', icon: '🔄' },
}

// 被拒原因类型映射
export const REJECTION_REASON_MAP: Record<string, string> = {
  body_policy: '文案违规',
  image_policy: '图片违规',
  video_policy: '视频违规',
  landing_page_policy: '落地页违规',
  ad_library_policy: '广告库政策',
  placement_policy: '版位限制',
}

/**
 * 从 Facebook API 获取广告审核状态
 */
export async function fetchAdReviewStatus(
  adIds: string[],
  token: string
): Promise<Map<string, any>> {
  const results = new Map<string, any>()
  
  if (adIds.length === 0) return results
  
  try {
    // 批量查询（每次最多50个）
    const batchSize = 50
    for (let i = 0; i < adIds.length; i += batchSize) {
      const batch = adIds.slice(i, i + batchSize)
      
      // 使用 batch API 或逐个查询
      for (const adId of batch) {
        try {
          const response = await facebookClient.get(`/${adId}`, {
            access_token: token,
            fields: 'id,name,status,effective_status,ad_review_feedback,adset_id,campaign_id',
          })
          
          results.set(adId, {
            effectiveStatus: response.effective_status,
            status: response.status,
            reviewFeedback: response.ad_review_feedback,
            name: response.name,
            adsetId: response.adset_id,
            campaignId: response.campaign_id,
          })
        } catch (err: any) {
          logger.warn(`[AdReview] Failed to fetch status for ad ${adId}:`, err.message)
          // 如果是权限问题或广告不存在，记录错误状态
          results.set(adId, {
            effectiveStatus: 'UNKNOWN',
            error: err.message,
          })
        }
      }
    }
  } catch (error: any) {
    logger.error('[AdReview] Batch fetch failed:', error)
  }
  
  return results
}

/**
 * 批量获取 Campaign 名称
 */
async function fetchCampaignNames(
  campaignIds: string[],
  token: string
): Promise<Map<string, string>> {
  const results = new Map<string, string>()
  
  for (const campaignId of campaignIds) {
    try {
      const response = await facebookClient.get(`/${campaignId}`, {
        access_token: token,
        fields: 'id,name,status',
      })
      results.set(campaignId, response.name)
    } catch (err: any) {
      logger.warn(`[AdReview] Failed to fetch campaign ${campaignId}:`, err.message)
    }
  }
  
  return results
}

/**
 * 批量获取 AdSet 名称
 */
async function fetchAdSetNames(
  adsetIds: string[],
  token: string
): Promise<Map<string, string>> {
  const results = new Map<string, string>()
  
  for (const adsetId of adsetIds) {
    try {
      const response = await facebookClient.get(`/${adsetId}`, {
        access_token: token,
        fields: 'id,name',
      })
      results.set(adsetId, response.name)
    } catch (err: any) {
      logger.warn(`[AdReview] Failed to fetch adset ${adsetId}:`, err.message)
    }
  }
  
  return results
}

/**
 * 解析审核反馈，提取被拒原因
 */
function parseReviewFeedback(feedback: any): any {
  if (!feedback) return null
  
  const parsed: any = {
    global: feedback.global || null,
    placement: feedback.placement || null,
  }
  
  // 提取具体政策违规
  if (feedback.global) {
    for (const [key, value] of Object.entries(feedback.global)) {
      if (key.includes('body')) {
        parsed.bodyPolicy = Array.isArray(value) ? value.join('; ') : String(value)
      } else if (key.includes('image')) {
        parsed.imagePolicy = Array.isArray(value) ? value.join('; ') : String(value)
      } else if (key.includes('video')) {
        parsed.videoPolicy = Array.isArray(value) ? value.join('; ') : String(value)
      } else if (key.includes('landing')) {
        parsed.landingPagePolicy = Array.isArray(value) ? value.join('; ') : String(value)
      }
    }
  }
  
  return parsed
}

const getTaskOrganizationId = (task: any) => {
  return task?.organizationId || task?.toObject?.()?.organizationId
}

const getActiveTokenForOrganization = async (organizationId?: any) => {
  const query: any = { status: 'active' }
  if (organizationId) {
    query.organizationId = organizationId
  }

  return FbToken.findOne(query).sort({ updatedAt: -1 }).lean()
}

const getActiveTokenForTask = async (task: any) => (
  getActiveTokenForOrganization(getTaskOrganizationId(task))
)

const groupAdsByOrganization = (ads: any[]) => {
  const groups = new Map<string, { organizationId?: any; ads: any[] }>()

  for (const ad of ads) {
    const organizationId = ad.organizationId
    const key = organizationId ? String(organizationId) : 'platform'
    const group = groups.get(key) || { organizationId, ads: [] }
    group.ads.push(ad)
    groups.set(key, group)
  }

  return Array.from(groups.values())
}

/**
 * 更新任务中所有广告的审核状态
 */
export async function updateTaskAdsReviewStatus(taskId: string): Promise<{
  total: number
  updated: number
  pending: number
  approved: number
  rejected: number
  errors: string[]
}> {
  const result = {
    total: 0,
    updated: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    errors: [] as string[],
  }
  
  try {
    // 获取任务信息
    const task = await AdTask.findById(taskId)
    if (!task) {
      result.errors.push('任务不存在')
      return result
    }
    
    // 收集任务中创建的所有广告 ID
    const adIds: string[] = []
    const adAccountMap = new Map<string, string>()
    const taskObj = task.toObject ? task.toObject() : task
    for (const item of taskObj.items || []) {
      for (const ad of item.ads || []) {
        if (ad.adId) {
          adIds.push(ad.adId)
          if (item.accountId) adAccountMap.set(ad.adId, item.accountId)
        }
      }
      // 也从 result.adIds 中获取（兼容旧数据）
      if (item.result?.adIds) {
        for (const adId of item.result.adIds) {
          if (!adIds.includes(adId)) {
            adIds.push(adId)
          }
          if (item.accountId) adAccountMap.set(adId, item.accountId)
        }
      }
    }
    
    result.total = adIds.length
    if (adIds.length === 0) {
      return result
    }
    
    // 获取任务所属组织的有效 token，避免跨租户借用授权。
    const activeToken = await getActiveTokenForTask(task)
    if (!activeToken) {
      result.errors.push('没有可用的 Facebook Token')
      return result
    }
    
    // 查询审核状态
    const statusMap = await fetchAdReviewStatus(adIds, activeToken.token)
    
    // 更新数据库中的广告记录
    for (const [adId, data] of statusMap) {
      if (data.error) {
        result.errors.push(`Ad ${adId}: ${data.error}`)
        continue
      }
      
      const reviewFeedback = parseReviewFeedback(data.reviewFeedback)
      
      // 更新或创建广告记录
      await Ad.findOneAndUpdate(
        { adId },
        {
          $set: {
            effectiveStatus: data.effectiveStatus,
            reviewFeedback,
            reviewStatusUpdatedAt: new Date(),
            taskId,
            accountId: adAccountMap.get(adId),
            organizationId: getTaskOrganizationId(task),
          },
        },
        { upsert: true }
      )
      
      result.updated++
      
      // 统计 - 修复：区分审核状态和运行状态
      const effectiveStatus = data.effectiveStatus || ''
      
      if (effectiveStatus === 'DISAPPROVED' || effectiveStatus === 'WITH_ISSUES') {
        result.rejected++
      } else if (effectiveStatus === 'PENDING_REVIEW' || effectiveStatus === 'IN_PROCESS') {
        result.pending++
      } else if (
        effectiveStatus === 'ACTIVE' ||
        effectiveStatus === 'PREAPPROVED' ||
        effectiveStatus === 'PAUSED' ||
        effectiveStatus === 'CAMPAIGN_PAUSED' ||
        effectiveStatus === 'ADSET_PAUSED' ||
        effectiveStatus === 'ARCHIVED'
      ) {
        result.approved++
      }
    }
    
    // 更新任务的审核统计
    await AdTask.findByIdAndUpdate(taskId, {
      $set: {
        'reviewStatus.total': result.total,
        'reviewStatus.pending': result.pending,
        'reviewStatus.approved': result.approved,
        'reviewStatus.rejected': result.rejected,
        'reviewStatus.lastCheckedAt': new Date(),
      },
    })
    
    logger.info(`[AdReview] Task ${taskId} review status updated: ${result.approved} approved, ${result.pending} pending, ${result.rejected} rejected`)
    
  } catch (error: any) {
    logger.error('[AdReview] Update task ads review status failed:', error)
    result.errors.push(error.message)
  }
  
  return result
}

/**
 * 获取任务的广告审核状态详情
 */
export async function getTaskReviewDetails(taskId: string): Promise<{
  summary: {
    total: number
    pending: number
    approved: number
    rejected: number
    lastCheckedAt: Date | null
  }
  ads: Array<{
    adId: string
    name: string
    effectiveStatus: string
    statusLabel: string
    statusColor: string
    rejectionReasons: string[]
    accountId: string
  }>
}> {
  const ads = await Ad.find({ taskId }).lean()
  
  const result = {
    summary: {
      total: ads.length,
      pending: 0,
      approved: 0,
      rejected: 0,
      lastCheckedAt: null as Date | null,
    },
    ads: [] as any[],
  }
  
  for (const ad of ads) {
    const statusInfo = REVIEW_STATUS_MAP[ad.effectiveStatus || ''] || {
      label: ad.effectiveStatus || '未知',
      color: 'gray',
      icon: '❓',
    }
    
    // 提取拒绝原因
    const rejectionReasons: string[] = []
    if (ad.reviewFeedback) {
      if (ad.reviewFeedback.bodyPolicy) {
        rejectionReasons.push(`文案: ${ad.reviewFeedback.bodyPolicy}`)
      }
      if (ad.reviewFeedback.imagePolicy) {
        rejectionReasons.push(`图片: ${ad.reviewFeedback.imagePolicy}`)
      }
      if (ad.reviewFeedback.videoPolicy) {
        rejectionReasons.push(`视频: ${ad.reviewFeedback.videoPolicy}`)
      }
      if (ad.reviewFeedback.landingPagePolicy) {
        rejectionReasons.push(`落地页: ${ad.reviewFeedback.landingPagePolicy}`)
      }
    }
    
    result.ads.push({
      adId: ad.adId,
      name: ad.name || ad.adId,
      effectiveStatus: ad.effectiveStatus,
      statusLabel: `${statusInfo.icon} ${statusInfo.label}`,
      statusColor: statusInfo.color,
      rejectionReasons,
      accountId: ad.accountId,
    })
    
    // 统计 - 修复：区分审核状态和运行状态
    const effectiveStatus = ad.effectiveStatus || ''
    
    // 审核被拒
    if (effectiveStatus === 'DISAPPROVED' || effectiveStatus === 'WITH_ISSUES') {
      result.summary.rejected++
    }
    // 审核中
    else if (effectiveStatus === 'PENDING_REVIEW' || effectiveStatus === 'IN_PROCESS') {
      result.summary.pending++
    }
    // 已通过（包括暂停状态）
    else if (
      effectiveStatus === 'ACTIVE' ||
      effectiveStatus === 'PREAPPROVED' ||
      effectiveStatus === 'PAUSED' ||
      effectiveStatus === 'CAMPAIGN_PAUSED' ||
      effectiveStatus === 'ADSET_PAUSED' ||
      effectiveStatus === 'ARCHIVED'
    ) {
      result.summary.approved++
    }
    // 其他状态算作待定
    else {
      result.summary.pending++
    }
    
    // 更新最后检查时间
    if (ad.reviewStatusUpdatedAt && (!result.summary.lastCheckedAt || ad.reviewStatusUpdatedAt > result.summary.lastCheckedAt)) {
      result.summary.lastCheckedAt = ad.reviewStatusUpdatedAt
    }
  }
  
  return result
}

/**
 * 获取所有 AutoArk 发布的广告概览（按 Campaign -> AdSet -> Ad 分组）
 */
export async function getReviewOverview(): Promise<{
  campaigns: Array<{
    campaignId: string
    name: string
    status: string
    adsets: Array<{
      adsetId: string
      name: string
      ads: any[]
    }>
    totalAds: number
    pendingCount: number
    approvedCount: number
    rejectedCount: number
  }>
}> {
  // 获取所有 AutoArk 发布的广告
  const ads = await Ad.find({ taskId: { $exists: true } }).lean()
  
  // 按 Campaign 和 AdSet 分组
  const campaignMap = new Map<string, any>()
  
  for (const ad of ads) {
    const campaignId = ad.campaignId || 'unknown'
    const adsetId = ad.adsetId || 'unknown'
    
    if (!campaignMap.has(campaignId)) {
      campaignMap.set(campaignId, {
        campaignId,
        name: ad.campaignName || `Campaign ${campaignId}`,
        status: 'UNKNOWN',
        adsets: new Map<string, any>(),
        totalAds: 0,
        pendingCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
      })
    }
    
    const campaign = campaignMap.get(campaignId)
    campaign.totalAds++
    
    // 统计 - 修复：区分审核状态和运行状态
    const effectiveStatus = ad.effectiveStatus || ''
    
    // 审核被拒
    if (effectiveStatus === 'DISAPPROVED' || effectiveStatus === 'WITH_ISSUES') {
      campaign.rejectedCount++
    }
    // 审核中
    else if (effectiveStatus === 'PENDING_REVIEW' || effectiveStatus === 'IN_PROCESS') {
      campaign.pendingCount++
    }
    // 已通过（包括暂停状态的广告，因为它们已经通过审核）
    else if (
      effectiveStatus === 'ACTIVE' ||
      effectiveStatus === 'PREAPPROVED' ||
      effectiveStatus === 'PAUSED' ||
      effectiveStatus === 'CAMPAIGN_PAUSED' ||
      effectiveStatus === 'ADSET_PAUSED' ||
      effectiveStatus === 'ARCHIVED'
    ) {
      campaign.approvedCount++
    }
    // 其他状态算作待定
    else {
      campaign.pendingCount++
    }
    
    // 添加到 adset
    if (!campaign.adsets.has(adsetId)) {
      campaign.adsets.set(adsetId, {
        adsetId,
        name: ad.adsetName || `AdSet ${adsetId}`,
        ads: [],
      })
    }
    
    campaign.adsets.get(adsetId).ads.push({
      _id: ad._id,
      adId: ad.adId,
      name: ad.name || ad.adId,
      effectiveStatus: ad.effectiveStatus || 'UNKNOWN',
      reviewFeedback: ad.reviewFeedback,
      createdAt: ad.createdAt,
      adsetId: ad.adsetId,
      campaignId: ad.campaignId,
    })
  }
  
  // 获取所有 campaign 的真实状态
  const campaignIds = Array.from(campaignMap.keys())
  const campaignDocs = await Campaign.find({ campaignId: { $in: campaignIds } })
    .select('campaignId status')
    .lean()
  
  const campaignStatusMap = new Map(
    campaignDocs.map(c => [c.campaignId, c.status])
  )
  
  // 转换为数组，并设置真实状态
  const campaigns = Array.from(campaignMap.values()).map(campaign => ({
    ...campaign,
    status: campaignStatusMap.get(campaign.campaignId) || 'UNKNOWN',
    adsets: Array.from(campaign.adsets.values()),
  }))
  
  // 按总广告数排序
  campaigns.sort((a, b) => b.totalAds - a.totalAds)
  
  return { campaigns }
}

/**
 * 刷新所有 AutoArk 广告的审核状态
 */
export async function refreshAllReviewStatus(): Promise<{
  total: number
  updated: number
  errors: string[]
}> {
  const result = {
    total: 0,
    updated: 0,
    errors: [] as string[],
  }
  
  try {
    // 获取所有 AutoArk 发布的广告
    const ads = await Ad.find({ taskId: { $exists: true } }).limit(1000)
    result.total = ads.length
    
    if (ads.length === 0) {
      return result
    }
    
    for (const group of groupAdsByOrganization(ads as any[])) {
      const activeToken = await getActiveTokenForOrganization(group.organizationId)
      if (!activeToken) {
        result.errors.push(`组织 ${group.organizationId || 'platform'} 没有可用的 Facebook Token`)
        continue
      }

      // 批量查询状态
      const adIds = group.ads.map(ad => ad.adId)
      const statusMap = await fetchAdReviewStatus(adIds, activeToken.token)
      
      // 收集所有需要查询名称的 Campaign 和 AdSet ID
      const campaignIdsToFetch = new Set<string>()
      const adsetIdsToFetch = new Set<string>()
      
      // 先更新广告状态，同时收集需要查询的 ID
      for (const [adId, data] of statusMap) {
        if (data.error) {
          result.errors.push(`Ad ${adId}: ${data.error}`)
          continue
        }
        
        const reviewFeedback = parseReviewFeedback(data.reviewFeedback)
        
        // 更新广告基本信息
        const updateData: any = {
          effectiveStatus: data.effectiveStatus,
          name: data.name,
          reviewFeedback,
          reviewStatusUpdatedAt: new Date(),
        }
        
        // 更新 adsetId 和 campaignId（如果有）
        if (data.adsetId) {
          updateData.adsetId = data.adsetId
          adsetIdsToFetch.add(data.adsetId)
        }
        if (data.campaignId) {
          updateData.campaignId = data.campaignId
          campaignIdsToFetch.add(data.campaignId)
        }
        
        await Ad.findOneAndUpdate(
          { adId },
          { $set: updateData }
        )
        
        result.updated++
      }
      
      // 批量获取 Campaign 名称并更新
      if (campaignIdsToFetch.size > 0) {
        logger.info(`[AdReview] Fetching names for ${campaignIdsToFetch.size} campaigns...`)
        const campaignNames = await fetchCampaignNames(Array.from(campaignIdsToFetch), activeToken.token)
        
        for (const [campaignId, campaignName] of campaignNames) {
          await Ad.updateMany(
            { campaignId },
            { $set: { campaignName } }
          )
        }
        logger.info(`[AdReview] Updated ${campaignNames.size} campaign names`)
      }
      
      // 批量获取 AdSet 名称并更新
      if (adsetIdsToFetch.size > 0) {
        logger.info(`[AdReview] Fetching names for ${adsetIdsToFetch.size} adsets...`)
        const adsetNames = await fetchAdSetNames(Array.from(adsetIdsToFetch), activeToken.token)
        
        for (const [adsetId, adsetName] of adsetNames) {
          await Ad.updateMany(
            { adsetId },
            { $set: { adsetName } }
          )
        }
        logger.info(`[AdReview] Updated ${adsetNames.size} adset names`)
      }
    }
    
    logger.info(`[AdReview] Refresh all completed: ${result.total} total, ${result.updated} updated`)
    
  } catch (error: any) {
    logger.error('[AdReview] Refresh all failed:', error)
    result.errors.push(error.message)
  }
  
  return result
}

/**
 * 批量检查所有待审核的广告
 * 用于定时任务
 */
export async function checkPendingAdsReview(): Promise<{
  checked: number
  updated: number
  errors: string[]
}> {
  const result = {
    checked: 0,
    updated: 0,
    errors: [] as string[],
  }
  
  try {
    // 查找所有状态为 PENDING_REVIEW 或最近24小时内创建的广告
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const pendingAds = await Ad.find({
      $or: [
        { effectiveStatus: 'PENDING_REVIEW' },
        { effectiveStatus: { $exists: false } },
        { createdAt: { $gte: oneDayAgo }, effectiveStatus: { $ne: 'ACTIVE' } },
      ],
    }).limit(500)
    
    if (pendingAds.length === 0) {
      logger.info('[AdReview] No pending ads to check')
      return result
    }
    
    result.checked = pendingAds.length
    
    for (const group of groupAdsByOrganization(pendingAds as any[])) {
      const activeToken = await getActiveTokenForOrganization(group.organizationId)
      if (!activeToken) {
        result.errors.push(`组织 ${group.organizationId || 'platform'} 没有可用的 Facebook Token`)
        continue
      }

      // 批量查询状态
      const adIds = group.ads.map(ad => ad.adId)
      const statusMap = await fetchAdReviewStatus(adIds, activeToken.token)
      
      // 更新状态
      for (const [adId, data] of statusMap) {
        if (data.error) continue
        
        const reviewFeedback = parseReviewFeedback(data.reviewFeedback)
        
        await Ad.findOneAndUpdate(
          { adId },
          {
            $set: {
              effectiveStatus: data.effectiveStatus,
              reviewFeedback,
              reviewStatusUpdatedAt: new Date(),
            },
          }
        )
        
        result.updated++
      }
    }
    
    logger.info(`[AdReview] Batch check completed: ${result.checked} checked, ${result.updated} updated`)
    
  } catch (error: any) {
    logger.error('[AdReview] Batch check failed:', error)
    result.errors.push(error.message)
  }
  
  return result
}
