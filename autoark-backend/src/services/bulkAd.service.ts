import AdDraft from '../models/AdDraft'
import AdTask from '../models/AdTask'
import TargetingPackage from '../models/TargetingPackage'
import CopywritingPackage from '../models/CopywritingPackage'
import CreativeGroup from '../models/CreativeGroup'
import FbToken from '../models/FbToken'
import logger from '../utils/logger'
import {
  createCampaign,
  createAdSet,
  createAdCreative,
  createAd,
  uploadImageFromUrl,
  uploadVideoFromUrl,
} from '../integration/facebook/bulkCreate.api'

/**
 * 批量广告创建服务
 * 处理广告草稿的创建、验证、发布和任务管理
 */

// ==================== 草稿管理 ====================

/**
 * 创建广告草稿
 */
export const createDraft = async (data: any, userId?: string) => {
  const draft = new AdDraft({
    ...data,
    createdBy: userId,
    lastModifiedBy: userId,
  })
  
  // 计算预估数据
  draft.calculateEstimates()
  
  await draft.save()
  logger.info(`[BulkAd] Draft created: ${draft._id}`)
  return draft
}

/**
 * 更新广告草稿
 */
export const updateDraft = async (draftId: string, data: any, userId?: string) => {
  const draft = await AdDraft.findById(draftId)
  if (!draft) {
    throw new Error('Draft not found')
  }
  
  // 已发布的草稿不能修改
  if (draft.status === 'published') {
    throw new Error('Cannot update published draft')
  }
  
  Object.assign(draft, data, { lastModifiedBy: userId })
  
  // 重新计算预估数据
  draft.calculateEstimates()
  
  // 重新验证
  draft.validation = { isValid: false, errors: [], warnings: [], validatedAt: undefined }
  
  await draft.save()
  logger.info(`[BulkAd] Draft updated: ${draftId}`)
  return draft
}

/**
 * 获取草稿详情
 */
export const getDraft = async (draftId: string) => {
  const draft = await AdDraft.findById(draftId)
    .populate('adset.targetingPackageId')
    .populate('ad.creativeGroupIds')
    .populate('ad.copywritingPackageIds')
  
  if (!draft) {
    throw new Error('Draft not found')
  }
  return draft
}

/**
 * 获取草稿列表
 */
export const getDraftList = async (query: any = {}) => {
  const { status, createdBy, page = 1, pageSize = 20 } = query
  
  const filter: any = {}
  if (status) filter.status = status
  if (createdBy) filter.createdBy = createdBy
  
  const [list, total] = await Promise.all([
    AdDraft.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    AdDraft.countDocuments(filter),
  ])
  
  return { list, total, page, pageSize }
}

/**
 * 删除草稿
 */
export const deleteDraft = async (draftId: string) => {
  const draft = await AdDraft.findById(draftId)
  if (!draft) {
    throw new Error('Draft not found')
  }
  
  if (draft.status === 'published') {
    throw new Error('Cannot delete published draft')
  }
  
  await AdDraft.deleteOne({ _id: draftId })
  logger.info(`[BulkAd] Draft deleted: ${draftId}`)
  return { success: true }
}

/**
 * 验证草稿
 */
export const validateDraft = async (draftId: string) => {
  const draft = await AdDraft.findById(draftId)
  if (!draft) {
    throw new Error('Draft not found')
  }
  
  const validation = await draft.validate()
  await draft.save()
  
  return validation
}

// ==================== 发布流程 ====================

/**
 * 发布草稿（创建任务）
 */
export const publishDraft = async (draftId: string, userId?: string) => {
  const draft = await getDraft(draftId)
  
  // 验证草稿
  const validation = await draft.validate()
  if (!validation.isValid) {
    throw new Error(`Draft validation failed: ${validation.errors.map((e: any) => e.message).join(', ')}`)
  }
  
  // 创建任务
  const task = new AdTask({
    taskType: 'BULK_AD_CREATE',
    status: 'pending',
    platform: 'facebook',
    draftId: draft._id,
    
    // 初始化任务项
    items: draft.accounts.map((account: any) => ({
      accountId: account.accountId,
      accountName: account.accountName,
      status: 'pending',
      progress: { current: 0, total: 3, percentage: 0 }, // campaign, adset, ad
    })),
    
    // 保存配置快照
    configSnapshot: {
      accounts: draft.accounts,
      campaign: draft.campaign,
      adset: draft.adset,
      ad: draft.ad,
      publishStrategy: draft.publishStrategy,
    },
    
    // 设置预估总数
    progress: {
      totalAccounts: draft.accounts.length,
      totalCampaigns: draft.estimates.totalCampaigns,
      totalAdsets: draft.estimates.totalAdsets,
      totalAds: draft.estimates.totalAds,
    },
    
    publishSettings: {
      schedule: draft.publishStrategy?.schedule || 'IMMEDIATE',
      scheduledTime: draft.publishStrategy?.scheduledTime,
    },
    
    createdBy: userId,
  })
  
  await task.save()
  
  // 更新草稿状态
  draft.status = 'published'
  draft.taskId = task._id
  await draft.save()
  
  logger.info(`[BulkAd] Draft published, task created: ${task._id}`)
  return task
}

