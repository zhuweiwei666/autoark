import { Request, Response } from 'express'
import bulkAdService from '../services/bulkAd.service'
import TargetingPackage from '../models/TargetingPackage'
import CopywritingPackage from '../models/CopywritingPackage'
import CreativeGroup from '../models/CreativeGroup'
import {
  searchTargetingInterests,
  searchTargetingLocations,
  getPages,
  getInstagramAccounts,
  getPixels,
  getCustomConversions,
} from '../integration/facebook/bulkCreate.api'
import FbToken from '../models/FbToken'
import logger from '../utils/logger'
import * as oauthService from '../services/facebook.oauth.service'
import { facebookClient } from '../integration/facebook/facebookClient'
import { parseProductUrl } from '../services/productMapping.service'
import { UserRole } from '../models/User'
import mongoose from 'mongoose'
import FacebookApp from '../models/FacebookApp'
import Account from '../models/Account'
import FacebookUser from '../models/FacebookUser'
import * as facebookUserService from '../services/facebookUser.service'
import { buildFacebookAssetDiagnostics } from '../services/facebookAssets.diagnostics.service'
import { writeAuditLog } from '../services/auditLog.service'
import { buildPublicOAuthReadiness } from '../utils/facebookAppReadiness'
import { sanitizeFacebookPages } from '../utils/facebookAssetSanitizer'
import {
  combineFilters,
  sanitizeScopedUpdate,
  scopedOwnerFilter,
  scopedTokenFilter,
} from '../utils/accessControl'
import { getAccountIdsForQuery, normalizeForStorage } from '../utils/accountId'
import { parseLimitedNumber, parsePagination } from '../utils/pagination'

/**
 * 获取资产过滤条件（文案包/定向包/创意组等）
 * - 超级管理员：看所有
 * - 组织管理员：看本组织 + 公共数据
 * - 普通成员：看自己创建的 + 公共数据
 */
const getAssetFilter = (req: Request): any => {
  return scopedOwnerFilter(req)
}

const getControlFilter = (req: Request): any => {
  if (req.user?.role !== UserRole.MEMBER) {
    return getAssetFilter(req)
  }

  return combineFilters(
    getAssetFilter(req),
    scopedOwnerFilter(req, { memberOwnOnly: true }),
  )
}

const getScopedActiveToken = (req: Request) => {
  return FbToken.findOne({ status: 'active', ...scopedTokenFilter(req) }).sort({ updatedAt: -1 })
}

const createHttpError = (message: string, statusCode: number) => {
  const error: any = new Error(message)
  error.statusCode = statusCode
  return error
}

const parseAccountIdParam = (value: any) => normalizeForStorage(Array.isArray(value) ? value[0] : value)

const assertScopedFacebookAccountAccess = async (req: Request, rawAccountId: any) => {
  const accountId = parseAccountIdParam(rawAccountId)
  if (!accountId) {
    throw createHttpError('accountId is required', 400)
  }

  if (req.user?.role === UserRole.SUPER_ADMIN) {
    return accountId
  }

  const account = await Account.findOne(combineFilters(
    {
      channel: 'facebook',
      accountId: { $in: getAccountIdsForQuery([accountId]) },
    },
    getAssetFilter(req),
  ))
    .select('_id accountId')
    .lean()

  if (!account) {
    throw createHttpError(`无权访问广告账户 ${accountId}，请先同步并分配账户资产`, 403)
  }

  return accountId
}

const getScopedTokenForAccount = async (req: Request, rawAccountId: any) => {
  const accountId = await assertScopedFacebookAccountAccess(req, rawAccountId)
  const allTokens = await FbToken.find({ status: 'active', ...scopedTokenFilter(req) })

  for (const token of allTokens) {
    try {
      const account = await facebookClient.get(`/act_${accountId}`, {
        access_token: token.token,
        fields: 'id,name',
      })
      if (account?.id) {
        logger.info(`[BulkAd] Found token for account ${accountId}: ${token.fbUserName}`)
        return { accountId, fbToken: token }
      }
    } catch (error: any) {
      logger.debug(`[BulkAd] Token ${token.fbUserName || token._id} has no access to account ${accountId}`)
    }
  }

  throw createHttpError(`没有找到可访问账户 ${accountId} 的 Facebook Token`, 401)
}

const writeBulkAdAudit = (req: Request, input: {
  action: string
  status?: 'success' | 'failed' | 'warning'
  targetType?: string
  targetId?: string
  summary?: string
  reason?: string
  related?: any
  metadata?: any
}) => writeAuditLog(req, {
  category: 'bulk_ad',
  ...input,
  organizationId: req.user?.organizationId,
  userId: req.user?.userId,
})

const taskAuditMetadata = (task: any) => ({
  taskStatus: task?.status,
  accountCount: task?.progress?.totalAccounts || task?.items?.length || 0,
  successAccounts: task?.progress?.successAccounts || 0,
  failedAccounts: task?.progress?.failedAccounts || 0,
})

const validationAuditMetadata = (validation: any) => {
  const errors = Array.isArray(validation?.errors) ? validation.errors : []
  const warnings = Array.isArray(validation?.warnings) ? validation.warnings : []
  return {
    isValid: Boolean(validation?.isValid),
    errorCount: errors.length,
    warningCount: warnings.length,
    firstError: errors[0]?.message,
    firstErrorField: errors[0]?.field,
    errorFields: errors.map((error: any) => error.field).filter(Boolean).slice(0, 20),
    warningFields: warnings.map((warning: any) => warning.field).filter(Boolean).slice(0, 20),
  }
}

const parseBulkAdOAuthStateForAudit = (state: unknown): {
  autoarkUserId?: string
  organizationId?: string
  error?: string
} => {
  if (typeof state !== 'string') return {}

  try {
    const stateObj = oauthService.parseStateParamWithOptions(state, { requireSignature: true })
    const parts = String(stateObj.originalState || '').split('|')
    if (parts[0] === 'bulk-ad' && parts[1]) {
      return {
        autoarkUserId: parts[1],
        organizationId: parts[2] || undefined,
      }
    }
    return {}
  } catch (error: any) {
    return { error: error.message || 'Invalid OAuth state' }
  }
}

// ==================== 草稿管理 ====================

/**
 * 创建广告草稿
 * POST /api/bulk-ad/drafts
 */
