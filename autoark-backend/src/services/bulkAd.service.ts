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
  const draft: any = new AdDraft({
    ...data,
    createdBy: userId,
    lastModifiedBy: userId,
  })
  
  // 计算预估数据
  if (draft.calculateEstimates) {
    draft.calculateEstimates()
  }
  
  await draft.save()
  logger.info(`[BulkAd] Draft created: ${draft._id}`)
  return draft
}

/**
 * 更新广告草稿
 */
export const updateDraft = async (draftId: string, data: any, userId?: string) => {
  const draft: any = await AdDraft.findById(draftId)
  if (!draft) {
    throw new Error('Draft not found')
  }
  
  // 已发布的草稿不能修改
  if (draft.status === 'published') {
    throw new Error('Cannot update published draft')
  }
  
  Object.assign(draft, data, { lastModifiedBy: userId })
  
  // 重新计算预估数据
  if (draft.calculateEstimates) {
    draft.calculateEstimates()
  }
  
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
  const draft: any = await AdDraft.findById(draftId)
  if (!draft) {
    throw new Error('Draft not found')
  }
  
  // 简化验证逻辑
  const errors: any[] = []
  const warnings: any[] = []
  
  if (!draft.accounts || draft.accounts.length === 0) {
    errors.push({ field: 'accounts', message: '请至少选择一个广告账户', severity: 'error' })
  }
  if (!draft.campaign?.nameTemplate) {
    errors.push({ field: 'campaign.nameTemplate', message: '请填写广告系列名称', severity: 'error' })
  }
  if (!draft.campaign?.budget || draft.campaign.budget <= 0) {
    errors.push({ field: 'campaign.budget', message: '请填写有效的预算金额', severity: 'error' })
  }
  if (!draft.adset?.targetingPackageId && !draft.adset?.inlineTargeting) {
    errors.push({ field: 'adset.targeting', message: '请选择定向包或配置定向条件', severity: 'error' })
  }
  if (!draft.ad?.creativeGroupIds || draft.ad.creativeGroupIds.length === 0) {
    errors.push({ field: 'ad.creativeGroupIds', message: '请至少选择一个创意组', severity: 'error' })
  }
  if (!draft.ad?.copywritingPackageIds || draft.ad.copywritingPackageIds.length === 0) {
    errors.push({ field: 'ad.copywritingPackageIds', message: '请至少选择一个文案包', severity: 'error' })
  }
  
  const validation = {
    isValid: errors.length === 0,
    errors,
    warnings,
    validatedAt: new Date(),
  }
  
  draft.validation = validation
  await draft.save()
  
  return validation
}

// ==================== 发布流程 ====================

/**
 * 发布草稿（创建任务）
 */