// ==================== 任务执行 ====================

/**
 * 执行单个账户的广告创建任务
 * 这个函数会被 Worker 调用
 */
export const executeTaskForAccount = async (
  taskId: string,
  accountId: string,
) => {
  const task = await AdTask.findById(taskId)
  if (!task) {
    throw new Error('Task not found')
  }
  
  const item = task.items.find((i: any) => i.accountId === accountId)
  if (!item) {
    throw new Error('Task item not found')
  }
  
  // 获取 Token
  const fbToken = await FbToken.findOne({ status: 'active' })
  if (!fbToken) {
    throw new Error('No active Facebook token found')
  }
  const token = fbToken.accessToken
  
  const config = task.configSnapshot
  const accountConfig = config.accounts.find((a: any) => a.accountId === accountId)
  if (!accountConfig) {
    throw new Error('Account config not found')
  }
  
  // 更新状态为处理中
  task.updateItemStatus(accountId, 'processing')
  await task.save()
  
  try {
    // ==================== 1. 创建 Campaign ====================
    const campaignName = generateName(config.campaign.nameTemplate, {
      accountName: accountConfig.accountName,
      date: new Date().toISOString().slice(0, 10),
    })
    
    const campaignResult = await createCampaign({
      accountId,
      token,
      name: campaignName,
      objective: config.campaign.objective || 'OUTCOME_SALES',
      status: config.campaign.status || 'PAUSED',
      buyingType: config.campaign.buyingType,
      specialAdCategories: config.campaign.specialAdCategories,
      dailyBudget: config.campaign.budgetType === 'DAILY' ? config.campaign.budget : undefined,
      lifetimeBudget: config.campaign.budgetType === 'LIFETIME' ? config.campaign.budget : undefined,
      bidStrategy: config.campaign.bidStrategy,
      spendCap: config.campaign.spendCap,
    })
    
    if (!campaignResult.success) {
      throw new Error(`Campaign creation failed: ${campaignResult.error?.message}`)
    }
    
    const campaignId = campaignResult.id
    task.updateItemStatus(accountId, 'processing', {
      campaignId,
      campaignName,
    })
    await task.save()
    
    // ==================== 2. 获取定向配置 ====================
    let targeting: any = {}
    if (config.adset.targetingPackageId) {
      const targetingPackage = await TargetingPackage.findById(config.adset.targetingPackageId)
      if (targetingPackage) {
        targeting = targetingPackage.toFacebookTargeting()
      }
    } else if (config.adset.inlineTargeting) {
      targeting = config.adset.inlineTargeting
    }
    
    // ==================== 3. 创建 AdSet ====================
    const adsetName = generateName(config.adset.nameTemplate, {
      accountName: accountConfig.accountName,
      campaignName,
      date: new Date().toISOString().slice(0, 10),
    })
    
    const adsetResult = await createAdSet({
      accountId,
      token,
      campaignId,
      name: adsetName,
      status: config.adset.status || 'PAUSED',
      targeting,
      optimizationGoal: config.adset.optimizationGoal || 'OFFSITE_CONVERSIONS',
      billingEvent: config.adset.billingEvent || 'IMPRESSIONS',
      bidStrategy: config.adset.bidStrategy,
      bidAmount: config.adset.bidAmount,
      dailyBudget: config.campaign.budgetOptimization ? undefined : config.adset.budget,
      startTime: config.adset.startTime?.toISOString(),
      endTime: config.adset.endTime?.toISOString(),
      promotedObject: accountConfig.pixelId ? {
        pixel_id: accountConfig.pixelId,
        custom_event_type: accountConfig.conversionEvent || 'PURCHASE',
      } : undefined,
      attribution_spec: config.adset.attributionSpec ? [{
        event_type: 'CLICK_THROUGH',
        window_days: config.adset.attributionSpec.clickWindow || 7,
      }, {
        event_type: 'VIEW_THROUGH',
        window_days: config.adset.attributionSpec.viewWindow || 1,
      }] : undefined,
    })
    
    if (!adsetResult.success) {
      throw new Error(`AdSet creation failed: ${adsetResult.error?.message}`)
    }
    
    const adsetId = adsetResult.id
    task.updateItemStatus(accountId, 'processing', {
      adsetIds: [adsetId],
    })
    await task.save()
    
    // ==================== 4. 获取创意组和文案包 ====================
    const creativeGroups = await CreativeGroup.find({
      _id: { $in: config.ad.creativeGroupIds || [] },
    })
    
    const copywritingPackages = await CopywritingPackage.find({
      _id: { $in: config.ad.copywritingPackageIds || [] },
    })
    
    if (creativeGroups.length === 0) {
      throw new Error('No creative groups found')
    }
    if (copywritingPackages.length === 0) {
      throw new Error('No copywriting packages found')
    }
    
    // ==================== 5. 上传素材并创建广告 ====================
    const adIds: string[] = []
    
    for (let cgIndex = 0; cgIndex < creativeGroups.length; cgIndex++) {
      const creativeGroup = creativeGroups[cgIndex]
      const copywriting = config.publishStrategy?.copywritingMode === 'SEQUENTIAL'
        ? copywritingPackages[cgIndex % copywritingPackages.length]
        : copywritingPackages[0]
      
      // 获取素材
      const material = creativeGroup.getPrimaryMaterial()
      if (!material) {
        logger.warn(`[BulkAd] No material found in creative group: ${creativeGroup.name}`)
        continue
      }
      
      // 上传素材到 Facebook（如果还没上传）
      let materialRef: any = {}
      if (material.type === 'image') {
        if (material.facebookImageHash) {
          materialRef.image_hash = material.facebookImageHash
        } else {
          const uploadResult = await uploadImageFromUrl({
            accountId,
            token,
            imageUrl: material.url,
            name: material.name,
          })
          if (uploadResult.success) {
            materialRef.image_hash = uploadResult.hash
            // 更新素材记录
            material.facebookImageHash = uploadResult.hash
            material.status = 'uploaded'
            material.uploadedAt = new Date()
            await creativeGroup.save()
          } else {
            logger.error(`[BulkAd] Failed to upload image:`, uploadResult.error)
            continue
          }
        }
      } else if (material.type === 'video') {
        if (material.facebookVideoId) {
          materialRef.video_id = material.facebookVideoId
        } else {
          const uploadResult = await uploadVideoFromUrl({
            accountId,
            token,
            videoUrl: material.url,
            title: material.name,
          })
          if (uploadResult.success) {
            materialRef.video_id = uploadResult.id
            // 更新素材记录
            material.facebookVideoId = uploadResult.id
            material.status = 'uploaded'
            material.uploadedAt = new Date()
            await creativeGroup.save()
          } else {
            logger.error(`[BulkAd] Failed to upload video:`, uploadResult.error)
            continue
          }
        }
      }
      
      // 创建 Ad Creative
      const creativeName = `${adsetName}_creative_${cgIndex + 1}`
      const objectStorySpec: any = {
        page_id: accountConfig.pageId,
        link_data: {
          link: copywriting.links?.websiteUrl || copywriting.getFullUrl?.() || '',
          message: copywriting.content?.primaryTexts?.[0] || '',
          name: copywriting.content?.headlines?.[0] || '',
          description: copywriting.content?.descriptions?.[0] || '',
          call_to_action: {
            type: copywriting.callToAction || 'SHOP_NOW',
            value: { link: copywriting.links?.websiteUrl || '' },
          },
        },
      }
      
      // 添加素材
      if (materialRef.image_hash) {
        objectStorySpec.link_data.image_hash = materialRef.image_hash
      } else if (materialRef.video_id) {
        objectStorySpec.link_data.video_data = {
          video_id: materialRef.video_id,
          call_to_action: objectStorySpec.link_data.call_to_action,
        }
        delete objectStorySpec.link_data.call_to_action
      }
      
      // Instagram 账户
      if (accountConfig.instagramAccountId) {
        objectStorySpec.instagram_actor_id = accountConfig.instagramAccountId
      }
      
      const creativeResult = await createAdCreative({
        accountId,
        token,
        name: creativeName,
        objectStorySpec,
      })
      
      if (!creativeResult.success) {
        logger.error(`[BulkAd] Failed to create creative:`, creativeResult.error)
        task.updateItemStatus(accountId, 'processing', undefined, {
          entityType: 'creative',
          entityName: creativeName,
          errorCode: creativeResult.error?.code,
          errorMessage: creativeResult.error?.message,
        })
        await task.save()
        continue
      }
      
      const creativeId = creativeResult.id
      
      // 创建 Ad
      const adName = generateName(config.ad.nameTemplate, {
        accountName: accountConfig.accountName,
        campaignName,
        adsetName,
        creativeGroupName: creativeGroup.name,
        index: cgIndex + 1,
        date: new Date().toISOString().slice(0, 10),
      })
      
      const adResult = await createAd({
        accountId,
        token,
        adsetId,
        creativeId,
        name: adName,
        status: config.ad.status || 'PAUSED',
        trackingSpecs: accountConfig.pixelId ? [{
          action_source: ['website'],
          fb_pixel: [accountConfig.pixelId],
        }] : undefined,
        urlTags: config.ad.tracking?.urlTags,
      })
      
      if (!adResult.success) {
        logger.error(`[BulkAd] Failed to create ad:`, adResult.error)
        task.updateItemStatus(accountId, 'processing', undefined, {
          entityType: 'ad',
          entityName: adName,
          errorCode: adResult.error?.code,
          errorMessage: adResult.error?.message,
        })
        await task.save()
        continue
      }
      
      adIds.push(adResult.id)
    }
    
    // ==================== 6. 完成任务 ====================
    task.updateItemStatus(accountId, 'success', {
      adIds,
      createdCount: adIds.length,
    })
    await task.save()
    
    // 更新创意组和文案包使用统计
    await Promise.all([
      CreativeGroup.updateMany(
        { _id: { $in: config.ad.creativeGroupIds } },
        { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } }
      ),
      CopywritingPackage.updateMany(
        { _id: { $in: config.ad.copywritingPackageIds } },
        { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } }
      ),
    ])
    
    logger.info(`[BulkAd] Task completed for account ${accountId}: ${adIds.length} ads created`)
    
    return {
      success: true,
      campaignId,
      adsetIds: [adsetId],
      adIds,
    }
    
  } catch (error: any) {
    logger.error(`[BulkAd] Task failed for account ${accountId}:`, error)
    task.updateItemStatus(accountId, 'failed', undefined, {
      entityType: 'general',
      errorCode: 'EXECUTION_ERROR',
      errorMessage: error.message,
    })
    await task.save()
    throw error
  }
}