export const createDraft = async (req: Request, res: Response) => {
  try {
    // Debug: 打印接收到的账户配置
    logger.info('[BulkAd] createDraft received accounts:', JSON.stringify(req.body.accounts?.map((a: any) => ({
      accountId: a.accountId,
      pixelId: a.pixelId,
      pixelName: a.pixelName
    }))))
    
    // 添加创建者信息
    const draftData = {
      ...req.body,
      createdBy: req.user?.userId,
      organizationId: req.user?.organizationId,
    }
    const draft = await bulkAdService.createDraft(draftData, req.user?.userId)
    res.json({ success: true, data: draft })
  } catch (error: any) {
    logger.error('[BulkAd] Create draft failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 更新广告草稿
 * PUT /api/bulk-ad/drafts/:id
 */
export const updateDraft = async (req: Request, res: Response) => {
  try {
    const draft = await bulkAdService.updateDraft(
      req.params.id,
      sanitizeScopedUpdate(req.body),
      req.user?.userId,
      getControlFilter(req),
    )
    res.json({ success: true, data: draft })
  } catch (error: any) {
    logger.error('[BulkAd] Update draft failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 获取草稿详情
 * GET /api/bulk-ad/drafts/:id
 */
export const getDraft = async (req: Request, res: Response) => {
  try {
    const draft = await bulkAdService.getDraft(req.params.id, getAssetFilter(req))
    res.json({ success: true, data: draft })
  } catch (error: any) {
    logger.error('[BulkAd] Get draft failed:', error)
    res.status(404).json({ success: false, error: error.message })
  }
}

/**
 * 获取草稿列表
 * GET /api/bulk-ad/drafts
 */
export const getDraftList = async (req: Request, res: Response) => {
  try {
    // 传递用户过滤条件
    const userFilter = getAssetFilter(req)
    const result = await bulkAdService.getDraftList(req.query, userFilter)
    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[BulkAd] Get draft list failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 删除草稿
 * DELETE /api/bulk-ad/drafts/:id
 */
export const deleteDraft = async (req: Request, res: Response) => {
  try {
    await bulkAdService.deleteDraft(req.params.id, getControlFilter(req))
    res.json({ success: true })
  } catch (error: any) {
    logger.error('[BulkAd] Delete draft failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 验证草稿
 * POST /api/bulk-ad/drafts/:id/validate
 */
export const validateDraft = async (req: Request, res: Response) => {
  try {
    const validation = await bulkAdService.validateDraft(req.params.id, getAssetFilter(req))
    const firstError = validation.errors?.[0]
    await writeBulkAdAudit(req, {
      action: 'bulk_ad.draft_validate',
      status: validation.isValid ? (validation.warnings?.length ? 'warning' : 'success') : 'failed',
      targetType: 'ad_draft',
      targetId: req.params.id,
      summary: validation.isValid ? '批量广告草稿预检通过' : '批量广告草稿预检未通过',
      reason: firstError?.message,
      metadata: validationAuditMetadata(validation),
    })
    res.json({ success: true, data: validation })
  } catch (error: any) {
    logger.error('[BulkAd] Validate draft failed:', error)
    await writeBulkAdAudit(req, {
      action: 'bulk_ad.draft_validate',
      status: 'failed',
      targetType: 'ad_draft',
      targetId: req.params.id,
      summary: '批量广告草稿预检失败',
      reason: error.message,
      metadata: {
        errorCode: error.code,
        details: error.details,
      },
    })
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 发布草稿
 * POST /api/bulk-ad/drafts/:id/publish
 */
export const publishDraft = async (req: Request, res: Response) => {
  try {
    const task = await bulkAdService.publishDraft(req.params.id, req.user?.userId, getControlFilter(req))
    await writeBulkAdAudit(req, {
      action: 'bulk_ad.publish',
      targetType: 'ad_task',
      targetId: String(task._id),
      summary: `发布批量广告任务：${task.name || task._id}`,
      related: { draftId: req.params.id },
      metadata: taskAuditMetadata(task),
    })
    res.json({ success: true, data: task })
  } catch (error: any) {
    logger.error('[BulkAd] Publish draft failed:', error)
    await writeBulkAdAudit(req, {
      action: 'bulk_ad.publish',
      status: 'failed',
      targetType: 'ad_draft',
      targetId: req.params.id,
      summary: '发布批量广告任务失败',
      reason: error.message,
      metadata: {
        errorCode: error.code,
        details: error.details,
      },
    })
    res.status(error.statusCode || 400).json({
      success: false,
      error: error.message,
      errorCode: error.code,
      details: error.details,
    })
  }
}

// ==================== 任务管理 ====================

/**
 * 获取任务详情
 * GET /api/bulk-ad/tasks/:id
 */
export const getTask = async (req: Request, res: Response) => {
  try {
    const task = await bulkAdService.getTask(req.params.id, getAssetFilter(req))
    res.json({ success: true, data: task })
  } catch (error: any) {
    logger.error('[BulkAd] Get task failed:', error)
    res.status(404).json({ success: false, error: error.message })
  }
}

/**
 * 获取任务运营诊断
 * GET /api/bulk-ad/tasks/:id/diagnostics
 */
export const getTaskDiagnostics = async (req: Request, res: Response) => {
  try {
    const diagnostics = await bulkAdService.getTaskDiagnostics(req.params.id, getAssetFilter(req))
    res.json({ success: true, data: diagnostics })
  } catch (error: any) {
    logger.error('[BulkAd] Get task diagnostics failed:', error)
    res.status(404).json({ success: false, error: error.message })
  }
}

/**
 * 获取任务排障包
 * GET /api/bulk-ad/tasks/:id/support-package
 */
export const getTaskSupportPackage = async (req: Request, res: Response) => {
  try {
    const supportPackage = await bulkAdService.getTaskSupportPackage(req.params.id, getAssetFilter(req))
    const firstBucket = supportPackage.diagnostics?.buckets?.[0]
    await writeBulkAdAudit(req, {
      action: 'bulk_ad.task_support_package.generate',
      targetType: 'ad_task',
      targetId: req.params.id,
      summary: `生成任务排障包：${supportPackage.task?.name || req.params.id}`,
      metadata: {
        supportId: supportPackage.supportId,
        taskStatus: supportPackage.task?.status,
        health: supportPackage.diagnostics?.health,
        buildRef: supportPackage.system?.build?.ref,
        buildCommit: supportPackage.system?.build?.commit,
        buildShortCommit: supportPackage.system?.build?.shortCommit,
        buildDeployedAt: supportPackage.system?.build?.deployedAt,
        totalErrors: supportPackage.diagnostics?.summary?.totalErrors || 0,
        retryableErrors: supportPackage.diagnostics?.summary?.retryableErrors || 0,
        blockedErrors: supportPackage.diagnostics?.summary?.blockedErrors || 0,
        failedAccounts: supportPackage.diagnostics?.summary?.failedAccounts || 0,
        failedItemCount: supportPackage.failedItems?.length || 0,
        topErrorCode: firstBucket?.errorCode,
      },
    })
    res.json({ success: true, data: supportPackage })
  } catch (error: any) {
    logger.error('[BulkAd] Get task support package failed:', error)
    await writeBulkAdAudit(req, {
      action: 'bulk_ad.task_support_package.generate',
      status: 'failed',
      targetType: 'ad_task',
      targetId: req.params.id,
      summary: '生成任务排障包失败',
      reason: error.message,
    })
    res.status(error.message === 'Task not found' ? 404 : 500).json({ success: false, error: error.message })
  }
}

/**
 * 获取任务列表
 * GET /api/bulk-ad/tasks
 */
export const getTaskList = async (req: Request, res: Response) => {
  try {
    // 传递用户过滤条件
    const userFilter = getAssetFilter(req)
    const result = await bulkAdService.getTaskList(req.query, userFilter)
    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[BulkAd] Get task list failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 取消任务
 * POST /api/bulk-ad/tasks/:id/cancel
 */
export const cancelTask = async (req: Request, res: Response) => {
  try {
    const task = await bulkAdService.cancelTask(req.params.id, getControlFilter(req))
    await writeBulkAdAudit(req, {
      action: 'bulk_ad.cancel',
      targetType: 'ad_task',
      targetId: req.params.id,
      summary: `取消批量广告任务：${task.name || req.params.id}`,
      metadata: taskAuditMetadata(task),
    })
    res.json({ success: true, data: task })
  } catch (error: any) {
    logger.error('[BulkAd] Cancel task failed:', error)
    await writeBulkAdAudit(req, {
      action: 'bulk_ad.cancel',
      status: 'failed',
      targetType: 'ad_task',
      targetId: req.params.id,
      summary: '取消批量广告任务失败',
      reason: error.message,
    })
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 重试失败的任务项
 * POST /api/bulk-ad/tasks/:id/retry
 */
export const retryTask = async (req: Request, res: Response) => {
  try {
    const task = await bulkAdService.retryFailedItems(req.params.id, getControlFilter(req))
    await writeBulkAdAudit(req, {
      action: 'bulk_ad.retry',
      targetType: 'ad_task',
      targetId: req.params.id,
      summary: `重试失败任务项：${task.name || req.params.id}`,
      metadata: taskAuditMetadata(task),
    })
    res.json({ success: true, data: task })
  } catch (error: any) {
    logger.error('[BulkAd] Retry task failed:', error)
    await writeBulkAdAudit(req, {
      action: 'bulk_ad.retry',
      status: 'failed',
      targetType: 'ad_task',
      targetId: req.params.id,
      summary: '重试批量广告任务失败',
      reason: error.message,
    })
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 重新执行任务（基于原任务配置创建新任务）
 * POST /api/bulk-ad/tasks/:id/rerun
 * @body multiplier 执行倍率（可选，默认1，最大20）
 */
export const rerunTask = async (req: Request, res: Response) => {
  try {
    const multiplier = parseInt(req.body.multiplier) || 1
    const userId = req.user?.userId
    const newTasks = await bulkAdService.rerunTask(req.params.id, multiplier, userId, getControlFilter(req))
    await writeBulkAdAudit(req, {
      action: 'bulk_ad.rerun',
      targetType: 'ad_task',
      targetId: req.params.id,
      summary: `重新执行批量广告任务：${req.params.id}`,
      related: {
        newTaskIds: newTasks.map((task: any) => String(task._id)),
      },
      metadata: {
        multiplier,
        createdTaskCount: newTasks.length,
      },
    })
    res.json({ success: true, data: newTasks })
  } catch (error: any) {
    logger.error('[BulkAd] Rerun task failed:', error)
    await writeBulkAdAudit(req, {
      action: 'bulk_ad.rerun',
      status: 'failed',
      targetType: 'ad_task',
      targetId: req.params.id,
      summary: '重新执行批量广告任务失败',
      reason: error.message,
      metadata: {
        multiplier: req.body.multiplier,
        errorCode: error.code,
        details: error.details,
      },
    })
    res.status(error.statusCode || 400).json({
      success: false,
      error: error.message,
      errorCode: error.code,
      details: error.details,
    })
  }
}

// ==================== 定向包管理 ====================

/**
 * 创建定向包
 * POST /api/bulk-ad/targeting-packages
 */
export const createTargetingPackage = async (req: Request, res: Response) => {
  try {
    const data = { 
      ...req.body, 
      organizationId: req.user?.organizationId,
      createdBy: req.user?.userId, // 记录创建者
    }
    const pkg = new TargetingPackage(data)
    await pkg.save()
    res.json({ success: true, data: pkg })
  } catch (error: any) {
    logger.error('[BulkAd] Create targeting package failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 更新定向包
 * PUT /api/bulk-ad/targeting-packages/:id
 */
export const updateTargetingPackage = async (req: Request, res: Response) => {
  try {
    const pkg = await TargetingPackage.findOneAndUpdate(
      combineFilters({ _id: req.params.id }, getControlFilter(req)),
      sanitizeScopedUpdate(req.body),
      { new: true }
    )
    if (!pkg) {
      return res.status(404).json({ success: false, error: 'Targeting package not found' })
    }
    res.json({ success: true, data: pkg })
  } catch (error: any) {
    logger.error('[BulkAd] Update targeting package failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 获取定向包列表
 * GET /api/bulk-ad/targeting-packages
 */
export const getTargetingPackageList = async (req: Request, res: Response) => {
  try {
    const { accountId, platform } = req.query
    const { page, pageSize, skip } = parsePagination(req.query)
    
    // 使用更严格的用户级别过滤
    const filter: any = { ...getAssetFilter(req) }
    if (accountId) filter.accountId = accountId
    if (platform) filter.platform = platform
    
    const [list, total] = await Promise.all([
      TargetingPackage.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      TargetingPackage.countDocuments(filter),
    ])
    
    res.json({ success: true, data: { list, total, page, pageSize } })
  } catch (error: any) {
    logger.error('[BulkAd] Get targeting package list failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 删除定向包
 * DELETE /api/bulk-ad/targeting-packages/:id
 */
export const deleteTargetingPackage = async (req: Request, res: Response) => {
  try {
    const result = await TargetingPackage.deleteOne(combineFilters({ _id: req.params.id }, getControlFilter(req)))
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Targeting package not found' })
    }
    res.json({ success: true })
  } catch (error: any) {
    logger.error('[BulkAd] Delete targeting package failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

// ==================== 文案包管理 ====================

/**
 * 创建文案包
 * POST /api/bulk-ad/copywriting-packages
 */
export const createCopywritingPackage = async (req: Request, res: Response) => {
  try {
    const data = { 
      ...req.body, 
      organizationId: req.user?.organizationId,
      createdBy: req.user?.userId, // 记录创建者
    }
    
    // 自动从 websiteUrl 提取产品信息
    if (data.links?.websiteUrl && !data.product?.name) {
      const parsed = parseProductUrl(data.links.websiteUrl)
      if (parsed) {
        data.product = {
          name: parsed.productName || parsed.domain,
          identifier: parsed.productIdentifier,
          domain: parsed.domain,
          autoExtracted: true,
        }
        logger.info(`[BulkAd] Auto-extracted product: ${data.product.name} from ${data.links.websiteUrl}`)
      }
    }
    
    const pkg = new CopywritingPackage(data)
    await pkg.save()
    res.json({ success: true, data: pkg })
  } catch (error: any) {
    logger.error('[BulkAd] Create copywriting package failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 更新文案包
 * PUT /api/bulk-ad/copywriting-packages/:id
 */
export const updateCopywritingPackage = async (req: Request, res: Response) => {
  try {
    const data = { ...req.body }
    
    // 如果更新了 websiteUrl，自动重新提取产品信息
    if (data.links?.websiteUrl) {
      const existingPkg = await CopywritingPackage.findOne(
        combineFilters({ _id: req.params.id }, getControlFilter(req)),
      )
      const urlChanged = existingPkg?.links?.websiteUrl !== data.links.websiteUrl
      const productNotManual = !existingPkg?.product || existingPkg.product.autoExtracted !== false
      
      if (urlChanged && productNotManual) {
        const parsed = parseProductUrl(data.links.websiteUrl)
        if (parsed) {
          data.product = {
            name: parsed.productName || parsed.domain,
            identifier: parsed.productIdentifier,
            domain: parsed.domain,
            autoExtracted: true,
          }
          logger.info(`[BulkAd] Auto-updated product: ${data.product.name} from ${data.links.websiteUrl}`)
        }
      }
    }
    
    const pkg = await CopywritingPackage.findOneAndUpdate(
      combineFilters({ _id: req.params.id }, getControlFilter(req)),
      sanitizeScopedUpdate(data),
      { new: true }
    )
    if (!pkg) {
      return res.status(404).json({ success: false, error: 'Copywriting package not found' })
    }
    res.json({ success: true, data: pkg })
  } catch (error: any) {
    logger.error('[BulkAd] Update copywriting package failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 获取文案包列表
 * GET /api/bulk-ad/copywriting-packages
 */
export const getCopywritingPackageList = async (req: Request, res: Response) => {
  try {
    const { accountId, platform } = req.query
    const { page, pageSize, skip } = parsePagination(req.query)
    
    // 使用更严格的用户级别过滤
    const filter: any = { ...getAssetFilter(req) }
    if (accountId) filter.accountId = accountId
    if (platform) filter.platform = platform
    
    const [list, total] = await Promise.all([
      CopywritingPackage.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      CopywritingPackage.countDocuments(filter),
    ])
    
    res.json({ success: true, data: { list, total, page, pageSize } })
  } catch (error: any) {
    logger.error('[BulkAd] Get copywriting package list failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 删除文案包
 * DELETE /api/bulk-ad/copywriting-packages/:id
 */
export const deleteCopywritingPackage = async (req: Request, res: Response) => {
  try {
    const result = await CopywritingPackage.deleteOne(combineFilters({ _id: req.params.id }, getControlFilter(req)))
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Copywriting package not found' })
    }
    res.json({ success: true })
  } catch (error: any) {
    logger.error('[BulkAd] Delete copywriting package failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 批量解析所有文案包的产品信息
 * POST /api/bulk-ad/copywriting-packages/parse-products
 */
export const parseAllCopywritingProducts = async (req: Request, res: Response) => {
  try {
    const packages = await CopywritingPackage.find(combineFilters(getControlFilter(req), {
      'links.websiteUrl': { $exists: true, $ne: '' },
      $or: [
        { 'product.name': { $exists: false } },
        { 'product.name': '' },
        { 'product.name': null },
      ]
    }))
    
    let updated = 0
    let failed = 0
    const results: Array<{ id: string; name: string; productName?: string; error?: string }> = []
    
    for (const pkg of packages) {
      try {
        const urlString = pkg.links?.websiteUrl
        if (!urlString) continue
        
        const parsed = parseProductUrl(urlString)
        if (parsed) {
          pkg.product = {
            name: parsed.productName || parsed.domain,
            identifier: parsed.productIdentifier,
            domain: parsed.domain,
            autoExtracted: true,
          }
          await pkg.save()
          updated++
          results.push({ id: pkg._id.toString(), name: pkg.name, productName: parsed.productName })
        }
      } catch (error: any) {
        failed++
        results.push({ id: pkg._id.toString(), name: pkg.name, error: error.message })
      }
    }
    
    res.json({ 
      success: true, 
      data: { 
        total: packages.length,
        updated, 
        failed,
        results 
      } 
    })
  } catch (error: any) {
    logger.error('[BulkAd] Parse all copywriting products failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ==================== 创意组管理 ====================

/**
 * 创建创意组
 * POST /api/bulk-ad/creative-groups
 */
export const createCreativeGroup = async (req: Request, res: Response) => {
  try {
    const data = { 
      ...req.body, 
      organizationId: req.user?.organizationId,
      createdBy: req.user?.userId, // 记录创建者
    }
    const group = new CreativeGroup(data)
    await group.save()
    res.json({ success: true, data: group })
  } catch (error: any) {
    logger.error('[BulkAd] Create creative group failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 更新创意组
 * PUT /api/bulk-ad/creative-groups/:id
 */
export const updateCreativeGroup = async (req: Request, res: Response) => {
  try {
    const group = await CreativeGroup.findOneAndUpdate(
      combineFilters({ _id: req.params.id }, getControlFilter(req)),
      sanitizeScopedUpdate(req.body),
      { new: true }
    )
    if (!group) {
      return res.status(404).json({ success: false, error: 'Creative group not found' })
    }
    res.json({ success: true, data: group })
  } catch (error: any) {
    logger.error('[BulkAd] Update creative group failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 获取创意组列表
 * GET /api/bulk-ad/creative-groups
 */
export const getCreativeGroupList = async (req: Request, res: Response) => {
  try {
    const { accountId, platform } = req.query
    const { page, pageSize, skip } = parsePagination(req.query)
    
    // 使用更严格的用户级别过滤
    const filter: any = { ...getAssetFilter(req) }
    if (accountId) filter.accountId = accountId
    if (platform) filter.platform = platform
    
    const [list, total] = await Promise.all([
      CreativeGroup.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      CreativeGroup.countDocuments(filter),
    ])
    
    res.json({ success: true, data: { list, total, page, pageSize } })
  } catch (error: any) {
    logger.error('[BulkAd] Get creative group list failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 删除创意组
 * DELETE /api/bulk-ad/creative-groups/:id
 */
export const deleteCreativeGroup = async (req: Request, res: Response) => {
  try {
    const result = await CreativeGroup.deleteOne(combineFilters({ _id: req.params.id }, getControlFilter(req)))
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Creative group not found' })
    }
    res.json({ success: true })
  } catch (error: any) {
    logger.error('[BulkAd] Delete creative group failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 添加素材到创意组
 * POST /api/bulk-ad/creative-groups/:id/materials
 */
export const addMaterial = async (req: Request, res: Response) => {
  try {
    const group = await CreativeGroup.findOne(combineFilters({ _id: req.params.id }, getControlFilter(req)))
    if (!group) {
      return res.status(404).json({ success: false, error: 'Creative group not found' })
    }
    
    group.materials.push(req.body)
    await group.save()
    
    res.json({ success: true, data: group })
  } catch (error: any) {
    logger.error('[BulkAd] Add material failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 删除创意组中的素材
 * DELETE /api/bulk-ad/creative-groups/:id/materials/:materialId
 */
export const removeMaterial = async (req: Request, res: Response) => {
  try {
    const group: any = await CreativeGroup.findOne(combineFilters({ _id: req.params.id }, getControlFilter(req)))
    if (!group) {
      return res.status(404).json({ success: false, error: 'Creative group not found' })
    }
    
    group.materials = group.materials.filter(
      (m: any) => m._id.toString() !== req.params.materialId
    )
    await group.save()
    
    res.json({ success: true, data: group })
  } catch (error: any) {
    logger.error('[BulkAd] Remove material failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

// ==================== Facebook 搜索 API ====================

/**
 * 搜索兴趣标签
 * GET /api/bulk-ad/search/interests
 */
export const searchInterests = async (req: Request, res: Response) => {
  try {
    const { q, type = 'adinterest', limit = 50 } = req.query
    
    const fbToken = await getScopedActiveToken(req)
    if (!fbToken) {
      return res.status(400).json({ success: false, error: 'No active Facebook token' })
    }
    
    const result = await searchTargetingInterests({
      token: fbToken.token,
      query: q as string,
      type: type as string,
      limit: parseLimitedNumber(limit, 50, 100),
    })
    
    res.json({ success: true, data: result.data })
  } catch (error: any) {
    logger.error('[BulkAd] Search interests failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 搜索地理位置
 * GET /api/bulk-ad/search/locations
 */
export const searchLocations = async (req: Request, res: Response) => {
  try {
    const { q, type = 'adgeolocation', limit = 50 } = req.query
    
    const fbToken = await getScopedActiveToken(req)
    if (!fbToken) {
      return res.status(400).json({ success: false, error: 'No active Facebook token' })
    }
    
    const result = await searchTargetingLocations({
      token: fbToken.token,
      query: q as string,
      type: type as string,
      limit: parseLimitedNumber(limit, 50, 100),
    })
    
    res.json({ success: true, data: result.data })
  } catch (error: any) {
    logger.error('[BulkAd] Search locations failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取 Facebook Pages
 * GET /api/bulk-ad/facebook/pages
 */
export const getFacebookPages = async (req: Request, res: Response) => {
  try {
    const { accountId } = req.query
    const { accountId: scopedAccountId, fbToken } = await getScopedTokenForAccount(req, accountId)
    const result = await getPages(scopedAccountId, fbToken.token)
    res.json({ success: true, data: result.data })
  } catch (error: any) {
    logger.error('[BulkAd] Get Facebook pages failed:', error)
    res.status(error.statusCode || 500).json({ success: false, error: error.message })
  }
}

/**
 * 获取 Instagram 账户
 * GET /api/bulk-ad/facebook/instagram-accounts
 */
export const getFacebookInstagramAccounts = async (req: Request, res: Response) => {
  try {
    const { pageId } = req.query
    if (!pageId) {
      return res.status(400).json({ success: false, error: 'pageId is required' })
    }
    
    const fbToken = await getScopedActiveToken(req)
    if (!fbToken) {
      return res.status(400).json({ success: false, error: 'No active Facebook token' })
    }
    
    const result = await getInstagramAccounts(pageId as string, fbToken.token)
    res.json({ success: true, data: result.data })
  } catch (error: any) {
    logger.error('[BulkAd] Get Instagram accounts failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取 Pixels
 * GET /api/bulk-ad/facebook/pixels
 */
export const getFacebookPixels = async (req: Request, res: Response) => {
  try {
    const { accountId } = req.query
    const { accountId: scopedAccountId, fbToken } = await getScopedTokenForAccount(req, accountId)
    const result = await getPixels(scopedAccountId, fbToken.token)
    res.json({ success: true, data: result.data })
  } catch (error: any) {
    logger.error('[BulkAd] Get Facebook pixels failed:', error)
    res.status(error.statusCode || 500).json({ success: false, error: error.message })
  }
}

/**
 * 获取自定义转化事件
 * GET /api/bulk-ad/facebook/custom-conversions
 */
export const getFacebookCustomConversions = async (req: Request, res: Response) => {
  try {
    const { accountId } = req.query
    const { accountId: scopedAccountId, fbToken } = await getScopedTokenForAccount(req, accountId)
    const result = await getCustomConversions(scopedAccountId, fbToken.token)
    res.json({ success: true, data: result.data })
  } catch (error: any) {
    logger.error('[BulkAd] Get custom conversions failed:', error)
    res.status(error.statusCode || 500).json({ success: false, error: error.message })
  }
}

// ==================== 独立 OAuth 授权 ====================

/**
 * 获取可用的 Facebook Apps 列表
 * GET /api/bulk-ad/auth/apps
 */
export const getAvailableApps = async (req: Request, res: Response) => {
  try {
    const apps = await oauthService.getAvailableApps()
    res.json({ success: true, data: apps })
  } catch (error: any) {
    logger.error('[BulkAd] Get available apps failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取 Facebook 登录 URL（批量广告专用）
 * GET /api/bulk-ad/auth/login-url
 * 
 * 用户隔离：用户创建的 App 就是他要用的 App
 * 如果用户没有创建过 App，提示去 App 管理页面添加
 */
export const getAuthLoginUrl = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: '未认证' })
    }
    
    // ⚠️ 登录链接必须每次实时生成：禁止任何缓存/304（浏览器/代理可能会缓存）
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
    // 让 ETag 每次不同，避免命中 If-None-Match -> 304
    res.setHeader('ETag', `W/"bulkad-login-${Date.now()}-${Math.random().toString(16).slice(2)}"`)
    
    // 批量广告 OAuth：默认使用“系统 App 池”生成登录链接（避免用户自建 App 被 Facebook 临时禁用导致无法登录）
    // 如需强制使用用户自建 App，可传参：?useUserApp=true
    let appId: string | undefined
    const useUserApp = String(req.query.useUserApp || '').toLowerCase() === 'true'
    if (useUserApp) {
      const hasGlobalBusinessLoginConfig = Boolean(
        process.env.FACEBOOK_BUSINESS_LOGIN_CONFIG_ID || process.env.FACEBOOK_CONFIG_ID,
      )
      const userApp = await FacebookApp.findOne({
        createdBy: req.user.userId,
        status: 'active',
        'validation.isValid': true,
        'config.enabledForBulkAds': { $ne: false },
        'compliance.publicOauthReady': true,
        'compliance.appMode': 'live',
        'compliance.businessVerification': 'verified',
        'compliance.appReview': 'approved',
        ...(!hasGlobalBusinessLoginConfig ? {
          'config.businessLoginConfigId': { $exists: true, $nin: ['', null] },
        } : {}),
      }).sort({ createdAt: -1 })
      if (userApp?.appId) {
        appId = userApp.appId
        logger.info(`[BulkAd] OAuth using user's App (forced): ${userApp.appName} (${appId})`)
      } else {
        logger.warn(`[BulkAd] OAuth requested user's App but none valid; falling back to default App pool`)
      }
    } else {
      logger.info(`[BulkAd] OAuth using default App pool (useUserApp=false)`)
    }
    
    // 将 AutoArk 用户 ID 编码到 state 参数中
    // 格式: bulk-ad|userId|organizationId
    const orgId = req.user.organizationId ? String(req.user.organizationId) : ''
    const stateData = `bulk-ad|${req.user.userId}|${orgId}`
    const redirectUri = oauthService.getFacebookBulkAdRedirectUri()
    const loginUrl = await oauthService.getFacebookLoginUrl(stateData, appId, {
      businessLogin: true,
      redirectUri,
    })
    
    // 解析 client_id（便于排查 Facebook Login “功能不可用”属于哪个 App）
    let clientIdInUrl: string | null = null
    let configIdInUrl: string | null = null
    let scopeInUrl: string | null = null
    try {
      const parsedLoginUrl = new URL(loginUrl)
      clientIdInUrl = parsedLoginUrl.searchParams.get('client_id')
      configIdInUrl = parsedLoginUrl.searchParams.get('config_id')
      scopeInUrl = parsedLoginUrl.searchParams.get('scope')
    } catch {}
    const authorizationMode = configIdInUrl ? 'business_login' : 'scope_oauth'
    const diagnostics: string[] = []
    const addDiagnostic = (message: string) => {
      if (!diagnostics.includes(message)) diagnostics.push(message)
    }
    if (!configIdInUrl) {
      addDiagnostic('未使用 Facebook Login for Business config_id，当前为 scope OAuth 兜底模式。')
    }
    if (!clientIdInUrl) {
      addDiagnostic('登录链接中未解析到 client_id，请检查 Facebook App 配置。')
    }
    let publicOauthReady: boolean | undefined
    let publicOauthGapCodes: string[] = []
    let publicOauthGapCount = 0
    if (clientIdInUrl) {
      const selectedApp: any = await FacebookApp.findOne({ appId: clientIdInUrl })
      if (selectedApp) {
        const readiness = buildPublicOAuthReadiness(selectedApp)
        publicOauthReady = readiness.ready
        publicOauthGapCodes = readiness.gaps.map((gap) => gap.code)
        publicOauthGapCount = readiness.gaps.length
        if (!readiness.ready) {
          readiness.gaps.slice(0, 4).forEach((gap) => {
            addDiagnostic(`${gap.label}：${gap.detail}`)
          })
          if (readiness.gaps.length > 4) {
            addDiagnostic(`当前 Facebook App 还有 ${readiness.gaps.length - 4} 项 Public OAuth 缺口，请到 App 管理页查看完整诊断。`)
          }
        }
      } else {
        addDiagnostic('未在 App 管理中找到登录链接使用的 client_id，请检查 Facebook App 池配置。')
      }
    }
    
    logger.info(
      `[BulkAd] Generated login URL for user ${req.user.userId}, App: ${appId || 'default-pool'}, client_id: ${
        clientIdInUrl || 'unknown'
      }, mode: ${authorizationMode}`,
    )

    await writeBulkAdAudit(req, {
      action: 'bulk_ad.facebook_login_url',
      targetType: 'facebook_app',
      targetId: clientIdInUrl || appId || 'default-pool',
      summary: `生成 Facebook 授权链接：${authorizationMode === 'business_login' ? 'Business Login' : 'Scope OAuth'}`,
      metadata: {
        clientId: clientIdInUrl,
        redirectUri,
        authorizationMode,
        businessLoginConfigured: Boolean(configIdInUrl),
        scopeFallback: Boolean(scopeInUrl),
        publicOauthReady,
        publicOauthGapCount,
        publicOauthGapCodes,
        usingDefaultApp: !appId,
        diagnostics,
      },
    })
    
    res.json({
      success: true,
      data: {
        loginUrl,
        usingDefaultApp: !appId,
        clientId: clientIdInUrl,
        redirectUri,
        authorizationMode,
        businessLoginConfigured: Boolean(configIdInUrl),
        scopeFallback: Boolean(scopeInUrl),
        publicOauthReady,
        publicOauthGapCount,
        publicOauthGapCodes,
        diagnostics,
        serverTime: new Date().toISOString(),
      },
    })
  } catch (error: any) {
    logger.error('[BulkAd] Get login URL failed:', error)
    if (req.user) {
      await writeBulkAdAudit(req, {
        action: 'bulk_ad.facebook_login_url',
        status: 'failed',
        targetType: 'facebook_app',
        summary: '生成 Facebook 授权链接失败',
        reason: error.message,
      })
    }
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * OAuth 回调处理（批量广告专用）
 * GET /api/bulk-ad/auth/callback
 * 
 * 用户隔离：从 state 参数解析 AutoArk 用户 ID，并将 token 与该用户关联
 */
export const handleAuthCallback = async (req: Request, res: Response) => {
  let stateAudit: ReturnType<typeof parseBulkAdOAuthStateForAudit> = {}
  try {
    const { code, error, error_description, state } = req.query
    stateAudit = parseBulkAdOAuthStateForAudit(state)
    
    if (error) {
      logger.error('[BulkAd OAuth] Facebook returned error:', { error, error_description })
      await writeAuditLog(req, {
        category: 'bulk_ad',
        action: 'bulk_ad.facebook_oauth_callback',
        status: 'failed',
        userId: stateAudit.autoarkUserId,
        organizationId: stateAudit.organizationId,
        targetType: 'facebook_oauth',
        summary: 'Facebook 授权回调失败',
        reason: String(error_description || error),
        metadata: {
          facebookError: error,
          facebookErrorDescription: error_description,
          stateParseError: stateAudit.error,
        },
      })
      return res.redirect(
        `/oauth/callback?oauth_error=${encodeURIComponent(error_description as string || error as string)}`
      )
    }
    
    if (!code) {
      await writeAuditLog(req, {
        category: 'bulk_ad',
        action: 'bulk_ad.facebook_oauth_callback',
        status: 'failed',
        userId: stateAudit.autoarkUserId,
        organizationId: stateAudit.organizationId,
        targetType: 'facebook_oauth',
        summary: 'Facebook 授权回调缺少 code',
        reason: 'No authorization code received',
        metadata: {
          stateParseError: stateAudit.error,
        },
      })
      return res.redirect('/oauth/callback?oauth_error=No authorization code received')
    }
    
    // 解析 state 参数获取 AutoArk 用户信息。
    // 批量广告授权必须携带服务端 HMAC 签名 state，防止 token 被写成未绑定用户/组织的全局授权。
    let autoarkUserId: string | undefined
    let organizationId: string | undefined
    try {
      if (!state) {
        throw new Error('Missing OAuth state')
      }
      const stateObj = oauthService.parseStateParamWithOptions(state as string, { requireSignature: true })
      const originalState = stateObj.originalState || ''
      const parts = originalState.split('|')
      if (parts[0] !== 'bulk-ad' || !parts[1]) {
        throw new Error('Invalid OAuth state')
      }
      autoarkUserId = parts[1]
      organizationId = parts[2] || undefined
      logger.info(`[BulkAd OAuth] Binding token to AutoArk user: ${autoarkUserId}`)
    } catch (e: any) {
      logger.warn('[BulkAd OAuth] Invalid signed state:', e)
      await writeAuditLog(req, {
        category: 'bulk_ad',
        action: 'bulk_ad.facebook_oauth_callback',
        status: 'failed',
        targetType: 'facebook_oauth',
        summary: 'Facebook 授权回调 state 无效',
        reason: 'Invalid OAuth state',
        metadata: {
          stateParseError: stateAudit.error || e.message || 'Invalid OAuth state',
        },
      })
      return res.redirect('/oauth/callback?oauth_error=Invalid OAuth state')
    }
    
    // 处理 OAuth 回调（传递 state 以解析使用的 App）
    const result = await oauthService.handleOAuthCallback(code as string, state as string | undefined)
    
    // 更新 Token 的 userId 和 organizationId（关联到 AutoArk 用户）
    if (autoarkUserId) {
      await FbToken.findByIdAndUpdate(result.tokenId, {
        userId: autoarkUserId,
        ...(organizationId && { organizationId }),
      })
      logger.info(`[BulkAd OAuth] Token ${result.tokenId} bound to user ${autoarkUserId}`)
    }

    await writeAuditLog(req, {
      category: 'bulk_ad',
      action: 'bulk_ad.facebook_oauth_callback',
      status: 'success',
      userId: autoarkUserId,
      organizationId,
      targetType: 'facebook_token',
      targetId: result.tokenId,
      summary: `Facebook 授权成功：${result.fbUserName || result.fbUserId}`,
      metadata: {
        tokenId: result.tokenId,
        fbUserId: result.fbUserId,
        fbUserName: result.fbUserName,
      },
    })
    
    // 异步同步 Facebook 用户资产
    facebookUserService.syncFacebookUserAssets(
      result.fbUserId, 
      result.accessToken,
      result.tokenId,
      organizationId,
    ).catch((err: any) => {
      logger.error('[BulkAd OAuth] Failed to sync Facebook user assets:', err)
    })
    
    // 重定向到专门的 OAuth 回调页面
    const params = new URLSearchParams({
      oauth_success: 'true',
      token_id: result.tokenId,
      fb_user_id: result.fbUserId,
      fb_user_name: encodeURIComponent(result.fbUserName || ''),
    })
    
    res.redirect(`/oauth/callback?${params.toString()}`)
  } catch (error: any) {
    logger.error('[BulkAd OAuth] Callback handler failed:', error)
    await writeAuditLog(req, {
      category: 'bulk_ad',
      action: 'bulk_ad.facebook_oauth_callback',
      status: 'failed',
      userId: stateAudit.autoarkUserId,
      organizationId: stateAudit.organizationId,
      targetType: 'facebook_oauth',
      summary: 'Facebook 授权回调处理失败',
      reason: error.message || 'OAuth callback failed',
      metadata: {
        stateParseError: stateAudit.error,
      },
    })
    res.redirect(`/oauth/callback?oauth_error=${encodeURIComponent(error.message || 'OAuth callback failed')}`)
  }
}

/**
 * 检查授权状态（用户隔离）
 * GET /api/bulk-ad/auth/status
 * 
 * 每个 AutoArk 用户看到自己绑定的 Facebook 账号
 * 超级管理员可以看到所有 token
 */
export const getAuthStatus = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: '未认证' })
    }
    
    const orgObjectId =
      req.user.organizationId && mongoose.Types.ObjectId.isValid(req.user.organizationId)
        ? new mongoose.Types.ObjectId(req.user.organizationId)
        : undefined
    
    // 构建查询条件
    const tokenQuery: any = { status: 'active', ...scopedTokenFilter(req) }
    
    // 超级管理员看到所有，普通用户只看到自己绑定的或本组织的
    if (req.user.role === UserRole.SUPER_ADMIN) {
      // 超级管理员：获取所有活跃 token，优先显示自己绑定的
      const userToken = await FbToken.findOne({ 
        status: 'active', 
        userId: req.user.userId 
      }).sort({ updatedAt: -1 })
      
      if (userToken) {
        return res.json({
          success: true,
          data: {
            authorized: true,
            tokenId: userToken._id,
            fbUserId: userToken.fbUserId,
            fbUserName: userToken.fbUserName,
            expiresAt: userToken.expiresAt,
            isOwnToken: true,
          },
        })
      }
      
      // 如果超级管理员没有绑定自己的 token，显示第一个可用的
      const anyToken: any = await FbToken.findOne({ status: 'active' }).sort({ updatedAt: -1 })
      if (anyToken) {
        return res.json({
          success: true,
          data: {
            authorized: true,
            tokenId: anyToken._id,
            fbUserId: anyToken.fbUserId,
            fbUserName: anyToken.fbUserName,
            expiresAt: anyToken.expiresAt,
            isOwnToken: false,
            message: '当前使用的是其他用户的授权，建议绑定自己的 Facebook 账号',
          },
        })
      }
    } else {
      Object.assign(tokenQuery, scopedTokenFilter(req))
    }
    
    const fbToken: any = await FbToken.findOne(tokenQuery).sort({ updatedAt: -1 })
    
    if (!fbToken) {
      return res.json({
        success: true,
        data: {
          authorized: false,
          message: '请先绑定您的 Facebook 账号',
        },
      })
    }
    
    res.json({
      success: true,
      data: {
        authorized: true,
        tokenId: fbToken._id,
        fbUserId: fbToken.fbUserId,
        fbUserName: fbToken.fbUserName,
        expiresAt: fbToken.expiresAt,
        isOwnToken: fbToken.userId === req.user.userId,
      },
    })
  } catch (error: any) {
    logger.error('[BulkAd] Get auth status failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取当前授权资产诊断
 * GET /api/bulk-ad/auth/diagnostics
 */
export const getAuthDiagnostics = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: '未认证' })
    }

    const tokenQuery: any = { status: 'active', ...scopedTokenFilter(req) }
    const tokens: any[] = await FbToken.find(tokenQuery)
      .select('_id fbUserId fbUserName expiresAt lastCheckedAt updatedAt')
      .sort({ updatedAt: -1 })
      .lean()

    let users: any[] = []
    if (tokens.length > 0) {
      const tokenIds = tokens.map(token => token._id).filter(Boolean)
      const fbUserIds = tokens.map(token => token.fbUserId).filter(Boolean)
      const userFilters: any[] = tokenIds.length > 0 ? [{ tokenId: { $in: tokenIds } }] : []
      if (fbUserIds.length > 0) {
        userFilters.push({
          fbUserId: { $in: fbUserIds },
          ...(req.user.organizationId && { organizationId: req.user.organizationId }),
        })
      }
      users = await FacebookUser.find({ $or: userFilters }).lean()
    }

    res.json({
      success: true,
      data: buildFacebookAssetDiagnostics({ tokens, users }),
    })
  } catch (error: any) {
    logger.error('[BulkAd] Get auth diagnostics failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取当前授权用户的广告账户列表
 * GET /api/bulk-ad/auth/ad-accounts
 * 需要认证，并根据用户组织进行权限过滤
 * 
 * 超级管理员：获取所有 token 下的所有账户
 * 普通用户：只获取本组织 token 下的账户
 */
export const getAuthAdAccounts = async (req: Request, res: Response) => {
  try {
    // 检查用户认证
    if (!req.user) {
      return res.status(401).json({ success: false, error: '未认证' })
    }

    // 构建 token 查询条件（根据组织隔离）
    const tokenQuery: any = { status: 'active', ...scopedTokenFilter(req) }

    // 查找所有符合条件的 token（超级管理员看到所有，普通用户只看到本组织）
    const fbTokens: any[] = await FbToken.find(tokenQuery).sort({ updatedAt: -1 })
    if (!fbTokens || fbTokens.length === 0) {
      return res.status(401).json({ success: false, error: '未找到可用的 Facebook 授权账号' })
    }
    
    // 合并所有 token 下的广告账户
    const allAccounts: any[] = []
    const seenAccountIds = new Set<string>()
    
    for (const fbToken of fbTokens) {
      try {
        const result = await facebookClient.get('/me/adaccounts', {
          access_token: fbToken.token,
          fields: 'id,account_id,name,account_status,currency,timezone_name,amount_spent,balance',
          limit: 100,
        })
        
        for (const acc of (result.data || [])) {
          // 避免重复账户
          if (!seenAccountIds.has(acc.account_id)) {
            seenAccountIds.add(acc.account_id)
            allAccounts.push({
              id: acc.id,
              account_id: acc.account_id,
              name: acc.name,
              account_status: acc.account_status,
              currency: acc.currency,
              timezone_name: acc.timezone_name,
              amount_spent: acc.amount_spent,
              balance: acc.balance,
              // 额外信息：标记来源 token
              _tokenOwner: fbToken.fbUserName || fbToken.optimizer || 'unknown',
            })
          }
        }
      } catch (tokenError: any) {
        logger.warn(`[BulkAd] Failed to get accounts for token ${fbToken.fbUserName}: ${tokenError.message}`)
        // 继续处理其他 token
      }
    }
    
    // 根据 Account 模型中的 organizationId 进行过滤（仅非超级管理员）
    let filteredAccounts = allAccounts
    if (req.user.role !== UserRole.SUPER_ADMIN && req.user.organizationId) {
      const allowedAccounts = await Account.find({
        accountId: { $in: Array.from(seenAccountIds) },
        organizationId: req.user.organizationId,
      }).select('accountId').lean()
      const allowedAccountIds = new Set(allowedAccounts.map((acc: any) => acc.accountId))
      filteredAccounts = allAccounts.filter((acc: any) => allowedAccountIds.has(acc.account_id))
    }
    
    res.json({ success: true, data: filteredAccounts })
  } catch (error: any) {
    logger.error('[BulkAd] Get ad accounts failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取账户的 Pages
 * GET /api/bulk-ad/auth/pages
 * 
 * 策略：
 * 1. 先尝试从广告账户获取 promote_pages（BM 分配的主页）
 * 2. 如果没有结果，回退获取用户有广告权限的所有主页
 */
export const getAuthPages = async (req: Request, res: Response) => {
  try {
    const { accountId } = req.query
    const { accountId: scopedAccountId, fbToken } = await getScopedTokenForAccount(req, accountId)
    
    // 1. 从广告账户获取 promote_pages（BM 分配的主页）
    let pages: any[] = []
    try {
      const promoteResult = await facebookClient.get(`/act_${scopedAccountId}/promote_pages`, {
        access_token: fbToken.token,
        fields: 'id,name,picture',
        limit: 100,
      })
      pages = promoteResult.data || []
      logger.info(`[BulkAd] Found ${pages.length} promote_pages for account ${scopedAccountId}`)
    } catch (e: any) {
      logger.warn(`[BulkAd] Failed to get promote_pages for ${scopedAccountId}: ${e.message}`)
    }
    
    // 2. 如果没有 promote_pages，回退获取用户管理的主页
    if (pages.length === 0) {
      logger.info(`[BulkAd] No promote_pages for ${scopedAccountId}, falling back to user pages`)
      try {
        // 使用找到的 token 获取该用户管理的所有主页
        const userPagesResult = await facebookClient.get(`/${fbToken.fbUserId}/accounts`, {
          access_token: fbToken.token,
          fields: 'id,name,picture',
          limit: 100,
        })
        pages = (userPagesResult.data || []).filter((p: any) => p.id && p.name)
        logger.info(`[BulkAd] Found ${pages.length} user pages for account ${accountId}`)
      } catch (e: any) {
        logger.warn(`[BulkAd] Failed to get user pages: ${e.message}`)
      }
    }
    
    // 如果还是没有主页，返回警告
    if (pages.length === 0) {
      return res.json({ 
        success: true, 
        data: [],
        warning: '此账户没有可用的 Facebook 主页。请确保您有主页管理权限。'
      })
    }
    
    res.json({ success: true, data: sanitizeFacebookPages(pages) })
  } catch (error: any) {
    logger.error('[BulkAd] Get pages failed:', error)
    res.status(error.statusCode || 500).json({ success: false, error: error.message })
  }
}

/**
 * 获取账户的 Pixels
 * GET /api/bulk-ad/auth/pixels
 */
export const getAuthPixels = async (req: Request, res: Response) => {
  try {
    const { accountId } = req.query
    const { accountId: scopedAccountId, fbToken } = await getScopedTokenForAccount(req, accountId)
    
    const result = await facebookClient.get(`/act_${scopedAccountId}/adspixels`, {
      access_token: fbToken.token,
      fields: 'id,name,code,last_fired_time',
      limit: 100,
    })
    
    res.json({ success: true, data: result.data || [] })
  } catch (error: any) {
    logger.error('[BulkAd] Get pixels failed:', error)
    res.status(error.statusCode || 500).json({ success: false, error: error.message })
  }
}

/**
 * 获取缓存的所有 Pixels（预加载，速度快）
 * GET /api/bulk-ad/auth/cached-pixels
 * 
 * 超级管理员：合并所有 token 的 Pixels
 * 普通用户：只获取本组织 token 的 Pixels
 */
export const getCachedPixels = async (req: Request, res: Response) => {
  try {
    const orgObjectId =
      req.user?.organizationId && mongoose.Types.ObjectId.isValid(req.user.organizationId)
        ? new mongoose.Types.ObjectId(req.user.organizationId)
        : undefined
    
    // 构建 token 查询条件（根据组织隔离）
    const tokenQuery: any = { status: 'active', ...scopedTokenFilter(req) }
    
    const fbTokens: any[] = await FbToken.find(tokenQuery).sort({ updatedAt: -1 })
    if (!fbTokens || fbTokens.length === 0) {
      return res.status(401).json({ success: false, error: '未授权 Facebook 账号' })
    }
    
    // 合并所有 token 的 Pixels
    const pixelMap = new Map<string, any>()
    
    for (const fbToken of fbTokens) {
      try {
        const pixels = await facebookUserService.getCachedPixels(fbToken.fbUserId, {
          tokenId: fbToken._id?.toString(),
          organizationId: fbToken.organizationId,
        })
        
        for (const p of pixels) {
          const existing = pixelMap.get(p.pixelId)
          if (existing) {
            // 合并账户列表（去重）
            const existingAccountIds = new Set(existing.accounts.map((a: any) => a.accountId))
            for (const acc of (p.accounts || [])) {
              if (!existingAccountIds.has(acc.accountId)) {
                existing.accounts.push(acc)
              }
            }
          } else {
            pixelMap.set(p.pixelId, {
              pixelId: p.pixelId,
              name: p.name,
              accounts: [...(p.accounts || [])],
            })
          }
        }
      } catch (tokenError: any) {
        logger.warn(`[BulkAd] Failed to get pixels for token ${fbToken.fbUserName}:`, tokenError.message)
      }
    }
    
    // 转换格式以兼容前端
    const formattedPixels = Array.from(pixelMap.values()).map((p: any) => ({
      id: p.pixelId,
      name: p.name,
      accounts: p.accounts || [],
    }))
    
    logger.info(`[BulkAd] Merged ${formattedPixels.length} pixels from ${fbTokens.length} tokens`)
    
    res.json({ success: true, data: formattedPixels })
  } catch (error: any) {
    logger.error('[BulkAd] Get cached pixels failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取缓存的 Catalogs（预加载，速度快）
 * GET /api/bulk-ad/auth/cached-catalogs
 */
export const getCachedCatalogs = async (req: Request, res: Response) => {
  try {
    const orgObjectId =
      req.user?.organizationId && mongoose.Types.ObjectId.isValid(req.user.organizationId)
        ? new mongoose.Types.ObjectId(req.user.organizationId)
        : undefined

    const tokenQuery: any = { status: 'active', ...scopedTokenFilter(req) }

    const fbTokens: any[] = await FbToken.find(tokenQuery).sort({ updatedAt: -1 })
    if (!fbTokens || fbTokens.length === 0) {
      return res.status(401).json({ success: false, error: '未授权 Facebook 账号' })
    }

    const catalogMap = new Map<string, any>()

    for (const fbToken of fbTokens) {
      try {
        const catalogs = await facebookUserService.getCachedCatalogs(fbToken.fbUserId, {
          tokenId: fbToken._id?.toString(),
          organizationId: fbToken.organizationId,
        })
        for (const c of catalogs) {
          if (!catalogMap.has(c.catalogId)) {
            catalogMap.set(c.catalogId, {
              id: c.catalogId,
              name: c.name,
              business: c.business,
            })
          }
        }
      } catch (e: any) {
        logger.warn(`[BulkAd] Failed to get catalogs for token ${fbToken.fbUserName}:`, e?.message || e)
      }
    }

    res.json({ success: true, data: Array.from(catalogMap.values()) })
  } catch (error: any) {
    logger.error('[BulkAd] Get cached catalogs failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取 Pixel 同步状态
 * GET /api/bulk-ad/auth/sync-status
 */
export const getPixelSyncStatus = async (req: Request, res: Response) => {
  try {
    const fbToken: any = await getScopedActiveToken(req)
    if (!fbToken) {
      return res.status(401).json({ success: false, error: '未授权 Facebook 账号' })
    }
    
    const status = await facebookUserService.getSyncStatus(fbToken.fbUserId, {
      tokenId: fbToken._id?.toString(),
      organizationId: fbToken.organizationId,
    })
    
    res.json({ success: true, data: status })
  } catch (error: any) {
    logger.error('[BulkAd] Get sync status failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 手动触发重新同步
 * POST /api/bulk-ad/auth/resync
 */
export const resyncFacebookAssets = async (req: Request, res: Response) => {
  try {
    const fbToken: any = await getScopedActiveToken(req)
    if (!fbToken) {
      return res.status(401).json({ success: false, error: '未授权 Facebook 账号' })
    }
    
    // 异步执行同步
    facebookUserService.syncFacebookUserAssets(
      fbToken.fbUserId, 
      fbToken.token,
      fbToken._id.toString(),
      fbToken.organizationId,
    ).catch((err: any) => {
      logger.error('[BulkAd] Resync failed:', err)
    })

    await writeBulkAdAudit(req, {
      action: 'bulk_ad.facebook_resync',
      targetType: 'facebook_user',
      targetId: fbToken.fbUserId,
      summary: `手动触发 Facebook 资产重同步：${fbToken.fbUserName || fbToken.fbUserId}`,
      metadata: {
        tokenId: String(fbToken._id),
      },
    })
    
    res.json({ success: true, message: '同步已开始，请稍后刷新' })
  } catch (error: any) {
    logger.error('[BulkAd] Resync trigger failed:', error)
    await writeBulkAdAudit(req, {
      action: 'bulk_ad.facebook_resync',
      status: 'failed',
      summary: '手动触发 Facebook 资产重同步失败',
      reason: error.message,
    })
    res.status(500).json({ success: false, error: error.message })
  }
}

// ==================== 广告审核状态 ====================

/**
 * 获取任务的广告审核状态
 * GET /api/bulk-ad/tasks/:id/review-status
 */
export const getTaskReviewStatus = async (req: Request, res: Response) => {
  try {
    await bulkAdService.getTask(req.params.id, getAssetFilter(req))
    const { getTaskReviewDetails } = await import('../services/adReview.service')
    const result = await getTaskReviewDetails(req.params.id)
    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[BulkAd] Get task review status failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 检查/刷新任务的广告审核状态
 * POST /api/bulk-ad/tasks/:id/check-review
 */
export const checkTaskReviewStatus = async (req: Request, res: Response) => {
  try {
    await bulkAdService.getTask(req.params.id, getAssetFilter(req))
    const { updateTaskAdsReviewStatus } = await import('../services/adReview.service')
    const result = await updateTaskAdsReviewStatus(req.params.id)
    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[BulkAd] Check task review status failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取所有 AutoArk 广告审核概览
 * GET /api/bulk-ad/ads/review-overview
 */
export const getAdsReviewOverview = async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== UserRole.SUPER_ADMIN) {
      return res.status(403).json({ success: false, error: 'Forbidden' })
    }
    const { getReviewOverview } = await import('../services/adReview.service')
    const result = await getReviewOverview()
    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[BulkAd] Get ads review overview failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 刷新所有 AutoArk 广告的审核状态
 * POST /api/bulk-ad/ads/refresh-review
 */
export const refreshAdsReviewStatus = async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== UserRole.SUPER_ADMIN) {
      return res.status(403).json({ success: false, error: 'Forbidden' })
    }
    const { refreshAllReviewStatus } = await import('../services/adReview.service')
    const result = await refreshAllReviewStatus()
    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[BulkAd] Refresh ads review status failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}
