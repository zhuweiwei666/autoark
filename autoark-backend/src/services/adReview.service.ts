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
            fields: 'id,name,status,effective_status,ad_review_feedback',
          })
          
          results.set(adId, {
            effectiveStatus: response.effective_status,
            status: response.status,
            reviewFeedback: response.ad_review_feedback,
            name: response.name,
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
    const taskObj = task.toObject ? task.toObject() : task
    for (const item of taskObj.items || []) {
      for (const ad of item.ads || []) {
        if (ad.adId) {
          adIds.push(ad.adId)
        }
      }
      // 也从 result.adIds 中获取（兼容旧数据）
      if (item.result?.adIds) {
        for (const adId of item.result.adIds) {
          if (!adIds.includes(adId)) {
            adIds.push(adId)
          }
        }
      }
    }
    
    result.total = adIds.length
    if (adIds.length === 0) {
      return result
    }
    
    // 获取有效的 token
    const activeToken = await FbToken.findOne({ status: 'active' })
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
          },
        },
        { upsert: true }
      )
      
      result.updated++
      
      // 统计
      if (data.effectiveStatus === 'PENDING_REVIEW') {
        result.pending++
      } else if (data.effectiveStatus === 'ACTIVE' || data.effectiveStatus === 'PREAPPROVED') {
        result.approved++
      } else if (data.effectiveStatus === 'DISAPPROVED') {
        result.rejected++
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
    
    // 统计
    if (ad.effectiveStatus === 'PENDING_REVIEW') {
      result.summary.pending++
    } else if (ad.effectiveStatus === 'ACTIVE' || ad.effectiveStatus === 'PREAPPROVED') {
      result.summary.approved++
    } else if (ad.effectiveStatus === 'DISAPPROVED') {
      result.summary.rejected++
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
    
    // 统计
    if (ad.effectiveStatus === 'PENDING_REVIEW') {
      campaign.pendingCount++
    } else if (ad.effectiveStatus === 'ACTIVE' || ad.effectiveStatus === 'PREAPPROVED') {
      campaign.approvedCount++
    } else if (ad.effectiveStatus === 'DISAPPROVED') {
      campaign.rejectedCount++
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
  
  // 转换为数组
  const campaigns = Array.from(campaignMap.values()).map(campaign => ({
    ...campaign,
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
    
    // 获取有效 token
    const activeToken = await FbToken.findOne({ status: 'active' })
    if (!activeToken) {
      result.errors.push('没有可用的 Facebook Token')
      return result
    }
    
    // 批量查询状态
    const adIds = ads.map(ad => ad.adId)
    const statusMap = await fetchAdReviewStatus(adIds, activeToken.token)
    
    // 更新状态
    for (const [adId, data] of statusMap) {
      if (data.error) {
        result.errors.push(`Ad ${adId}: ${data.error}`)
        continue
      }
      
      const reviewFeedback = parseReviewFeedback(data.reviewFeedback)
      
      await Ad.findOneAndUpdate(
        { adId },
        {
          $set: {
            effectiveStatus: data.effectiveStatus,
            name: data.name,
            reviewFeedback,
            reviewStatusUpdatedAt: new Date(),
          },
        }
      )
      
      result.updated++
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
    
    // 获取有效 token
    const activeToken = await FbToken.findOne({ status: 'active' })
    if (!activeToken) {
      result.errors.push('没有可用的 Facebook Token')
      return result
    }
    
    // 批量查询状态
    const adIds = pendingAds.map(ad => ad.adId)
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
    
    logger.info(`[AdReview] Batch check completed: ${result.checked} checked, ${result.updated} updated`)
    
  } catch (error: any) {
    logger.error('[AdReview] Batch check failed:', error)
    result.errors.push(error.message)
  }
  
  return result
}