// ==================== 任务管理 ====================

/**
 * 获取任务详情
 */
export const getTask = async (taskId: string) => {
  const task = await AdTask.findById(taskId).populate('draftId')
  if (!task) {
    throw new Error('Task not found')
  }
  return task
}

/**
 * 获取任务列表
 */
export const getTaskList = async (query: any = {}) => {
  const { status, taskType, platform, createdBy, page = 1, pageSize = 20 } = query
  
  const filter: any = {}
  if (status) filter.status = status
  if (taskType) filter.taskType = taskType
  if (platform) filter.platform = platform
  if (createdBy) filter.createdBy = createdBy
  
  const [list, total] = await Promise.all([
    AdTask.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    AdTask.countDocuments(filter),
  ])
  
  return { list, total, page, pageSize }
}

/**
 * 取消任务
 */
export const cancelTask = async (taskId: string) => {
  const task = await AdTask.findById(taskId)
  if (!task) {
    throw new Error('Task not found')
  }
  
  if (task.isCompleted) {
    throw new Error('Cannot cancel completed task')
  }
  
  task.status = 'cancelled'
  task.completedAt = new Date()
  await task.save()
  
  logger.info(`[BulkAd] Task cancelled: ${taskId}`)
  return task
}

/**
 * 重试失败的任务项
 */