export const publishDraft = async (draftId: string, userId?: string) => {
  const draft: any = await getDraft(draftId)
  
  // 验证草稿
  const validation = await validateDraft(draftId)
  if (!validation.isValid) {
    throw new Error(`Draft validation failed: ${validation.errors.map((e: any) => e.message).join(', ')}`)
  }
  
  // 计算预估
  const accountCount = draft.accounts?.length || 0
  const creativeGroupCount = draft.ad?.creativeGroupIds?.length || 1
  
  // 创建任务
  const task: any = new AdTask({
    taskType: 'BULK_AD_CREATE',
    status: 'pending',
    platform: 'facebook',
    draftId: draft._id,
    
    // 初始化任务项
    items: draft.accounts.map((account: any) => ({
      accountId: account.accountId,
      accountName: account.accountName,
      status: 'pending',
      progress: { current: 0, total: 3, percentage: 0 },
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
      totalAccounts: accountCount,
      totalCampaigns: accountCount,
      totalAdsets: accountCount,
      totalAds: accountCount * creativeGroupCount,
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
  
  // 检查 Redis 是否可用
  const { getRedisClient } = await import('../config/redis')
  const redisAvailable = (() => {
    try {
      return getRedisClient() !== null
    } catch {
      return false
    }
  })()
  
  if (redisAvailable) {
    // Redis 可用，使用队列异步执行
    logger.info(`[BulkAd] Redis available, adding task to queue`)
    const { addBulkAdJobsBatch } = await import('../queue/bulkAd.queue')
    const accountIds = task.items.map((item: any) => item.accountId)
    
    task.status = 'queued'
    task.queuedAt = new Date()
    await task.save()
    
    await addBulkAdJobsBatch(task._id.toString(), accountIds)
    logger.info(`[BulkAd] Task ${task._id} queued, ${accountIds.length} accounts`)
  } else {
    // Redis 不可用，直接同步执行
    logger.info(`[BulkAd] Redis unavailable, executing task synchronously`)
    executeTaskSynchronously(task._id.toString()).catch(err => {
      logger.error(`[BulkAd] Sync execution failed:`, err)
    })
  }
  
  return task
}

/**
 * 同步执行任务（当 Redis 不可用时使用）
 */
const executeTaskSynchronously = async (taskId: string) => {
  const task: any = await AdTask.findById(taskId)
  if (!task) {
    throw new Error('Task not found')
  }
  
  task.status = 'processing'
  task.startedAt = new Date()
  await task.save()
  
  logger.info(`[BulkAd] Starting sync execution for task ${taskId}`)
  
  let successCount = 0
  let failCount = 0
  
  for (const item of task.items) {
    if (item.status === 'cancelled') continue
    
    try {
      logger.info(`[BulkAd] Processing account: ${item.accountId}`)
      
      item.status = 'processing'
      await task.save()
      
      await executeTaskForAccount(taskId, item.accountId)
      
      item.status = 'completed'
      successCount++
      logger.info(`[BulkAd] Account ${item.accountId} completed`)
    } catch (error: any) {
      item.status = 'failed'
      item.error = error.message
      failCount++
      logger.error(`[BulkAd] Account ${item.accountId} failed:`, error)
    }
    
    // 更新进度
    const completedCount = task.items.filter((i: any) => 
      i.status === 'completed' || i.status === 'failed'
    ).length
    task.progress.percentage = Math.round((completedCount / task.items.length) * 100)
    await task.save()
  }
  
  // 任务完成
  task.status = failCount === 0 ? 'completed' : (successCount === 0 ? 'failed' : 'partial')
  task.completedAt = new Date()
  task.results = {
    totalAccounts: task.items.length,
    successCount,
    failCount,
    createdCampaigns: successCount,
    createdAdsets: successCount,
    createdAds: successCount,
  }
  await task.save()
  
  logger.info(`[BulkAd] Task ${taskId} completed: ${successCount} success, ${failCount} failed`)
}

// ==================== 任务执行 ====================

/**
 * 执行单个账户的广告创建任务
 */

// 原子更新任务项状态（避免并发冲突）
async function updateTaskItemAtomic(taskId: string, accountId: string, update: any) {
  return AdTask.findOneAndUpdate(
    { _id: taskId, 'items.accountId': accountId },
    { $set: update },
    { new: true }
  )
}

// 原子更新任务进度
async function updateTaskProgressAtomic(taskId: string) {
  const task: any = await AdTask.findById(taskId)
  if (!task) return
  
  const items: any[] = task.items || []
  // 兼容 'success' 和 'completed' 状态（修复状态不一致问题）
  const successCount = items.filter((i: any) => i.status === 'success' || i.status === 'completed').length
  const failedCount = items.filter((i: any) => i.status === 'failed').length
  const totalAds = items.reduce((sum: number, i: any) => sum + (i.result?.createdCount || 0), 0)
  const percentage = items.length > 0 ? Math.round(((successCount + failedCount) / items.length) * 100) : 0
  
  const allDone = successCount + failedCount === items.length
  // 使用 'completed' 作为成功状态，与前端 STATUS_MAP 保持一致
  const status = allDone ? (failedCount === items.length ? 'failed' : successCount === items.length ? 'completed' : 'partial') : 'running'
  
  await AdTask.findByIdAndUpdate(taskId, {
    $set: {
      'progress.successAccounts': successCount,
      'progress.failedAccounts': failedCount,
      'progress.createdAds': totalAds,
      'progress.percentage': percentage,
      status,
      ...(allDone ? { completedAt: new Date() } : {}),
    }
  })
}

export const executeTaskForAccount = async (
  taskId: string,
  accountId: string,
) => {
  const task: any = await AdTask.findById(taskId)
  if (!task) {
    throw new Error('Task not found')
  }
  
  const item = task.items.find((i: any) => i.accountId === accountId)
  if (!item) {
    throw new Error('Task item not found')
  }
  
  // 获取 Token
  const fbToken: any = await FbToken.findOne({ status: 'active' })
  if (!fbToken) {
    throw new Error('No active Facebook token found')
  }
  const token = fbToken.token
  
  const config = task.configSnapshot
  const accountConfig = config.accounts.find((a: any) => a.accountId === accountId)
  if (!accountConfig) {
    throw new Error('Account config not found')
  }
  
  // 验证必要配置
  if (!accountConfig.pageId) {
    throw new Error(`账户 ${accountConfig.accountName || accountId} 没有配置 Facebook 主页，无法创建广告`)
  }
  
  // 原子更新状态为处理中
  await updateTaskItemAtomic(taskId, accountId, {
    'items.$.status': 'processing',
    'items.$.startedAt': new Date(),
  })
  
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
    // 原子更新 campaign 结果
    await updateTaskItemAtomic(taskId, accountId, {
      'items.$.result.campaignId': campaignId,
      'items.$.result.campaignName': campaignName,
    })
    
    // ==================== 2. 获取定向配置 ====================
    let targeting: any = {}
    if (config.adset.targetingPackageId) {
      const targetingPackage: any = await TargetingPackage.findById(config.adset.targetingPackageId)
      if (targetingPackage && targetingPackage.toFacebookTargeting) {
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
    
    // 计算 AdSet 预算
    // CBO 模式: 预算在 Campaign 级别设置，AdSet 不设置预算
    // 非 CBO 模式: 每个 AdSet 必须单独设置预算
    let adsetBudget: number | undefined
    if (config.campaign.budgetOptimization) {
      // CBO 模式，AdSet 不设置预算
      adsetBudget = undefined
      logger.info(`[BulkAd] CBO enabled, campaign budget: ${config.campaign.budget}`)
    } else {
      // 非 CBO 模式，使用 AdSet 预算
      adsetBudget = config.adset.budget || config.campaign.budget
      if (!adsetBudget) {
        throw new Error('非 CBO 模式下必须设置广告组预算')
      }
      logger.info(`[BulkAd] Non-CBO mode, adset budget: ${adsetBudget}`)
    }
    
    // DSA 受益方：使用 Pixel 名称（欧盟合规）
    const dsaBeneficiary = accountConfig.pixelName || accountConfig.pixelId || undefined
    
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
      dailyBudget: adsetBudget,
      startTime: config.adset.startTime?.toISOString?.(),
      endTime: config.adset.endTime?.toISOString?.(),
      promotedObject: accountConfig.pixelId ? {
        pixel_id: accountConfig.pixelId,
        custom_event_type: accountConfig.conversionEvent || 'PURCHASE',
      } : undefined,
      dsa_beneficiary: dsaBeneficiary,
      dsa_payor: dsaBeneficiary,
    })
    
    if (!adsetResult.success) {
      throw new Error(`AdSet creation failed: ${adsetResult.error?.message}`)
    }
    
    const adsetId = adsetResult.id
    // 原子更新 adset 结果
    await updateTaskItemAtomic(taskId, accountId, {
      'items.$.result.adsetIds': [adsetId],
    })
    
    // ==================== 4. 获取创意组和文案包 ====================
    const creativeGroups: any[] = await CreativeGroup.find({
      _id: { $in: config.ad.creativeGroupIds || [] },
    })
    
    const copywritingPackages: any[] = await CopywritingPackage.find({
      _id: { $in: config.ad.copywritingPackageIds || [] },
    })
    
    if (creativeGroups.length === 0) {
      throw new Error('No creative groups found')
    }
    if (copywritingPackages.length === 0) {
      throw new Error('No copywriting packages found')
    }
    
    // ==================== 5. 创建广告 ====================
    // 遍历每个创意组的每个素材，为每个素材创建一条广告
    const adIds: string[] = []
    const adsDetails: Array<{
      adId: string
      adName: string
      adsetId: string
      creativeId: string
      materialId?: string
      effectiveStatus?: string
    }> = []
    let globalAdIndex = 0
    
    for (let cgIndex = 0; cgIndex < creativeGroups.length; cgIndex++) {
      const creativeGroup = creativeGroups[cgIndex]
      const copywriting = copywritingPackages[cgIndex % copywritingPackages.length]
      
      // 获取所有有效素材
      const validMaterials = creativeGroup.materials?.filter((m: any) => 
        m.status === 'uploaded' || m.url
      ) || []
      
      if (validMaterials.length === 0) {
        logger.warn(`[BulkAd] No material found in creative group: ${creativeGroup.name}`)
        continue
      }
      
      logger.info(`[BulkAd] Processing creative group "${creativeGroup.name}" with ${validMaterials.length} materials`)
      
      // 为每个素材创建一条广告
      for (let matIndex = 0; matIndex < validMaterials.length; matIndex++) {
        const material = validMaterials[matIndex]
        globalAdIndex++
        
        // 处理素材引用
        let materialRef: any = {}
        if (material.type === 'image') {
          if (material.facebookImageHash) {
            materialRef.image_hash = material.facebookImageHash
          } else if (material.url) {
            materialRef.image_url = material.url
            logger.info(`[BulkAd] Using image URL directly: ${material.url}`)
          }
        } else if (material.type === 'video') {
          if (material.facebookVideoId) {
            materialRef.video_id = material.facebookVideoId
            if (material.thumbnailUrl) {
              materialRef.thumbnail_url = material.thumbnailUrl
            }
          } else if (material.url) {
            // 视频必须先上传到 Facebook
            logger.info(`[BulkAd] Uploading video ${matIndex + 1}/${validMaterials.length}: ${material.name}`)
            const uploadResult = await uploadVideoFromUrl({
              accountId,
              token,
              videoUrl: material.url,
              title: material.name,
            })
            if (uploadResult.success) {
              materialRef.video_id = uploadResult.id
              materialRef.thumbnail_url = uploadResult.thumbnailUrl || material.thumbnailUrl || material.url
            } else {
              logger.error(`[BulkAd] Video upload failed, skipping: ${uploadResult.error}`)
              continue
            }
          }
        }
        
        // 检查是否有有效素材
        if (!materialRef.image_hash && !materialRef.image_url && !materialRef.video_id) {
          logger.warn(`[BulkAd] No valid material reference for material: ${material.name}, skipping`)
          continue
        }
        
        // 创建 Ad Creative
        const creativeName = `${adsetName}_creative_${globalAdIndex}`
        const linkData: any = {
          link: copywriting.links?.websiteUrl || '',
          message: copywriting.content?.primaryTexts?.[0] || '',
          name: copywriting.content?.headlines?.[0] || '',
          description: copywriting.content?.descriptions?.[0] || '',
          call_to_action: {
            type: copywriting.callToAction || 'SHOP_NOW',
            value: { link: copywriting.links?.websiteUrl || '' },
          },
        }
        
        // 添加显示链接（caption）
        if (copywriting.links?.displayLink) {
          linkData.caption = copywriting.links.displayLink
        }
        
        const objectStorySpec: any = {
          page_id: accountConfig.pageId,
          link_data: linkData,
        }
        
        if (materialRef.image_hash) {
          objectStorySpec.link_data.image_hash = materialRef.image_hash
        } else if (materialRef.image_url) {
          objectStorySpec.link_data.picture = materialRef.image_url
        } else if (materialRef.video_id) {
          // 视频广告：使用 video_data 替代 link_data
          const link = objectStorySpec.link_data.link
          const message = objectStorySpec.link_data.message
          const title = objectStorySpec.link_data.name
          const description = objectStorySpec.link_data.description
          const caption = objectStorySpec.link_data.caption
          
          // 使用用户选择的 CTA，不做强制转换
          const ctaType = copywriting.callToAction || 'SHOP_NOW'
          
          delete objectStorySpec.link_data
          const videoData: any = {
            video_id: materialRef.video_id,
            image_url: materialRef.thumbnail_url,
            message: message,
            link_description: description || title,
            call_to_action: {
              type: ctaType,
              value: { link: link },
            },
          }
          
          // 添加显示链接
          if (caption) {
            videoData.caption = caption
          }
          
          objectStorySpec.video_data = videoData
          logger.info(`[BulkAd] Video creative with thumbnail: ${materialRef.thumbnail_url}`)
        }
        
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
          logger.error(`[BulkAd] Failed to create creative for material ${matIndex + 1}:`, creativeResult.error)
          continue
        }
        
        const creativeId = creativeResult.id
        
        // 创建 Ad
        const adName = generateName(config.ad.nameTemplate, {
          accountName: accountConfig.accountName,
          campaignName,
          adsetName,
          creativeGroupName: creativeGroup.name,
          materialName: material.name || `素材${matIndex + 1}`,
          index: globalAdIndex,
          date: new Date().toISOString().slice(0, 10),
        })
        
        const adResult = await createAd({
          accountId,
          token,
          adsetId,
          creativeId,
          name: adName,
          status: config.ad.status || 'PAUSED',
          urlTags: config.ad.tracking?.urlTags,
        })
        
        if (!adResult.success) {
          logger.error(`[BulkAd] Failed to create ad for material ${matIndex + 1}:`, adResult.error)
          continue
        }
        
        adIds.push(adResult.id)
        
        // 记录广告详情（用于审核状态追踪）
        adsDetails.push({
          adId: adResult.id,
          adName,
          adsetId,
          creativeId,
          materialId: material._id?.toString(),
          effectiveStatus: 'PENDING_REVIEW', // 新创建的广告默认为审核中
        })
        
        logger.info(`[BulkAd] Created ad ${globalAdIndex}: ${adName}`)
      }
    }
    
    // ==================== 6. 完成任务 ====================
    // 如果没有创建任何广告，标记为失败
    const finalStatus = adIds.length > 0 ? 'success' : 'failed'
    const errorInfo = adIds.length === 0 ? [{
      entityType: 'ad',
      errorCode: 'NO_ADS_CREATED',
      errorMessage: '素材创建失败，未能创建任何广告',
      timestamp: new Date(),
    }] : undefined
    
    // 原子更新状态
    const updateData: any = {
      'items.$.status': finalStatus,
      'items.$.result.adIds': adIds,
      'items.$.result.createdCount': adIds.length,
      'items.$.completedAt': new Date(),
      'items.$.ads': adsDetails,  // 保存广告详情用于审核追踪
    }
    if (errorInfo) {
      updateData['items.$.errors'] = errorInfo
    }
    await updateTaskItemAtomic(taskId, accountId, updateData)
    
    // 同步创建 Ad 记录到数据库（用于后续审核状态追踪）
    try {
      const Ad = require('../models/Ad').default
      for (const adDetail of adsDetails) {
        await Ad.findOneAndUpdate(
          { adId: adDetail.adId },
          {
            $set: {
              adId: adDetail.adId,
              name: adDetail.adName,
              adsetId: adDetail.adsetId,
              adsetName,
              campaignId,
              campaignName,
              accountId,
              creativeId: adDetail.creativeId,
              materialId: adDetail.materialId,
              taskId,
              effectiveStatus: 'PENDING_REVIEW',
              status: config.ad.status || 'PAUSED',
            },
          },
          { upsert: true }
        )
      }
      logger.info(`[BulkAd] Saved ${adsDetails.length} ad records for review tracking`)
    } catch (adSaveErr: any) {
      logger.warn(`[BulkAd] Failed to save ad records:`, adSaveErr.message)
    }
    
    // 更新总体进度（原子操作）
    await updateTaskProgressAtomic(taskId)
    
    logger.info(`[BulkAd] Task ${finalStatus} for account ${accountId}: ${adIds.length} ads created`)
    
    return {
      success: true,
      campaignId,
      adsetIds: [adsetId],
      adIds,
    }
    
  } catch (error: any) {
    logger.error(`[BulkAd] Task failed for account ${accountId}:`, error)
    
    // 原子更新失败状态
    await updateTaskItemAtomic(taskId, accountId, {
      'items.$.status': 'failed',
      'items.$.completedAt': new Date(),
      'items.$.errors': [{
        entityType: 'general',
        errorCode: 'EXECUTION_ERROR',
        errorMessage: error.message,
        timestamp: new Date(),
      }],
    })
    
    // 更新总体进度（原子操作）
    await updateTaskProgressAtomic(taskId)
    
    throw error
  }
}

// 更新任务总体进度
function updateTaskProgress(task: any) {
  const items = task.items || []
  // 兼容 'success' 和 'completed' 状态
  const completed = items.filter((i: any) => ['success', 'completed', 'failed', 'skipped'].includes(i.status))
  const successful = items.filter((i: any) => i.status === 'success' || i.status === 'completed')
  const failed = items.filter((i: any) => i.status === 'failed')
  
  let totalAdsCreated = 0
  for (const item of items) {
    if (item.result?.adIds) {
      totalAdsCreated += item.result.adIds.length
    }
  }
  
  task.progress = {
    ...task.progress,
    completedAccounts: completed.length,
    successAccounts: successful.length,
    failedAccounts: failed.length,
    createdAds: totalAdsCreated,
    percentage: items.length > 0 ? Math.round((completed.length / items.length) * 100) : 0,
  }
  
  if (completed.length === items.length) {
    if (failed.length === 0) {
      task.status = 'success'
    } else if (successful.length > 0) {
      task.status = 'partial_success'
    } else {
      task.status = 'failed'
    }
    task.completedAt = new Date()
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
  const task: any = await AdTask.findById(taskId)
  if (!task) {
    throw new Error('Task not found')
  }
  
  if (['success', 'partial_success', 'failed', 'cancelled'].includes(task.status)) {
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
  const task: any = await AdTask.findById(taskId)
  if (!task) {
    throw new Error('Task not found')
  }
  
  const failedItems = task.items.filter((i: any) => i.status === 'failed')
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

/**
 * 重新执行任务（基于原任务配置创建新任务）
 */
export const rerunTask = async (taskId: string) => {
  const originalTask: any = await AdTask.findById(taskId)
  if (!originalTask) {
    throw new Error('Task not found')
  }
  
  if (!originalTask.configSnapshot || !originalTask.configSnapshot.accounts) {
    throw new Error('Task config snapshot not found')
  }
  
  const config = originalTask.configSnapshot
  
  // 创建新任务
  const newTask: any = new AdTask({
    taskType: originalTask.taskType,
    status: 'pending',
    platform: originalTask.platform,
    draftId: originalTask.draftId,
    configSnapshot: config,
    publishSettings: originalTask.publishSettings,
    notes: `重新执行自任务 ${taskId}`,
    items: config.accounts.map((acc: any) => ({
      accountId: acc.accountId,
      accountName: acc.accountName || acc.accountId,
      status: 'pending',
      progress: { current: 0, total: 0, percentage: 0 },
    })),
    progress: {
      totalAccounts: config.accounts.length,
      completedAccounts: 0,
      successAccounts: 0,
      failedAccounts: 0,
      percentage: 0,
    },
  })
  
  await newTask.save()
  logger.info(`[BulkAd] Task rerun created: ${newTask._id} (from ${taskId})`)
  
  // 检查 Redis 是否可用
  const { getRedisClient } = await import('../config/redis')
  const redisAvailable = (() => {
    try {
      return getRedisClient() !== null
    } catch {
      return false
    }
  })()
  
  if (redisAvailable) {
    // Redis 可用，使用队列异步执行
    logger.info(`[BulkAd] Redis available, adding task to queue`)
    const { addBulkAdJobsBatch } = await import('../queue/bulkAd.queue')
    const accountIds = config.accounts.map((acc: any) => acc.accountId)
    
    newTask.status = 'queued'
    newTask.queuedAt = new Date()
    await newTask.save()
    
    await addBulkAdJobsBatch(newTask._id.toString(), accountIds)
    logger.info(`[BulkAd] Task ${newTask._id} queued, ${accountIds.length} accounts`)
  } else {
    // Redis 不可用，直接同步执行
    logger.info(`[BulkAd] Redis unavailable, executing task synchronously`)
    newTask.status = 'processing'
    newTask.startedAt = new Date()
    await newTask.save()
    
    for (const acc of config.accounts) {
      try {
        await executeTaskForAccount(newTask._id.toString(), acc.accountId)
      } catch (err: any) {
        logger.error(`[BulkAd] Failed for account ${acc.accountId}:`, err.message)
      }
    }
  }
  
  return newTask
}

// ==================== 辅助函数 ====================

/**
 * 生成名称（支持模板变量）
 */
function generateName(template: string, variables: Record<string, any>): string {
  let name = template || ''
  
  for (const [key, value] of Object.entries(variables)) {
    name = name.replace(new RegExp(`\\{${key}\\}`, 'gi'), String(value || ''))
  }
  
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
  rerunTask,
}