export const retryFailedItems = async (taskId: string) => {
  const task = await AdTask.findById(taskId)
  if (!task) {
    throw new Error('Task not found')
  }
  
  const failedItems = task.getFailedItems()
  if (failedItems.length === 0) {
    throw new Error('No failed items to retry')
  }
  
  // 重置失败项状态
  for (const item of failedItems) {
    item.status = 'pending'
    item.errors = []
    item.startedAt = undefined
    item.completedAt = undefined
  }
  
  task.status = 'pending'
  task.retryInfo = {
    retryCount: (task.retryInfo?.retryCount || 0) + 1,
    lastRetryAt: new Date(),
  }
  
  await task.save()
  logger.info(`[BulkAd] Task retry initiated: ${taskId}`)
  
  return task
}

// ==================== 辅助函数 ====================

/**
 * 生成名称（支持模板变量）
 */
function generateName(template: string, variables: Record<string, any>): string {
  let name = template
  
  for (const [key, value] of Object.entries(variables)) {
    name = name.replace(new RegExp(`\\{${key}\\}`, 'gi'), String(value || ''))
  }
  
  // 清理多余的分隔符
  name = name.replace(/_{2,}/g, '_').replace(/^_|_$/g, '')
  
  return name
}

export default {
  createDraft,
  updateDraft,
  getDraft,
  getDraftList,
  deleteDraft,
  validateDraft,
  publishDraft,
  executeTaskForAccount,
  getTask,
  getTaskList,
  cancelTask,
  retryFailedItems,
}

