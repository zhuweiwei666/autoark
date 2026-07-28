import mongoose from 'mongoose'
import AdDraft from '../models/AdDraft'
import AdTask from '../models/AdTask'
import TargetingPackage from '../models/TargetingPackage'
import CopywritingPackage from '../models/CopywritingPackage'
import CreativeGroup from '../models/CreativeGroup'
import FbToken from '../models/FbToken'
import FacebookUser from '../models/FacebookUser'
import AdMaterialMapping from '../models/AdMaterialMapping'
import OpsLog from '../models/OpsLog'
import logger from '../utils/logger'
import User, { UserRole } from '../models/User'
import Account from '../models/Account'
import Ad from '../models/Ad'
import ReplicaRun from '../models/ReplicaRun'
import AiExecutionMandate from '../models/AiExecutionMandate'
import PlaybookVersion from '../models/PlaybookVersion'
import {
  createCampaign,
  createAdSet,
  createAdCreative,
  createAd,
  uploadImageFromUrl,
  uploadVideoFromUrl,
} from '../integration/facebook/bulkCreate.api'
import { facebookClient } from '../integration/facebook/facebookClient'
import { combineFilters } from '../utils/accessControl'
import { getAccountIdsForQuery, normalizeForStorage } from '../utils/accountId'
import {
  canonicalJson,
  frozenCopywritingSnapshot,
  frozenCreativeSnapshot,
} from '../utils/aiExecutionSnapshot'
import { getBuildInfo } from '../utils/buildInfo'
import { parseLimitedNumber, parsePagination, pickAllowedString } from '../utils/pagination'
import {
  buildTaskOperationalDiagnostics,
  diagnoseBulkAdError,
  enrichTaskDiagnostics,
  normalizeTaskErrors,
} from './bulkAd.diagnostics'
import { assertBulkAdPublishAllowed } from './commercial.service'
import {
  recordOperationalCredentialFailure,
  resolvePublishingCredential,
} from './metaBusinessCredential.service'
import { resolveExecutionMandate } from './optimizerExecution.service'

/**
 * 批量广告创建服务
 * 处理广告草稿的创建、验证、发布和任务管理
 */

// ==================== 草稿管理 ====================

const MIN_BUDGET = 1
const DEFAULT_DIAGNOSTIC_TASK_SCAN_LIMIT = 1000
const MAX_DIAGNOSTIC_TASK_SCAN_LIMIT = 5000
const CLICK_ATTRIBUTION_WINDOWS = [1, 7, 28]
const OPTIONAL_ATTRIBUTION_WINDOWS = [0, 1]
const DRAFT_LIST_STATUSES = ['draft', 'ready', 'published', 'failed'] as const
const TASK_LIST_STATUSES = ['pending', 'queued', 'processing', 'success', 'partial_success', 'failed', 'cancelled'] as const
const TASK_LIST_TYPES = ['BULK_AD_CREATE', 'BULK_AD_UPDATE', 'BULK_AD_DELETE', 'MATERIAL_UPLOAD'] as const
const TASK_LIST_PLATFORMS = ['facebook', 'tiktok', 'google'] as const

const hasAiExecutionLineage = (origin: any) =>
  Boolean(
    origin?.replicaRunId ||
      origin?.mandateId ||
      origin?.playbookVersionId ||
      origin?.statusLockedToPaused,
  )

const normalizeObjectIdList = (values: any[] = []) => {
  const unique = Array.from(new Set(values.map(value => value?.toString()).filter(Boolean)))
  return {
    valid: unique.filter(value => mongoose.Types.ObjectId.isValid(value)),
    invalid: unique.filter(value => !mongoose.Types.ObjectId.isValid(value)),
  }
}

/**
 * Resolve the resource scope from the publisher's actual role.
 *
 * Tasks created by a super admin intentionally have no organization boundary.
 * The old executor inferred scope from task.organizationId/createdBy instead,
 * which made a super-admin task unable to read legacy assets owned by another
 * historical user or organization.
 */
const resolveTaskAssetAccessFilter = async (task: any): Promise<Record<string, any>> => {
  if (task.organizationId) {
    return { organizationId: task.organizationId }
  }

  if (!task.createdBy) {
    return {}
  }

  let creator: any = null
  try {
    creator = await User.findById(task.createdBy)
      .select('role organizationId')
      .lean()
  } catch {
    // Keep historical tasks runnable if the creator record was removed.
  }

  if (creator?.role === UserRole.SUPER_ADMIN) {
    return {}
  }

  if (creator?.organizationId) {
    return { organizationId: creator.organizationId }
  }

  return { createdBy: task.createdBy }
}

const createBulkAssetAccessError = (
  assetType: string,
  requestedIds: string[],
  foundIds: string[] = [],
) => {
  const missingIds = requestedIds.filter(id => !foundIds.includes(id))
  const error: any = new Error(
    `${assetType} not found or inaccessible: ${missingIds.join(', ') || requestedIds.join(', ')}`,
  )
  error.errorCode = 'BULK_ASSET_NOT_FOUND'
  error.entityType = 'asset'
  error.source = 'validation'
  error.retryable = false
  return error
}

const hasUsableMaterial = (material: any) => {
  if (!material) return false
  if (material.type === 'image') {
    return Boolean(material.facebookImageHash || material.url)
  }
  if (material.type === 'video') {
    return Boolean(material.facebookVideoId || material.url)
  }
  return false
}

const isHttpUrl = (value: any) => {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const parsed = new URL(value.trim())
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

type MetaCreativeOptimizationMode = 'off' | 'auto_crop' | 'advantage_plus'

const getMetaCreativeOptimizationMode = (
  creativeGroup: any,
): MetaCreativeOptimizationMode | undefined => {
  const configuredMode = creativeGroup?.config?.metaCreativeOptimizationMode
  if (configuredMode === 'off' || configuredMode === 'auto_crop' || configuredMode === 'advantage_plus') {
    return configuredMode
  }

  const configured = creativeGroup?.config?.metaAutoCrop
  if (typeof configured !== 'boolean') return undefined
  return configured ? 'auto_crop' : 'off'
}

const buildMetaCreativeOptimizationSpec = (
  mode: MetaCreativeOptimizationMode | undefined,
) => {
  if (!mode) return undefined
  if (mode === 'advantage_plus') {
    return {
      creative_features_spec: {
        advantage_plus_creative: { enroll_status: 'OPT_IN' },
        standard_enhancements: { enroll_status: 'OPT_IN' },
        video_auto_crop: { enroll_status: 'OPT_IN' },
        adapt_to_placement: { enroll_status: 'OPT_IN' },
      },
    }
  }

  return {
    creative_features_spec: {
      video_auto_crop: {
        enroll_status: mode === 'auto_crop' ? 'OPT_IN' : 'OPT_OUT',
      },
    },
  }
}

const isAllowedAttributionWindow = (value: any, allowedValues: number[]) => {
  const next = Number(value)
  return Number.isInteger(next) && allowedValues.includes(next)
}

const normalizeAdsetMultiplierInput = (value: any) => (
  value === undefined || value === null || value === '' ? 1 : value
)

const isAllowedAdsetMultiplier = (value: any) => {
  const next = Number(normalizeAdsetMultiplierInput(value))
  return Number.isInteger(next) && next >= 1 && next <= 10
}

const normalizeAdsetMultiplier = (value: any) => (
  parseLimitedNumber(normalizeAdsetMultiplierInput(value), 1, 10)
)

const normalizeRerunMultiplier = (value: any) => parseLimitedNumber(value, 1, 20)

const normalizeAttributionWindow = (value: any, fallback: number, allowedValues: number[]) => {
  const next = Number(value)
  return Number.isInteger(next) && allowedValues.includes(next) ? next : fallback
}

const buildAttributionSpec = (attributionCfg: any) => {
  if (!attributionCfg) return undefined

  const clickWindow = normalizeAttributionWindow(attributionCfg.clickWindow, 1, CLICK_ATTRIBUTION_WINDOWS)
  const viewWindow = normalizeAttributionWindow(attributionCfg.viewWindow, 0, OPTIONAL_ATTRIBUTION_WINDOWS)
  const engagedViewWindow = normalizeAttributionWindow(
    attributionCfg.engagedViewWindow,
    0,
    OPTIONAL_ATTRIBUTION_WINDOWS,
  )

  return [
    {
      event_type: 'CLICK_THROUGH',
      window_days: clickWindow,
    },
    ...(viewWindow > 0
      ? [
          {
            event_type: 'VIEW_THROUGH',
            window_days: viewWindow,
          },
        ]
      : []),
    ...(engagedViewWindow > 0
      ? [
          {
            event_type: 'ENGAGED_VIDEO_VIEW',
            window_days: engagedViewWindow,
          },
        ]
      : []),
  ]
}

const buildDraftValidationFailureDetails = (validation: any) => {
  const errors = Array.isArray(validation?.errors) ? validation.errors : []
  const warnings = Array.isArray(validation?.warnings) ? validation.warnings : []
  return {
    errorCount: errors.length,
    warningCount: warnings.length,
    firstError: errors[0]
      ? {
        field: errors[0].field,
        message: errors[0].message,
      }
      : undefined,
    errorFields: errors.map((error: any) => error.field).filter(Boolean).slice(0, 20),
    errors: errors.slice(0, 10).map((error: any) => ({
      field: error.field,
      message: error.message,
      severity: error.severity || 'error',
    })),
    warnings: warnings.slice(0, 10).map((warning: any) => ({
      field: warning.field,
      message: warning.message,
      severity: warning.severity || 'warning',
    })),
  }
}

const createDraftValidationFailure = (validation: any) => {
  const details = buildDraftValidationFailureDetails(validation)
  const firstMessage = details.firstError?.message || '请按预检结果修正草稿配置'
  const error: any = new Error(`草稿预检未通过：${firstMessage}`)
  error.code = 'DRAFT_VALIDATION_FAILED'
  error.statusCode = 422
  error.details = details
  return error
}

const FACEBOOK_STEP_ENTITY_TYPES: Record<string, string> = {
  campaign: 'campaign',
  adset: 'adset',
  creative: 'creative',
  ad: 'ad',
  image_upload: 'creative',
  video_upload: 'creative',
}

const createFacebookStepError = (step: string, errorPayload: any, fallbackMessage: string) => {
  const payload = errorPayload && typeof errorPayload === 'object'
    ? errorPayload
    : { message: errorPayload ? String(errorPayload) : fallbackMessage }
  const message = payload.userMsg || payload.userTitle || payload.message || fallbackMessage
  const rawMessage = payload.message && payload.message !== message ? ` (${payload.message})` : ''
  const error: any = new Error(`${step} failed: ${message}${rawMessage}`)
  error.entityType = FACEBOOK_STEP_ENTITY_TYPES[step] || 'general'
  error.code = payload.code
  error.subcode = payload.subcode
  error.userMessage = payload.userMsg || payload.userTitle
  error.operatorMessage = [
    payload.message ? `原始错误：${payload.message}` : undefined,
    payload.userMsg || payload.userTitle ? `用户提示：${payload.userMsg || payload.userTitle}` : undefined,
  ].filter(Boolean).join('；') || undefined
  error.response = {
    error: {
      code: payload.code,
      error_subcode: payload.subcode,
      message: payload.message || message,
      error_user_msg: payload.userMsg,
      error_user_title: payload.userTitle,
      type: payload.type,
    },
  }
  error.details = {
    step,
    error: error.response.error,
  }
  return error
}

const diagnoseFacebookStepError = (step: string, errorPayload: any, fallbackMessage: string) => diagnoseBulkAdError(
  createFacebookStepError(step, errorPayload, fallbackMessage),
  { entityType: FACEBOOK_STEP_ENTITY_TYPES[step] || 'general' },
)

const emptyFacebookAssetSnapshot = (tokenCount = 0, selectedTokenId?: string) => ({
  tokenCount,
  selectedTokenId,
  hasCachedAssets: false,
  pageAccountPairs: new Set<string>(),
  pixelAccountPairs: new Set<string>(),
  adAccountStatuses: new Map<string, number>(),
})

const buildFacebookAssetSnapshot = async (draft: any) => {
  if (draft.metaCredentialId && draft.organizationId) {
    const requestedAccounts = (draft.accounts || [])
      .map((account: any) => normalizeForStorage(account.accountId))
      .filter(Boolean)
    const requestedPages = (draft.accounts || [])
      .map((account: any) => account.pageId && String(account.pageId))
      .filter(Boolean)
    const requestedPixels = (draft.accounts || [])
      .map((account: any) => account.pixelId && String(account.pixelId))
      .filter(Boolean)
    const resolved = await resolvePublishingCredential({
      organizationId: draft.organizationId,
      credentialId: draft.metaCredentialId,
      adAccountIds: requestedAccounts,
      pageIds: requestedPages,
      pixelIds: requestedPixels,
    })
    if (!resolved) {
      return emptyFacebookAssetSnapshot(0, String(draft.metaCredentialId))
    }

    const snapshot = emptyFacebookAssetSnapshot(
      1,
      String(resolved.credential._id),
    )
    snapshot.hasCachedAssets = true
    requestedAccounts.forEach((accountId: string) => {
      snapshot.adAccountStatuses.set(accountId, 1)
    })
    ;(draft.accounts || []).forEach((account: any) => {
      const accountId = normalizeForStorage(account.accountId)
      if (!accountId) return
      if (account.pageId) {
        snapshot.pageAccountPairs.add(`${account.pageId}:${accountId}`)
      }
      if (account.pixelId) {
        snapshot.pixelAccountPairs.add(`${account.pixelId}:${accountId}`)
      }
    })
    return snapshot
  }

  const tokenOwnerUserId = draft.facebookTokenOwnerUserId || draft.createdBy
  const tokenAccessFilter = draft.organizationId
    ? {
        organizationId: draft.organizationId,
        ...(tokenOwnerUserId ? { userId: tokenOwnerUserId } : {}),
      }
    : tokenOwnerUserId
      ? { userId: tokenOwnerUserId }
      : null

  if (!tokenAccessFilter) {
    return emptyFacebookAssetSnapshot()
  }

  const draftTokenId = draft.facebookTokenId?.toString()
  const tokens: any[] = await FbToken.find({
    status: 'active',
    ...tokenAccessFilter,
    ...(draftTokenId ? { _id: draftTokenId } : {}),
  })
    .select('_id fbUserId organizationId')
    .lean()

  if (tokens.length === 0) {
    return emptyFacebookAssetSnapshot(0, draftTokenId)
  }

  const tokenIds = tokens.map((token) => token._id).filter(Boolean)
  const activeTokenIds = new Set(tokenIds.map((tokenId) => String(tokenId)))
  const tokenIdentityById = new Map(
    tokens.map(token => [String(token._id), token.fbUserId ? String(token.fbUserId) : undefined]),
  )
  const tokenSnapshotFilters = tokens.map(token => ({
    tokenId: token._id,
    organizationId: token.organizationId || null,
    ...(token.fbUserId ? { fbUserId: token.fbUserId } : {}),
  }))
  const users: any[] = await FacebookUser.find(
    tokenSnapshotFilters.length === 1
      ? tokenSnapshotFilters[0]
      : { $or: tokenSnapshotFilters },
  ).lean()

  const requestedPageAccounts = new Map<string, Set<string>>()

  for (const account of draft.accounts || []) {
    const accountId = normalizeForStorage(account.accountId)
    if (!account.pageId || !accountId) continue

    const pageId = String(account.pageId)
    const accountIds = requestedPageAccounts.get(pageId) || new Set<string>()
    accountIds.add(accountId)
    requestedPageAccounts.set(pageId, accountIds)
  }

  const snapshots = new Map<string, ReturnType<typeof emptyFacebookAssetSnapshot>>()
  for (const tokenId of activeTokenIds) {
    snapshots.set(tokenId, emptyFacebookAssetSnapshot(1, tokenId))
  }

  const completedUsersByToken = new Map<string, any[]>()
  for (const user of users) {
    const userTokenId = user.tokenId?.toString()
    if (
      !userTokenId ||
      !activeTokenIds.has(userTokenId) ||
      (tokenIdentityById.get(userTokenId) &&
        String(user.fbUserId) !== tokenIdentityById.get(userTokenId)) ||
      user.syncStatus !== 'completed'
    ) {
      continue
    }

    const tokenUsers = completedUsersByToken.get(userTokenId) || []
    tokenUsers.push(user)
    completedUsersByToken.set(userTokenId, tokenUsers)
  }

  for (const [userTokenId, tokenUsers] of completedUsersByToken) {
    // One token represents one personal authorization snapshot. Refuse
    // ambiguous duplicate rows instead of unioning their asset permissions.
    if (tokenUsers.length !== 1) continue
    const user = tokenUsers[0]
    const snapshot = snapshots.get(userTokenId)
    if (!snapshot) continue
    snapshot.hasCachedAssets = true

    const userAccountIds = new Set<string>()
    for (const account of user.adAccounts || []) {
      const accountId = normalizeForStorage(account.accountId)
      if (accountId) {
        userAccountIds.add(accountId)
      }
      if (accountId && account.status !== undefined) {
        snapshot.adAccountStatuses.set(accountId, account.status)
      }
    }

    for (const page of user.pages || []) {
      for (const account of page.accounts || []) {
        const accountId = normalizeForStorage(account.accountId)
        if (page.pageId && accountId) {
          snapshot.pageAccountPairs.add(`${page.pageId}:${accountId}`)
        }
      }

      // /me/accounts returns user-managed Pages with a Page access token but no
      // ad-account relation. Treat them as usable only with accounts from the
      // same completed Facebook authorization snapshot.
      if (
        page.pageId &&
        typeof page.accessToken === 'string' &&
        page.accessToken.trim().length > 0
      ) {
        for (const accountId of requestedPageAccounts.get(
          String(page.pageId),
        ) || []) {
          if (userAccountIds.has(accountId)) {
            snapshot.pageAccountPairs.add(`${page.pageId}:${accountId}`)
          }
        }
      }
    }

    for (const pixel of user.pixels || []) {
      for (const account of pixel.accounts || []) {
        const accountId = normalizeForStorage(account.accountId)
        if (pixel.pixelId && accountId) {
          snapshot.pixelAccountPairs.add(`${pixel.pixelId}:${accountId}`)
        }
      }
    }
  }

  const snapshotMatchesDraft = (
    snapshot: ReturnType<typeof emptyFacebookAssetSnapshot>,
  ) => {
    if (!snapshot.hasCachedAssets) return false

    return (draft.accounts || []).every((account: any) => {
      const accountId = normalizeForStorage(account.accountId)
      if (!accountId || !snapshot.adAccountStatuses.has(accountId)) return false
      if (
        account.pageId &&
        !snapshot.pageAccountPairs.has(`${account.pageId}:${accountId}`)
      ) {
        return false
      }
      if (
        account.pixelId &&
        !snapshot.pixelAccountPairs.has(`${account.pixelId}:${accountId}`)
      ) {
        return false
      }
      return true
    })
  }

  const matchingSnapshot = draftTokenId
    ? snapshots.get(draftTokenId)
    : Array.from(snapshots.values()).find(snapshotMatchesDraft)
  const fallbackSnapshot = Array.from(snapshots.values()).find(
    (snapshot) => snapshot.hasCachedAssets,
  ) || Array.from(snapshots.values())[0]
  const selectedSnapshot = matchingSnapshot || fallbackSnapshot

  if (!selectedSnapshot) {
    return emptyFacebookAssetSnapshot(tokens.length, draftTokenId)
  }

  return {
    tokenCount: tokens.length,
    selectedTokenId: draftTokenId || matchingSnapshot?.selectedTokenId,
    hasCachedAssets: selectedSnapshot.hasCachedAssets,
    pageAccountPairs: selectedSnapshot.pageAccountPairs,
    pixelAccountPairs: selectedSnapshot.pixelAccountPairs,
    adAccountStatuses: selectedSnapshot.adAccountStatuses,
  }
}

const findScopedDraftAccountAsset = async (accountId: string, draft: any) => {
  if (!draft.organizationId) {
    return null
  }

  return Account.findOne(combineFilters(
    {
      channel: 'facebook',
      accountId: { $in: getAccountIdsForQuery([accountId]) },
    },
    { organizationId: draft.organizationId },
  ))
    .select('_id accountId accountStatus status')
    .lean()
}

/**
 * 创建广告草稿
 */
export const createDraft = async (data: any, userId?: string) => {
  const nextData = { ...data }
  if (nextData.organizationId && !nextData.metaCredentialId) {
    const resolved = await resolvePublishingCredential({
      organizationId: nextData.organizationId,
      adAccountIds: (nextData.accounts || []).map((account: any) => account.accountId),
      pageIds: (nextData.accounts || []).map((account: any) => account.pageId).filter(Boolean),
      pixelIds: (nextData.accounts || []).map((account: any) => account.pixelId).filter(Boolean),
    })
    if (resolved) {
      nextData.metaCredentialId = resolved.credential._id
      delete nextData.facebookTokenId
      delete nextData.facebookTokenOwnerUserId
    }
  }
  const draft: any = new AdDraft({
    ...nextData,
    createdBy: userId || nextData.createdBy,
    lastModifiedBy: userId || nextData.lastModifiedBy || nextData.createdBy,
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
export const updateDraft = async (
  draftId: string,
  data: any,
  userId?: string,
  accessFilter: any = {},
) => {
  const draft: any = await AdDraft.findOne(combineFilters({ _id: draftId }, accessFilter))
  if (!draft) {
    throw new Error('Draft not found')
  }

  // AI replicas are immutable approval artifacts. Allowing the generic bulk
  // editor to mutate one would break the guarantee that the approved payload
  // is exactly the payload later sent to Meta.
  if (hasAiExecutionLineage(draft.aiOrigin)) {
    const error: any = new Error('AI 复制草稿不可编辑；如需调整，请重新生成并重新审批')
    error.statusCode = 409
    error.errorCode = 'AI_REPLICA_DRAFT_IMMUTABLE'
    throw error
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
export const getDraft = async (draftId: string, accessFilter: any = {}) => {
  const draft = await AdDraft.findOne(combineFilters({ _id: draftId }, accessFilter))
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
 * @param query 查询参数
 * @param userFilter 用户过滤条件（来自 getAssetFilter）
 */
export const getDraftList = async (query: any = {}, userFilter: any = {}) => {
  const status = pickAllowedString(query.status, DRAFT_LIST_STATUSES, '')
  const { page, pageSize, skip } = parsePagination(query)
  
  // 合并用户过滤条件
  const filter: any = { ...userFilter }
  if (status) filter.status = status
  
  const [list, total] = await Promise.all([
    AdDraft.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean(),
    AdDraft.countDocuments(filter),
  ])
  
  return { list, total, page, pageSize }
}

/**
 * 删除草稿
 */
export const deleteDraft = async (draftId: string, accessFilter: any = {}) => {
  const draft = await AdDraft.findOne(combineFilters({ _id: draftId }, accessFilter))
  if (!draft) {
    throw new Error('Draft not found')
  }
  
  if (draft.status === 'published') {
    throw new Error('Cannot delete published draft')
  }
  
  await AdDraft.deleteOne(combineFilters({ _id: draftId }, accessFilter))
  logger.info(`[BulkAd] Draft deleted: ${draftId}`)
  return { success: true }
}

/**
 * 验证草稿
 */
export const validateDraft = async (draftId: string, accessFilter: any = {}) => {
  const draft: any = await AdDraft.findOne(combineFilters({ _id: draftId }, accessFilter))
  if (!draft) {
    throw new Error('Draft not found')
  }
  
  // 兼容历史/前端空字符串导致的 CastError（例如 targetingPackageId: ""）
  if (draft.adset && draft.adset.targetingPackageId === '') {
    draft.adset.targetingPackageId = undefined
  }
  
  // 简化验证逻辑
  const errors: any[] = []
  const warnings: any[] = []
  let inferredFacebookTokenId: string | undefined
  const addError = (field: string, message: string) => errors.push({ field, message, severity: 'error' })
  const addWarning = (field: string, message: string) => warnings.push({ field, message, severity: 'warning' })
  
  if (!draft.accounts || draft.accounts.length === 0) {
    addError('accounts', '请至少选择一个广告账户')
  } else {
    const seenAccounts = new Set<string>()
    const assetSnapshot = await buildFacebookAssetSnapshot(draft)

    if (assetSnapshot.tokenCount === 0) {
      addError('facebookAuthorization', draft.metaCredentialId
        ? '当前组织的 Meta System User 发布凭证已失效、未覆盖所选资产或不属于当前组织，请联系管理员重新协调资产授权'
        : draft.facebookTokenId
          ? '当前选择的 Facebook 个人号授权已失效或不属于当前组织，请重新授权'
          : '当前组织没有可用的 Meta System User 发布凭证或个人号授权，请联系管理员完成资产授权')
    } else if (!assetSnapshot.hasCachedAssets) {
      addError('facebookAssets', draft.metaCredentialId
        ? '当前 Meta System User 资产授权尚未完成读回验证，请联系管理员重新校验'
        : '当前选择的 Facebook 个人号资产尚未同步完成，请重新同步后再发布')
    } else if (!draft.metaCredentialId && !draft.facebookTokenId && !assetSnapshot.selectedTokenId) {
      addError('facebookAuthorization', '所选广告账户、Page 和 Pixel 不属于同一个 Facebook 个人号授权，请切换个人号后重新选择资产')
    }

    if (!draft.metaCredentialId && !draft.facebookTokenId && assetSnapshot.selectedTokenId) {
      inferredFacebookTokenId = assetSnapshot.selectedTokenId
    }

    for (const account of draft.accounts) {
      const accountId = normalizeForStorage(account.accountId)
      const accountLabel = account.accountName || account.accountId || '未知账户'
      if (!accountId) {
        addError('accounts.accountId', '存在未填写广告账户 ID 的账户配置')
        continue
      }

      if (seenAccounts.has(accountId)) {
        addError(`accounts.${account.accountId}`, `广告账户 ${accountLabel} 被重复选择`)
      }
      seenAccounts.add(accountId)

      const hasCachedAccountAccess = assetSnapshot.adAccountStatuses.has(accountId)
      const accountAsset = await findScopedDraftAccountAsset(accountId, draft)
      if (draft.organizationId && !accountAsset) {
        addError(`accounts.${account.accountId}.access`, `广告账户 ${accountLabel} 未分配到当前组织或账户资产尚未同步完成，请先同步账户资产后重新选择`)
      } else if (assetSnapshot.hasCachedAssets && !hasCachedAccountAccess) {
        addError(`accounts.${account.accountId}.access`, `当前 Facebook 授权未同步到账户 ${accountLabel} 的访问权限，请重新授权或更换可访问账户`)
      } else if (
        !draft.organizationId &&
        !hasCachedAccountAccess &&
        assetSnapshot.tokenCount > 0
      ) {
        addError(`accounts.${account.accountId}.access`, `广告账户 ${accountLabel} 未分配到当前组织或账户资产尚未同步完成，请先同步账户资产后重新选择`)
      }

      const cachedStatus = assetSnapshot.adAccountStatuses.get(accountId)
      if (cachedStatus !== undefined && cachedStatus !== 1) {
        addError(`accounts.${account.accountId}.status`, `广告账户 ${accountLabel} 当前状态不可投放，请更换活跃账户`)
      }

      if (!account.pageId) {
        addError(`accounts.${account.accountId}.pageId`, `账户 ${accountLabel} 未选择 Facebook 主页`)
      } else if (
        assetSnapshot.hasCachedAssets &&
        !assetSnapshot.pageAccountPairs.has(`${account.pageId}:${accountId}`)
      ) {
        addError(`accounts.${account.accountId}.pageId`, `账户 ${accountLabel} 未同步到所选主页权限，请重新同步 Page 或更换主页`)
      }

      const requiresPixel = draft.campaign?.objective === 'OUTCOME_SALES' || draft.adset?.optimizationGoal === 'OFFSITE_CONVERSIONS'
      if (requiresPixel && !account.pixelId) {
        addError(`accounts.${account.accountId}.pixelId`, `账户 ${accountLabel} 使用转化目标时必须选择 Pixel`)
      } else if (
        account.pixelId &&
        assetSnapshot.hasCachedAssets &&
        !assetSnapshot.pixelAccountPairs.has(`${account.pixelId}:${accountId}`)
      ) {
        addError(`accounts.${account.accountId}.pixelId`, `账户 ${accountLabel} 未同步到所选 Pixel 权限，请重新同步 Pixel 或更换账户`)
      }

      if (account.pixelId && !account.conversionEvent) {
        addWarning(`accounts.${account.accountId}.conversionEvent`, `账户 ${accountLabel} 未选择转化事件，将默认使用 PURCHASE`)
      }
    }
  }
  if (!draft.campaign?.nameTemplate) {
    addError('campaign.nameTemplate', '请填写广告系列名称')
  }
  const campaignUsesCbo = draft.campaign?.budgetOptimization !== false
  if (campaignUsesCbo && (!draft.campaign?.budget || draft.campaign.budget < MIN_BUDGET)) {
    addError('campaign.budget', `CBO 模式下广告系列预算不能低于 ${MIN_BUDGET}`)
  }
  if (!campaignUsesCbo) {
    const adsetBudget = draft.adset?.budget || draft.campaign?.budget
    if (!adsetBudget || adsetBudget < MIN_BUDGET) {
      addError('adset.budget', `非 CBO 模式下广告组预算不能低于 ${MIN_BUDGET}`)
    }
  }
  if (!draft.adset?.targetingPackageId && !draft.adset?.inlineTargeting) {
    addError('adset.targeting', '请选择定向包或配置定向条件')
  }
  if (!isAllowedAdsetMultiplier(draft.adset?.multiplier)) {
    addError('adset.multiplier', '广告组倍率必须是 1 到 10 之间的整数')
  }
  const attributionCfg = draft.adset?.attribution || draft.adset?.attributionSpec
  if (attributionCfg) {
    if (!isAllowedAttributionWindow(attributionCfg.clickWindow ?? 1, CLICK_ATTRIBUTION_WINDOWS)) {
      addError('adset.attribution.clickWindow', '点击归因窗口必须是 1、7 或 28 天')
    }
    if (!isAllowedAttributionWindow(attributionCfg.viewWindow ?? 0, OPTIONAL_ATTRIBUTION_WINDOWS)) {
      addError('adset.attribution.viewWindow', '浏览归因窗口只能为 0 或 1 天')
    }
    if (
      attributionCfg.engagedViewWindow !== undefined &&
      !isAllowedAttributionWindow(attributionCfg.engagedViewWindow, OPTIONAL_ATTRIBUTION_WINDOWS)
    ) {
      addError('adset.attribution.engagedViewWindow', '互动观看归因窗口只能为 0 或 1 天')
    }
  }
  if (draft.adset?.startTime && draft.adset?.endTime && new Date(draft.adset.endTime) <= new Date(draft.adset.startTime)) {
    addError('adset.endTime', '广告组结束时间必须晚于开始时间')
  }
  if (draft.publishStrategy?.schedule === 'SCHEDULED') {
    if (!draft.publishStrategy?.scheduledTime) {
      addError('publishStrategy.scheduledTime', '定时发布必须设置发布时间')
    } else if (new Date(draft.publishStrategy.scheduledTime).getTime() <= Date.now() + 5 * 60 * 1000) {
      addError('publishStrategy.scheduledTime', '定时发布时间至少需要晚于当前时间 5 分钟')
    }
  }

  if (draft.adset?.targetingPackageId) {
    const targetingPackageId = draft.adset.targetingPackageId.toString()
    if (!mongoose.Types.ObjectId.isValid(targetingPackageId)) {
      addError('adset.targetingPackageId', '定向包 ID 无效')
    } else {
      const targetingPackage: any = await TargetingPackage.findOne(
        combineFilters({ _id: targetingPackageId }, accessFilter),
      )
      if (!targetingPackage) {
        addError('adset.targetingPackageId', '所选定向包不存在或无权访问')
      } else if (
        !targetingPackage.geoLocations?.countries?.length &&
        !targetingPackage.geoLocations?.regions?.length &&
        !targetingPackage.geoLocations?.cities?.length &&
        !targetingPackage.customAudiences?.length
      ) {
        addWarning('adset.targetingPackageId', '所选定向包没有国家、地区、城市或自定义受众，可能导致 Meta 拒绝或受众过宽')
      }
    }
  }
  if (!draft.ad?.creativeGroupIds || draft.ad.creativeGroupIds.length === 0) {
    addError('ad.creativeGroupIds', '请至少选择一个创意组')
  } else {
    const { valid, invalid } = normalizeObjectIdList(draft.ad.creativeGroupIds)
    for (const invalidId of invalid) {
      addError('ad.creativeGroupIds', `创意组 ID 无效：${invalidId}`)
    }
    const creativeGroups: any[] = valid.length
      ? await CreativeGroup.find(combineFilters({ _id: { $in: valid } }, accessFilter)).lean()
      : []
    if (creativeGroups.length !== valid.length) {
      addError('ad.creativeGroupIds', '部分创意组不存在或无权访问')
    }
    for (const group of creativeGroups) {
      const validMaterialCount = (group.materials || []).filter(hasUsableMaterial).length
      if (validMaterialCount === 0) {
        addError('ad.creativeGroupIds', `创意组「${group.name}」没有可用图片或视频素材`)
      } else if ((group.materials || []).some((material: any) => material.status === 'failed')) {
        addWarning('ad.creativeGroupIds', `创意组「${group.name}」包含上传失败素材，发布时会自动跳过`)
      }
    }
  }
  if (!draft.ad?.copywritingPackageIds || draft.ad.copywritingPackageIds.length === 0) {
    addError('ad.copywritingPackageIds', '请至少选择一个文案包')
  } else {
    const { valid, invalid } = normalizeObjectIdList(draft.ad.copywritingPackageIds)
    for (const invalidId of invalid) {
      addError('ad.copywritingPackageIds', `文案包 ID 无效：${invalidId}`)
    }
    const copywritingPackages: any[] = valid.length
      ? await CopywritingPackage.find(combineFilters({ _id: { $in: valid } }, accessFilter)).lean()
      : []
    if (copywritingPackages.length !== valid.length) {
      addError('ad.copywritingPackageIds', '部分文案包不存在或无权访问')
    }
    for (const pkg of copywritingPackages) {
      if (!pkg.links?.websiteUrl) {
        addError('ad.copywritingPackageIds', `文案包「${pkg.name}」缺少落地页链接`)
      }
      if (pkg.links?.displayLink && !isHttpUrl(pkg.links.displayLink)) {
        addWarning('ad.copywritingPackageIds', `文案包「${pkg.name}」的显示链接不是完整网址，发布时将忽略该字段`)
      }
      if (!pkg.content?.primaryTexts?.length) {
        addWarning('ad.copywritingPackageIds', `文案包「${pkg.name}」缺少正文文案`)
      }
      if (!pkg.content?.headlines?.length) {
        addWarning('ad.copywritingPackageIds', `文案包「${pkg.name}」缺少标题文案`)
      }
    }
  }
  
  const validation = {
    isValid: errors.length === 0,
    errors,
    warnings,
    validatedAt: new Date(),
  }

  // Only persist an inferred authorization after the entire draft passes.
  // Invalid legacy drafts must stay unpinned so correcting their assets can
  // select the genuinely compatible personal token on the next preflight.
  if (validation.isValid && !draft.facebookTokenId && inferredFacebookTokenId) {
    draft.facebookTokenId = inferredFacebookTokenId
  }
  
  draft.validation = validation
  await draft.save()
  
  return validation
}

// ==================== 发布流程 ====================

/**
 * 发布草稿（创建任务）
 */
export const publishDraft = async (
  draftId: string,
  userId?: string,
  accessFilter: any = {},
  options: { aiReplicaRunId?: string } = {},
) => {
  // 验证草稿
  const validation = await validateDraft(draftId, accessFilter)
  if (!validation.isValid) {
    throw createDraftValidationFailure(validation)
  }

  // validateDraft may pin a legacy draft to the only compatible Facebook token.
  // Reload so the task snapshot always carries that exact authorization.
  const draft: any = await getDraft(draftId, accessFilter)

  if (hasAiExecutionLineage(draft.aiOrigin)) {
    if (draft.aiOrigin?.statusLockedToPaused !== true) {
      const error: any = new Error('AI 投放草稿缺少 PAUSED 状态锁，禁止发布')
      error.statusCode = 409
      error.errorCode = 'AI_EXECUTION_LINEAGE_REQUIRED'
      throw error
    }
    if (
      !options.aiReplicaRunId ||
      String(options.aiReplicaRunId) !==
        String(draft.aiOrigin?.replicaRunId || '')
    ) {
      const error: any = new Error(
        'AI 投放草稿只能通过授权单绑定的 AI 投放发布入口执行',
      )
      error.statusCode = 409
      error.errorCode = 'AI_REPLICA_DEDICATED_PUBLISH_REQUIRED'
      throw error
    }
    const statuses = [
      draft.campaign?.status,
      draft.adset?.status,
      draft.ad?.status,
    ]
    if (statuses.some((status) => status !== 'PAUSED')) {
      const error: any = new Error('AI 复制草稿必须保持 Campaign、AdSet 和 Ad 全部为 PAUSED')
      error.statusCode = 409
      error.errorCode = 'AI_REPLICA_STATUS_LOCK_VIOLATION'
      throw error
    }

    const replicaRun = await ReplicaRun.findOne({
      _id: draft.aiOrigin.replicaRunId,
      draftId: draft._id,
      mandateId: draft.aiOrigin.mandateId,
      status: { $in: ['approved', 'publishing'] },
    }).select('_id mandateId playbookVersionId')
    if (!replicaRun) {
      const error: any = new Error('AI 复制任务尚未完成明确审批，禁止发布')
      error.statusCode = 409
      error.errorCode = 'AI_REPLICA_APPROVAL_REQUIRED'
      throw error
    }
    const activeMandate = await AiExecutionMandate.findOne({
      _id: replicaRun.mandateId,
      status: 'active',
      playbookVersionId: replicaRun.playbookVersionId,
    }).select('_id')
    if (!activeMandate) {
      const error: any = new Error(
        'AI 投放授权单不存在或已撤销，禁止发布',
      )
      error.statusCode = 409
      error.errorCode = 'AI_EXECUTION_MANDATE_REQUIRED'
      throw error
    }
  }
  
  // 计算预估
  const accountCount = draft.accounts?.length || 0
  await assertBulkAdPublishAllowed({
    organizationId: draft.organizationId?.toString(),
    requestedAccounts: accountCount,
  })
  const creativeGroupCount = draft.ad?.creativeGroupIds?.length || 1
  const copywritingCount = draft.ad?.copywritingPackageIds?.length || 1
  const adsetMultiplier = normalizeAdsetMultiplier(draft.adset?.multiplier)
  const estimatedTotalAdsets = accountCount * adsetMultiplier
  
  // 估算广告数量（与前端预览一致：按创意组数估算；实际创建会按素材数生成更多广告）
  const creativeLevel = draft.publishStrategy?.creativeLevel || 'ADSET'
  let estimatedTotalAds =
    creativeLevel === 'CAMPAIGN'
      ? accountCount * creativeGroupCount
      : estimatedTotalAdsets * creativeGroupCount
  if ((draft.publishStrategy?.copywritingMode || 'SHARED') === 'SEQUENTIAL') {
    estimatedTotalAds = estimatedTotalAds * copywritingCount
  }
  
  // 🆕 生成任务名称：autoark{用户名}_{包名}_{日期时间精确到秒}
  // 获取用户名
  let userName = 'unknown'
  if (userId) {
    try {
      const user = await User.findById(userId).lean()
      userName = user?.username?.replace(/[^a-zA-Z0-9\u4e00-\u9fa5-]/g, '') || 'unknown'
    } catch (e) {
      logger.warn('[BulkAd] Failed to get username')
    }
  }
  // 获取文案包名称
  let packageName = ''
  if (draft.ad?.copywritingPackageIds?.length > 0) {
    try {
      const pkg = await CopywritingPackage.findOne(
        combineFilters({ _id: draft.ad.copywritingPackageIds[0] }, accessFilter),
      )
      packageName = pkg?.name?.replace(/[^a-zA-Z0-9\u4e00-\u9fa5-]/g, '') || ''
    } catch (e) {
      logger.warn('[BulkAd] Failed to get copywriting package name')
    }
  }
  // 日期时间精确到秒: YYYYMMDD_HHMMSS
  const now = new Date()
  const dateTimeStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
  const taskName = `autoark${userName}${packageName ? '_' + packageName : ''}_${dateTimeStr}`
  
  // 创建任务
  const task: any = new AdTask({
    name: taskName,  // 🆕 任务名称
    taskType: 'BULK_AD_CREATE',
    status: 'pending',
    platform: 'facebook',
    draftId: draft._id,
    organizationId: draft.organizationId,
    
    // 初始化任务项
    items: draft.accounts.map((account: any) => ({
      accountId: account.accountId,
      accountName: account.accountName,
      status: 'pending',
      progress: { current: 0, total: 3, percentage: 0 },
    })),
    
    // 保存配置快照
    configSnapshot: {
      metaCredentialId: draft.metaCredentialId,
      facebookTokenId: draft.facebookTokenId,
      facebookTokenOwnerUserId: draft.facebookTokenOwnerUserId || draft.createdBy,
      accounts: draft.accounts,
      campaign: draft.campaign,
      adset: draft.adset,
      ad: draft.ad,
      publishStrategy: draft.publishStrategy,
      aiOrigin: hasAiExecutionLineage(draft.aiOrigin)
        ? {
            replicaRunId: draft.aiOrigin.replicaRunId,
            mandateId: draft.aiOrigin.mandateId,
            playbookVersionId: draft.aiOrigin.playbookVersionId,
            statusLockedToPaused: true,
          }
        : undefined,
    },
    
    // 设置预估总数
    progress: {
      totalAccounts: accountCount,
      totalCampaigns: accountCount,
      totalAdsets: estimatedTotalAdsets,
      totalAds: estimatedTotalAds,
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
      
      item.status = 'success'
      successCount++
      logger.info(`[BulkAd] Account ${item.accountId} completed`)
    } catch (error: any) {
      item.status = 'failed'
      item.error = error.message
      item.errors = [diagnoseBulkAdError(error, { fallbackCode: 'EXECUTION_ERROR', entityType: 'general' })]
      failCount++
      logger.error(`[BulkAd] Account ${item.accountId} failed:`, error)
    }
    
    // 更新进度
    const completedCount = task.items.filter((i: any) => 
      i.status === 'success' || i.status === 'failed'
    ).length
    task.progress.percentage = Math.round((completedCount / task.items.length) * 100)
    await task.save()
  }
  
  // 任务完成
  task.status = failCount === 0 ? 'success' : (successCount === 0 ? 'failed' : 'partial_success')
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

export const assertAiTaskExecutionAuthorized = async (task: any) => {
  const origin = task?.configSnapshot?.aiOrigin
  const hasAiLineage = hasAiExecutionLineage(origin)
  if (!hasAiLineage) return true

  const fail = (message: string, errorCode: string) => {
    const error: any = new Error(
      message,
    )
    error.statusCode = 409
    error.errorCode = errorCode
    throw error
  }

  if (
    origin.statusLockedToPaused !== true ||
    !origin.replicaRunId ||
    !origin.mandateId ||
    !origin.playbookVersionId ||
    !task?.draftId
  ) {
    fail(
      'AI 投放任务缺少完整授权单执行血缘，禁止调用 Meta 写接口',
      'AI_EXECUTION_LINEAGE_REQUIRED',
    )
  }

  const organizationConstraint = task.organizationId
    ? { organizationId: task.organizationId }
    : {}
  const replicaRun: any = await ReplicaRun.findOne({
    _id: origin.replicaRunId,
    draftId: task.draftId,
    mandateId: origin.mandateId,
    status: 'publishing',
    ...organizationConstraint,
  })
    .select(
      '_id mandateId playbookVersionId sourceCreativeGroupId sourceCopywritingPackageId targetingPackageId productId creativeGroupId copywritingPackageId assetSnapshot targets',
    )
    .lean()
  if (!replicaRun) {
    fail(
      'AI 投放任务不在已授权的发布状态，禁止调用 Meta 写接口',
      'AI_REPLICA_EXECUTION_NOT_AUTHORIZED',
    )
  }

  const playbook: any = await PlaybookVersion.findOne({
    _id: replicaRun.playbookVersionId,
    ...organizationConstraint,
  })
    .lean()
  if (!playbook) {
    fail(
      'AI 投放打法版本不存在或已越过组织边界，禁止调用 Meta 写接口',
      'AI_PLAYBOOK_EXECUTION_UNAVAILABLE',
    )
  }

  const tokenOwnerUserId =
    task.configSnapshot?.facebookTokenOwnerUserId?.toString()
  let selection: any
  try {
    selection = await resolveExecutionMandate({
      mandateId: String(replicaRun.mandateId),
      playbook,
      accessFilter: organizationConstraint,
      tokenAccessFilter: {
        ...organizationConstraint,
        ...(tokenOwnerUserId ? { userId: tokenOwnerUserId } : {}),
      },
    })
  } catch (error: any) {
    error.errorCode =
      error.errorCode || error.code || 'AI_EXECUTION_MANDATE_REQUIRED'
    throw error
  }

  const config = task.configSnapshot || {}
  const authorizationType =
    selection.authorizationType ||
    selection.mandate.authorizationType ||
    (selection.mandate.metaCredentialId ? 'system_user' : 'personal_user')
  const authorizationMatches =
    authorizationType === 'system_user'
      ? String(config.metaCredentialId || '') ===
          String(selection.mandate.metaCredentialId || '') &&
        !config.facebookTokenId
      : String(config.facebookTokenId || '') ===
          String(selection.mandate.facebookTokenId || '') &&
        !config.metaCredentialId
  if (!authorizationMatches) {
    fail(
      'AI 投放任务使用的 Facebook 授权与管理员授权单不一致',
      'AI_EXECUTION_CREDENTIAL_CHANGED',
    )
  }
  if (
    [config.campaign?.status, config.adset?.status, config.ad?.status].some(
      (status) => status !== 'PAUSED',
    )
  ) {
    fail(
      'AI 投放任务的 Campaign、AdSet 和 Ad 必须全部保持 PAUSED',
      'AI_REPLICA_STATUS_LOCK_VIOLATION',
    )
  }

  const expectedTargets = new Map(
    selection.targets.map((target: any) => [
      normalizeForStorage(target.accountId),
      target,
    ]),
  )
  const taskAccounts = config.accounts || []
  if (
    taskAccounts.length !== expectedTargets.size ||
    new Set(
      taskAccounts.map((account: any) =>
        normalizeForStorage(account.accountId),
      ),
    ).size !== taskAccounts.length
  ) {
    fail(
      'AI 投放任务的执行账户集合与管理员授权单不一致',
      'AI_EXECUTION_ACCOUNTS_CHANGED',
    )
  }
  for (const account of taskAccounts) {
    const expected: any = expectedTargets.get(
      normalizeForStorage(account.accountId),
    )
    if (
      !expected ||
      String(account.pageId || '') !== String(expected.pageId || '') ||
      String(account.pixelId || '') !== String(expected.pixelId || '')
    ) {
      fail(
        `AI 投放账户 ${account.accountId} 的 Page 或产品 Pixel 与当前授权不一致`,
        'AI_EXECUTION_ASSET_CHANGED',
      )
    }
  }

  if (
    String(replicaRun.sourceCreativeGroupId || '') !==
      String(selection.creativeGroup._id) ||
    String(replicaRun.sourceCopywritingPackageId || '') !==
      String(selection.copywritingPackage._id) ||
    String(replicaRun.targetingPackageId || '') !==
      String(selection.targetingPackage._id) ||
    String(replicaRun.productId || '') !== String(selection.product._id)
  ) {
    fail(
      'AI 投放任务的方法资产、文案包或产品绑定已变化',
      'AI_EXECUTION_METHOD_CHANGED',
    )
  }

  const creativeGroupIds = (config.ad?.creativeGroupIds || []).map(String)
  const copywritingPackageIds = (
    config.ad?.copywritingPackageIds || []
  ).map(String)
  if (
    creativeGroupIds.length !== 1 ||
    creativeGroupIds[0] !== String(replicaRun.creativeGroupId || '') ||
    copywritingPackageIds.length !== 1 ||
    copywritingPackageIds[0] !==
      String(replicaRun.copywritingPackageId || '')
  ) {
    fail(
      'AI 投放任务未使用授权生成的冻结素材或文案快照',
      'AI_EXECUTION_SNAPSHOT_CHANGED',
    )
  }
  if (
    canonicalJson(config.adset?.inlineTargeting || {}) !==
    canonicalJson(replicaRun.assetSnapshot?.frozenTargeting || {})
  ) {
    fail(
      'AI 投放任务的冻结定向已变化',
      'AI_EXECUTION_TARGETING_CHANGED',
    )
  }

  const selectedBudget = Number(replicaRun.targets?.dailyBudget)
  const maximumBudget = Number(
    selection.mandate.budget?.maximumDailyBudget,
  )
  if (
    !Number.isFinite(selectedBudget) ||
    selectedBudget < 1 ||
    !Number.isFinite(maximumBudget) ||
    selectedBudget > maximumBudget ||
    Number(config.campaign?.budget) !== selectedBudget ||
    Number(config.adset?.budget) !== selectedBudget
  ) {
    fail(
      'AI 投放任务预算与管理员授权单或审批快照不一致',
      'AI_EXECUTION_BUDGET_CHANGED',
    )
  }

  const [executionCreativeGroup, executionCopywritingPackage]: any[] =
    await Promise.all([
      CreativeGroup.findOne({
        _id: replicaRun.creativeGroupId,
        ...organizationConstraint,
      }).lean(),
      CopywritingPackage.findOne({
        _id: replicaRun.copywritingPackageId,
        ...organizationConstraint,
      }).lean(),
    ])
  if (!executionCreativeGroup || !executionCopywritingPackage) {
    fail(
      'AI 投放任务的冻结素材或文案快照不存在',
      'AI_EXECUTION_SNAPSHOT_UNAVAILABLE',
    )
  }
  if (
    canonicalJson(frozenCreativeSnapshot(executionCreativeGroup)) !==
      canonicalJson(replicaRun.assetSnapshot?.frozenCreative) ||
    canonicalJson(frozenCopywritingSnapshot(executionCopywritingPackage)) !==
      canonicalJson(replicaRun.assetSnapshot?.frozenCopywriting)
  ) {
    fail(
      'AI 投放任务的冻结素材或文案已在审批后被修改',
      'AI_EXECUTION_SNAPSHOT_CHANGED',
    )
  }

  return true
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
  // 使用 'success' 作为成功状态，与 Schema 保持一致
  const status = allDone ? (failedCount === items.length ? 'failed' : successCount === items.length ? 'success' : 'partial_success') : 'processing'
  
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

  const config = task.configSnapshot
  const accountConfig = config.accounts.find((a: any) => a.accountId === accountId)
  if (!accountConfig) {
    throw new Error('Account config not found')
  }

  if (task.organizationId) {
    const scopedAccount = await Account.findOne(combineFilters(
      {
        channel: 'facebook',
        accountId: { $in: getAccountIdsForQuery([accountId]) },
      },
      { organizationId: task.organizationId },
    ))
      .select('_id')
      .lean()
    if (!scopedAccount) {
      throw new Error(`广告账户 ${accountConfig.accountName || accountId} 不属于当前组织，任务已停止`)
    }
  }

  // 验证必要配置
  if (!accountConfig.pageId) {
    throw new Error(`账户 ${accountConfig.accountName || accountId} 没有配置 Facebook 主页，无法创建广告`)
  }

  // 获取发布凭证。新任务优先使用预检时固定的组织级 System User；
  // 个人号 token 只用于兼容迁移前已创建的任务。
  const taskAccessFilter = await resolveTaskAssetAccessFilter(task)
  const pinnedCredentialId = config.metaCredentialId?.toString()
  let token: string

  if (pinnedCredentialId) {
    if (!task.organizationId) {
      throw new Error('System User 发布任务缺少组织边界，任务已停止')
    }
    const resolved = await resolvePublishingCredential({
      organizationId: task.organizationId,
      credentialId: pinnedCredentialId,
      adAccountIds: [accountId],
      pageIds: [accountConfig.pageId],
      pixelIds: accountConfig.pixelId ? [accountConfig.pixelId] : [],
    })
    if (!resolved) {
      throw new Error(
        '预检使用的 Meta System User 凭证已失效或不再覆盖所选账户、Page、Pixel，请联系管理员重新协调资产授权',
      )
    }
    token = resolved.token
    logger.info(
      `[BulkAd] Using organization System User credential ${pinnedCredentialId} for account ${accountId}`,
    )
  } else {
    const tokenAccessFilter = task.organizationId
      ? {
          organizationId: task.organizationId,
          ...(task.createdBy ? { userId: task.createdBy } : {}),
        }
      : task.createdBy
        ? { userId: task.createdBy }
        : {}

    const pinnedTokenId = config.facebookTokenId?.toString()
    const pinnedTokenOwnerUserId = config.facebookTokenOwnerUserId?.toString()
    let fbToken: any
    if (pinnedTokenId) {
      fbToken = await FbToken.findOne({
        _id: pinnedTokenId,
        status: 'active',
        ...(task.organizationId ? { organizationId: task.organizationId } : {}),
        ...(pinnedTokenOwnerUserId
          ? { userId: pinnedTokenOwnerUserId }
          : task.createdBy
            ? { userId: task.createdBy }
            : {}),
      })
      if (!fbToken) {
        throw new Error('预检使用的 Facebook 个人号授权已失效，请重新验证草稿后再发布')
      }
    } else {
      // 兼容修复上线前已创建的历史任务。
      fbToken = await FbToken.findOne({
        status: 'active',
        ...tokenAccessFilter,
        'accounts.accountId': accountId,
      })
    }

    // 如果没有绑定关系，尝试从 Account 模型获取历史 fbUserId。
    if (!pinnedTokenId && !fbToken) {
      const account: any = await Account.findOne(combineFilters(
        { accountId },
        task.organizationId ? { organizationId: task.organizationId } : {},
      )).lean()
      if (account?.fbUserId) {
        fbToken = await FbToken.findOne({
          status: 'active',
          ...tokenAccessFilter,
          fbUserId: account.fbUserId,
        })
      }
    }

    // 最后的历史兼容：仅在同一用户/组织范围内实时验证候选 token。
    if (!pinnedTokenId && !fbToken) {
      const allTokens = await FbToken.find({ status: 'active', ...tokenAccessFilter })
      for (const candidate of allTokens) {
        try {
          const response = await facebookClient.get(`/act_${accountId}`, {
            access_token: candidate.token,
            fields: 'id,name',
          })
          if (response?.id) {
            fbToken = candidate
            logger.info(`[BulkAd] Found scoped legacy token for account ${accountId}`)
            break
          }
        } catch {
          logger.debug(
            `[BulkAd] Scoped legacy token candidate has no access to account ${accountId}`,
          )
        }
      }
    }

    if (!fbToken) {
      throw new Error(`没有找到可访问账户 ${accountId} 的 Facebook Token，请检查授权`)
    }
    token = fbToken.token
  }
  
  // 原子更新状态为处理中
  await updateTaskItemAtomic(taskId, accountId, {
    'items.$.status': 'processing',
    'items.$.startedAt': new Date(),
  })
  
  try {
    await assertAiTaskExecutionAuthorized(task)

    // ==================== 0. 资源预检（任何 Meta 写操作之前） ====================
    // 先确认定向、创意组、文案包都能按发布者权限读取，避免已经创建
    // Campaign/AdSet 后才发现资源不可用，留下无法复用的半成品。
    let targeting: any = {}
    let targetingName = ''  // 定向包名称，用于名称模板
    let dynamicCreativeEnabled = false
    if (config.adset.targetingPackageId) {
      const targetingPackageId = config.adset.targetingPackageId.toString()
      if (!mongoose.Types.ObjectId.isValid(targetingPackageId)) {
        throw createBulkAssetAccessError('Targeting package', [targetingPackageId])
      }
      const targetingPackage: any = await TargetingPackage.findOne(
        combineFilters({ _id: targetingPackageId }, taskAccessFilter),
      )
      if (!targetingPackage) {
        throw createBulkAssetAccessError('Targeting package', [targetingPackageId])
      }
      targetingName = targetingPackage.name || ''
      dynamicCreativeEnabled = targetingPackage.dynamicCreativeEnabled === true
      if (targetingPackage.toFacebookTargeting) {
        targeting = targetingPackage.toFacebookTargeting()
      }
    } else if (config.adset.inlineTargeting) {
      targeting = config.adset.inlineTargeting
    }

    const creativeIdSet = normalizeObjectIdList(config.ad.creativeGroupIds || [])
    const copywritingIdSet = normalizeObjectIdList(config.ad.copywritingPackageIds || [])
    const creativeGroups: any[] = creativeIdSet.valid.length > 0
      ? await CreativeGroup.find(
          combineFilters({ _id: { $in: creativeIdSet.valid } }, taskAccessFilter),
        )
      : []
    const copywritingPackages: any[] = copywritingIdSet.valid.length > 0
      ? await CopywritingPackage.find(
          combineFilters({ _id: { $in: copywritingIdSet.valid } }, taskAccessFilter),
        )
      : []

    const foundCreativeIds = creativeGroups.map(group => group._id?.toString()).filter(Boolean)
    const foundCopywritingIds = copywritingPackages.map(pkg => pkg._id?.toString()).filter(Boolean)
    const missingCreativeIds = creativeIdSet.valid.length === 0 && creativeIdSet.invalid.length === 0
      ? ['<none selected>']
      : [...creativeIdSet.invalid, ...creativeIdSet.valid.filter(id => !foundCreativeIds.includes(id))]
    const missingCopywritingIds = copywritingIdSet.valid.length === 0 && copywritingIdSet.invalid.length === 0
      ? ['<none selected>']
      : [...copywritingIdSet.invalid, ...copywritingIdSet.valid.filter(id => !foundCopywritingIds.includes(id))]
    if (missingCreativeIds.length > 0) {
      throw createBulkAssetAccessError('Creative groups', [...new Set(missingCreativeIds)], foundCreativeIds)
    }
    if (missingCopywritingIds.length > 0) {
      throw createBulkAssetAccessError('Copywriting packages', [...new Set(missingCopywritingIds)], foundCopywritingIds)
    }

    const metaCloudOptimizationEnabled = creativeGroups.some((group) => (
      getMetaCreativeOptimizationMode(group) === 'advantage_plus' &&
      (group.materials || []).some((material: any) => material.type === 'video' && hasUsableMaterial(material))
    ))
    if (dynamicCreativeEnabled && metaCloudOptimizationEnabled) {
      // Meta's full Advantage+ creative flow requires a non-dynamic AdSet.
      // Prefer the package's explicit cloud-optimization policy and publish
      // each material as its own Creative so Meta can optimize it independently.
      dynamicCreativeEnabled = false
      logger.info(
        `[BulkAd] Meta cloud creative optimization selected; disabling dynamic creative for account ${accountId}`,
      )
    }
    
    // ==================== 1. 创建 Campaign ====================
    const campaignName = generateName(config.campaign.nameTemplate, {
      accountName: accountConfig.accountName,
      targetingName,  // 添加定向包名称变量
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
      throw createFacebookStepError('campaign', campaignResult.error, 'Campaign creation failed')
    }
    
    const campaignId = campaignResult.id
    // 原子更新 campaign 结果
    await updateTaskItemAtomic(taskId, accountId, {
      'items.$.result.campaignId': campaignId,
      'items.$.result.campaignName': campaignName,
    })
    
    // ==================== 2. 使用已获取的定向配置 ====================
    // (定向配置已在步骤0获取)
    
    // ==================== 3. 创建 AdSet（支持倍率） ====================
    // 广告组倍率：在一个 campaign 下创建多个 adset
    const adsetMultiplier = normalizeAdsetMultiplier(config.adset.multiplier)
    const allAdsetIds: string[] = []
    const allAdsetNames: string[] = []
    
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
    
    // 构建归因设置（兼容 attribution / attributionSpec）
    const attributionCfg = config.adset.attribution || config.adset.attributionSpec
    const attributionSpec = buildAttributionSpec(attributionCfg)

    logger.info(`[BulkAd] Creating ${adsetMultiplier} adset(s) for campaign ${campaignId}`)
    
    for (let adsetIndex = 0; adsetIndex < adsetMultiplier; adsetIndex++) {
      // 生成广告组名称（倍率>1时添加序号后缀）
      const hasIndexVar = /\{index\}/i.test(config.adset.nameTemplate || '')
      const adsetNameSuffix = adsetMultiplier > 1 && !hasIndexVar ? `_${adsetIndex + 1}` : ''
      const adsetName = generateName(config.adset.nameTemplate, {
        accountName: accountConfig.accountName,
        campaignName,
        targetingName,  // 添加定向包名称变量
        date: new Date().toISOString().slice(0, 10),
        index: adsetIndex + 1,
      }) + adsetNameSuffix

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
        attribution_spec: attributionSpec,
        dsa_beneficiary: dsaBeneficiary,
        dsa_payor: dsaBeneficiary,
        isDynamicCreative: dynamicCreativeEnabled,
      })
      
      if (!adsetResult.success) {
        throw createFacebookStepError('adset', adsetResult.error, `AdSet ${adsetIndex + 1} creation failed`)
      }
      
      allAdsetIds.push(adsetResult.id)
      allAdsetNames.push(adsetName)
      logger.info(`[BulkAd] Created adset ${adsetIndex + 1}/${adsetMultiplier}: ${adsetName}`)
    }
    
    // 原子更新 adset 结果
    await updateTaskItemAtomic(taskId, accountId, {
      'items.$.result.adsetIds': allAdsetIds,
    })
    
    // ==================== 4. 创建广告 ====================
    // 支持“一个 Campaign 下 N 个广告组”：会在每个广告组下各创建一套广告
    const adIds: string[] = []
    const adsDetails: Array<{
      adId: string
      adName: string
      adsetId: string
      adsetName: string
      creativeId: string
      materialId?: string
      effectiveStatus?: string
    }> = []
    const stepDiagnostics: any[] = []
    let globalAdIndex = 0
    
    const adsetsToUse = allAdsetIds.map((id, idx) => ({
      adsetId: id,
      adsetName: allAdsetNames[idx] || `adset_${idx + 1}`,
    }))
    
    // ===== 优化：先并行上传需要绑定到目标广告账户的素材 =====
    const allMaterials: Array<{ cgIndex: number; matIndex: number; material: any; copywriting: any }> = []
    for (let cgIndex = 0; cgIndex < creativeGroups.length; cgIndex++) {
      const creativeGroup = creativeGroups[cgIndex]
      const copywriting = copywritingPackages[cgIndex % copywritingPackages.length]
      const validMaterials = creativeGroup.materials?.filter((m: any) => m.status === 'uploaded' || m.url) || []
      validMaterials.forEach((material: any, matIndex: number) => {
        allMaterials.push({ cgIndex, matIndex, material, copywriting })
      })
    }
    
    // 收集需要上传的视频
    const videosToUpload = allMaterials.filter(m => 
      m.material.type === 'video' && !m.material.facebookVideoId && m.material.url
    )
    
    // 并行上传视频（限制并发数为 5）
    const videoUploadResults: Map<string, { video_id?: string; thumbnail_url?: string }> = new Map()
    if (videosToUpload.length > 0) {
      logger.info(`[BulkAd] Uploading ${videosToUpload.length} videos in parallel...`)
      const BATCH_SIZE = 5
      for (let i = 0; i < videosToUpload.length; i += BATCH_SIZE) {
        const batch = videosToUpload.slice(i, i + BATCH_SIZE)
        const uploadPromises = batch.map(async ({ material }) => {
          try {
            const result = await uploadVideoFromUrl({
              accountId,
              token,
              videoUrl: material.url,
              title: material.name,
            })
            if (result.success) {
              return { url: material.url, video_id: result.id, thumbnail_url: result.thumbnailUrl }
            }
            logger.error(`[BulkAd] Video upload failed: ${result.error?.message}`)
            stepDiagnostics.push(diagnoseFacebookStepError('video_upload', result.error, `Video upload failed: ${material.name || material.url}`))
            return { url: material.url }
          } catch (err: any) {
            logger.error(`[BulkAd] Video upload error: ${err.message}`)
            stepDiagnostics.push(diagnoseBulkAdError(err, { fallbackCode: 'CREATIVE_OR_MATERIAL_FAILED', entityType: 'creative' }))
            return { url: material.url }
          }
        })
        const results = await Promise.all(uploadPromises)
        results.forEach(r => {
          if (r.video_id) {
            videoUploadResults.set(r.url, { video_id: r.video_id, thumbnail_url: r.thumbnail_url })
          }
        })
        logger.info(`[BulkAd] Uploaded batch ${Math.ceil((i + 1) / BATCH_SIZE)}/${Math.ceil(videosToUpload.length / BATCH_SIZE)}`)
      }
      logger.info(`[BulkAd] All videos uploaded: ${videoUploadResults.size}/${videosToUpload.length} success`)
    }

    // Meta image_hash is scoped to an ad account. A stored hash can only be
    // reused when the creative group is explicitly bound to this same account;
    // portable/legacy groups must upload their URL into the target account first.
    type ImageMaterialEntry = Pick<
      (typeof allMaterials)[number],
      'cgIndex' | 'material'
    >
    const targetAccountId = normalizeForStorage(accountId)
    const shouldUploadImageToTarget = ({
      cgIndex,
      material,
    }: ImageMaterialEntry) => {
      if (material.type !== 'image' || !material.url) return false
      const creativeGroup = creativeGroups[cgIndex]
      const sourceAccountId = normalizeForStorage(creativeGroup?.accountId)
      return (
        !material.facebookImageHash ||
        creativeGroup?.reusePolicy?.requiresTargetUpload === true ||
        !sourceAccountId ||
        sourceAccountId !== targetAccountId
      )
    }

    const imagesToUpload = Array.from(
      new Map(
        allMaterials
          .filter(shouldUploadImageToTarget)
          .map((entry) => [entry.material.url as string, entry] as const),
      ).values(),
    )
    const imageUploadResults = new Map<string, string>()
    if (imagesToUpload.length > 0) {
      logger.info(
        `[BulkAd] Uploading ${imagesToUpload.length} images to target account...`,
      )
      const IMAGE_BATCH_SIZE = 5
      for (let i = 0; i < imagesToUpload.length; i += IMAGE_BATCH_SIZE) {
        const results = await Promise.all(
          imagesToUpload
            .slice(i, i + IMAGE_BATCH_SIZE)
            .map(async ({ material }) => {
              try {
                const result = await uploadImageFromUrl({
                  accountId,
                  token,
                  imageUrl: material.url,
                  name: material.name,
                })
                if (result?.success && result.hash) {
                  return { url: material.url, hash: result.hash }
                }
                logger.error(
                  `[BulkAd] Image upload failed: ${result?.error?.message}`,
                )
                stepDiagnostics.push(
                  diagnoseFacebookStepError(
                    'image_upload',
                    result?.error,
                    `Image upload failed: ${material.name || material.url}`,
                  ),
                )
                return undefined
              } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err)
                logger.error(`[BulkAd] Image upload error: ${message}`)
                stepDiagnostics.push(
                  diagnoseBulkAdError(err, {
                    fallbackCode: 'CREATIVE_OR_MATERIAL_FAILED',
                    entityType: 'material',
                  }),
                )
                return undefined
              }
            }),
        )
        for (const result of results) {
          if (result) imageUploadResults.set(result.url, result.hash)
        }
      }
      logger.info(
        `[BulkAd] Images uploaded to target account: ${imageUploadResults.size}/${imagesToUpload.length} success`,
      )
    }

    const resolveImageHashForTarget = (
      entry: ImageMaterialEntry,
    ): string | undefined =>
      shouldUploadImageToTarget(entry)
        ? imageUploadResults.get(entry.material.url)
        : entry.material.facebookImageHash
    
    // ===== 1) 为每个素材创建一次 Creative（可复用到多个广告组） =====
    const creativeEntries: Array<{
      cgIndex: number
      matIndex: number
      creativeGroup: any
      material: any
      materials?: any[]
      copywriting: any
      creativeId: string
    }> = []
    
    let creativeIndex = 0
    let failedDynamicMaterialCount = 0
    let expectedDynamicCreativeCount = 0

    if (dynamicCreativeEnabled) {
      const dynamicMaterials = allMaterials.map((entry) => {
        const { material } = entry
        if (material.type === 'image') {
          const hash = resolveImageHashForTarget(entry)
          return hash ? { ...entry, asset: { type: 'image', hash } } : undefined
        }
        if (material.type === 'video') {
          const videoId = material.facebookVideoId || videoUploadResults.get(material.url)?.video_id
          return videoId ? { ...entry, asset: { type: 'video', videoId } } : undefined
        }
        return undefined
      }).filter(Boolean) as Array<any>

      failedDynamicMaterialCount = allMaterials.length - dynamicMaterials.length

      // degrees_of_freedom_spec applies to the whole Creative. Keep assets with
      // different package-level policies separate so one package cannot
      // silently override another package's optimization choice.
      const videoGroupIndexes = new Set(
        dynamicMaterials
          .filter(({ asset }) => asset.type === 'video')
          .map(({ cgIndex }) => cgIndex),
      )
      const dynamicMaterialBuckets = new Map<string, Array<any>>()
      for (const entry of dynamicMaterials) {
        const mode = videoGroupIndexes.has(entry.cgIndex)
          ? getMetaCreativeOptimizationMode(creativeGroups[entry.cgIndex])
          : undefined
        const bucketKey = mode || 'DEFAULT'
        const bucket = dynamicMaterialBuckets.get(bucketKey) || []
        bucket.push(entry)
        dynamicMaterialBuckets.set(bucketKey, bucket)
      }

      // Meta 动态素材单条广告最多聚合 10 个媒体资产；超出时自动拆成下一条 Ad。
      const DYNAMIC_MEDIA_LIMIT = 10
      for (const [bucketKey, bucketMaterials] of dynamicMaterialBuckets) {
        for (let offset = 0; offset < bucketMaterials.length; offset += DYNAMIC_MEDIA_LIMIT) {
          expectedDynamicCreativeCount++
          const chunk = bucketMaterials.slice(offset, offset + DYNAMIC_MEDIA_LIMIT)
          const first = chunk[0]
          const copywriting = first.copywriting
          const websiteUrl = copywriting.links?.websiteUrl || ''
          const images = chunk.filter(({ asset }) => asset.type === 'image').map(({ asset }) => ({ hash: asset.hash }))
          const videos = chunk.filter(({ asset }) => asset.type === 'video').map(({ asset }) => ({ video_id: asset.videoId }))
          const primaryTexts = copywriting.content?.primaryTexts?.length ? copywriting.content.primaryTexts : ['']
          const headlines = copywriting.content?.headlines?.length ? copywriting.content.headlines : ['']
          const descriptions = copywriting.content?.descriptions?.length ? copywriting.content.descriptions : ['']
          const assetFeedSpec: any = {
            images,
            videos,
            bodies: primaryTexts.slice(0, 5).map((text: string) => ({ text })),
            titles: headlines.slice(0, 5).map((text: string) => ({ text })),
            descriptions: descriptions.slice(0, 5).map((text: string) => ({ text })),
            link_urls: [{ website_url: websiteUrl }],
            call_to_action_types: [copywriting.callToAction || 'SHOP_NOW'],
            ad_formats: [
              ...(images.length > 0 ? ['SINGLE_IMAGE'] : []),
              ...(videos.length > 0 ? ['SINGLE_VIDEO'] : []),
            ],
          }
          if (assetFeedSpec.images.length === 0) delete assetFeedSpec.images
          if (assetFeedSpec.videos.length === 0) delete assetFeedSpec.videos

          const objectStorySpec: any = { page_id: accountConfig.pageId }
          if (accountConfig.instagramAccountId) {
            objectStorySpec.instagram_actor_id = accountConfig.instagramAccountId
          }
          const mode = bucketKey === 'DEFAULT'
            ? undefined
            : bucketKey as MetaCreativeOptimizationMode
          const degreesOfFreedomSpec = videos.length > 0
            ? buildMetaCreativeOptimizationSpec(mode)
            : undefined

          creativeIndex++
          const creativeResult = await createAdCreative({
            accountId,
            token,
            name: `${campaignName}_dynamic_creative_${creativeIndex}`,
            objectStorySpec,
            degreesOfFreedomSpec,
            assetFeedSpec,
          })
          if (!creativeResult.success) {
            stepDiagnostics.push(diagnoseFacebookStepError(
              'creative',
              creativeResult.error,
              `Dynamic creative ${creativeIndex} creation failed`,
            ))
            continue
          }
          creativeEntries.push({
            cgIndex: first.cgIndex,
            matIndex: first.matIndex,
            creativeGroup: creativeGroups[first.cgIndex],
            material: first.material,
            materials: chunk.map(({ material }) => material),
            copywriting,
            creativeId: creativeResult.id,
          })
        }
      }
    } else for (const { cgIndex, matIndex, material, copywriting } of allMaterials) {
      const creativeGroup = creativeGroups[cgIndex]
      
      // 处理素材引用
      let materialRef: any = {}
      if (material.type === 'image') {
        const imageHash = resolveImageHashForTarget({ cgIndex, material })
        if (imageHash) {
          materialRef.image_hash = imageHash
        } else if (material.url && shouldUploadImageToTarget({ cgIndex, material })) {
          logger.error(`[BulkAd] No target-account image hash for: ${material.name}, skipping`)
          continue
        }
      } else if (material.type === 'video') {
        if (material.facebookVideoId) {
          materialRef.video_id = material.facebookVideoId
          materialRef.thumbnail_url = material.thumbnailUrl
        } else if (material.url) {
          // 使用预上传的结果
          const uploadResult = videoUploadResults.get(material.url)
          if (uploadResult?.video_id) {
            materialRef.video_id = uploadResult.video_id
            materialRef.thumbnail_url = uploadResult.thumbnail_url || material.thumbnailUrl || material.url
          } else {
            logger.error(`[BulkAd] No upload result for video: ${material.name}, skipping`)
            stepDiagnostics.push(diagnoseBulkAdError({
              entityType: 'material',
              errorCode: 'CREATIVE_OR_MATERIAL_FAILED',
              errorMessage: `视频素材「${material.name || material._id || matIndex + 1}」上传失败，未获得 Meta video_id`,
              timestamp: new Date(),
            }, { fallbackCode: 'CREATIVE_OR_MATERIAL_FAILED', entityType: 'material' }))
            continue
          }
        }
      }
      
      // 检查是否有有效素材
      if (!materialRef.image_hash && !materialRef.video_id) {
        logger.warn(`[BulkAd] No valid material reference for material: ${material.name}, skipping`)
        continue
      }
      
      creativeIndex++
      const creativeName = `${campaignName}_creative_${creativeIndex}`
      
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
        
        // Meta 的 link_data.caption 必须是完整网址；历史文案包里可能把
        // 产品名（例如 "Leyon"）放在这里，不能原样发送给 Meta。
        if (isHttpUrl(copywriting.links?.displayLink)) {
          linkData.caption = copywriting.links.displayLink
        }
        
        const objectStorySpec: any = {
          page_id: accountConfig.pageId,
          link_data: linkData,
        }
        
        if (materialRef.image_hash) {
          objectStorySpec.link_data.image_hash = materialRef.image_hash
        } else if (materialRef.video_id) {
          // 视频广告：使用 video_data 替代 link_data
          const link = objectStorySpec.link_data.link
          const message = objectStorySpec.link_data.message
          const title = objectStorySpec.link_data.name
          const description = objectStorySpec.link_data.description
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
          degreesOfFreedomSpec: material.type === 'video'
            ? buildMetaCreativeOptimizationSpec(getMetaCreativeOptimizationMode(creativeGroup))
            : undefined,
        })
        
        if (!creativeResult.success) {
          logger.error(`[BulkAd] Failed to create creative for material ${matIndex + 1}:`, creativeResult.error)
          stepDiagnostics.push(diagnoseFacebookStepError('creative', creativeResult.error, `Creative creation failed for material ${material.name || matIndex + 1}`))
          continue
        }
        
      creativeEntries.push({
        cgIndex,
        matIndex,
        creativeGroup,
        material,
        copywriting,
        creativeId: creativeResult.id,
      })
    }
        
    // ===== 2) 为每个广告组创建 Ads（复用 Creative） =====
    for (const { adsetId, adsetName } of adsetsToUse) {
      for (const entry of creativeEntries) {
        const creativeGroup = entry.creativeGroup
        const material = entry.material
        
        globalAdIndex++
        
        // 生成精确到分钟的时间戳
        const now = new Date()
        const datetime = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
        
        const adName = generateName(config.ad.nameTemplate, {
          accountName: accountConfig.accountName,
          campaignName,
          adsetName,
          creativeGroupName: creativeGroup.name,
          materialName: material.name || `素材${entry.matIndex + 1}`,
          index: globalAdIndex,
          date: now.toISOString().slice(0, 10),
          datetime, // 精确到分钟: 20251211_1430
        })
        
        const adResult = await createAd({
          accountId,
          token,
          adsetId,
          creativeId: entry.creativeId,
          name: adName,
          status: config.ad.status || 'PAUSED',
          urlTags: config.ad.tracking?.urlTags,
        })
        
        if (!adResult.success) {
          logger.error(`[BulkAd] Failed to create ad for material ${entry.matIndex + 1}:`, adResult.error)
          stepDiagnostics.push(diagnoseFacebookStepError('ad', adResult.error, `Ad creation failed for material ${material.name || entry.matIndex + 1}`))
          continue
        }
        
        adIds.push(adResult.id)
        
        // 记录广告详情（用于审核状态追踪）
        adsDetails.push({
          adId: adResult.id,
          adName,
          adsetId,
          adsetName,
          creativeId: entry.creativeId,
          materialId: material._id?.toString(),
          effectiveStatus: 'PENDING_REVIEW', // 新创建的广告默认为审核中
        })
        
        logger.info(`[BulkAd] Created ad ${globalAdIndex}: ${adName}`)
      }
    }
    
    // ==================== 6. 完成任务 ====================
    // 素材数量必须和最终广告数量一致；否则不能把“部分成功”伪装成成功。
    const expectedCreativeCount = dynamicCreativeEnabled
      ? expectedDynamicCreativeCount
      : allMaterials.length
    const expectedAdCount = expectedCreativeCount * adsetsToUse.length
    const skippedCount = Math.max(expectedAdCount - adIds.length, 0)
    const noAdsCreated = adIds.length === 0
    const materialsIncomplete = expectedAdCount === 0 || skippedCount > 0 || failedDynamicMaterialCount > 0
    const finalStatus = materialsIncomplete ? 'failed' : 'success'
    const errorInfo = noAdsCreated
      ? [
        ...stepDiagnostics,
        diagnoseBulkAdError({
          entityType: 'ad',
          errorCode: 'NO_ADS_CREATED',
          errorMessage: stepDiagnostics.length > 0
            ? '所有素材、创意或广告创建步骤均失败，未能创建任何广告'
            : '素材创建失败，未能创建任何广告',
          timestamp: new Date(),
        }),
      ]
      : materialsIncomplete
        ? [
          ...stepDiagnostics,
          diagnoseBulkAdError({
            entityType: 'material',
            errorCode: 'BULK_MATERIALS_INCOMPLETE',
            errorMessage: dynamicCreativeEnabled
              ? `动态素材广告创建不完整：应创建 ${expectedAdCount} 条，实际创建 ${adIds.length} 条，另有 ${failedDynamicMaterialCount} 个素材上传失败`
              : `素材广告创建不完整：应创建 ${expectedAdCount} 条，实际创建 ${adIds.length} 条，跳过 ${skippedCount} 条`,
            timestamp: new Date(),
          }),
        ]
        : undefined
    
    // 原子更新状态
    const updateData: any = {
      'items.$.status': finalStatus,
      'items.$.result.adIds': adIds,
      'items.$.result.expectedCount': expectedAdCount,
      'items.$.result.createdCount': adIds.length,
      'items.$.result.failedCount': skippedCount,
      'items.$.result.skippedCount': skippedCount,
      'items.$.completedAt': new Date(),
      'items.$.ads': adsDetails,  // 保存广告详情用于审核追踪
    }
    if (errorInfo) {
      updateData['items.$.errors'] = errorInfo
    }
    await updateTaskItemAtomic(taskId, accountId, updateData)
    
    // 同步创建 Ad 记录到数据库（用于后续审核状态追踪）
    try {
      for (const adDetail of adsDetails) {
        await Ad.findOneAndUpdate(
          { adId: adDetail.adId },
          {
            $set: {
              adId: adDetail.adId,
              name: adDetail.adName,
              adsetId: adDetail.adsetId,
              adsetName: (adDetail as any).adsetName,
              campaignId,
              campaignName,
              accountId,
              organizationId: task.organizationId,
              creativeId: adDetail.creativeId,
              materialId: adDetail.materialId,
              taskId,
              effectiveStatus: 'PENDING_REVIEW',
              status: config.ad.status || 'PAUSED',
            },
          },
          { upsert: true }
        )
        
        // 【关键修复】建立 Ad-Material 映射（用于素材数据归因）
        if (adDetail.materialId) {
          try {
            await (AdMaterialMapping as any).recordMapping({
              adId: adDetail.adId,
              materialId: adDetail.materialId,
              organizationId: task.organizationId?.toString(),
              accountId,
              campaignId,
              adsetId: adDetail.adsetId,
              creativeId: adDetail.creativeId,
              publishedBy: task.createdBy?.toString(),
              taskId,
            })
            logger.info('[BulkAd] Recorded ad-material mapping', {
              materialId: adDetail.materialId,
              hasAdId: Boolean(adDetail.adId),
              hasAccountId: Boolean(accountId),
              hasCampaignId: Boolean(campaignId),
              hasTaskId: Boolean(taskId),
            })
          } catch (mappingErr: any) {
            logger.warn(`[BulkAd] Failed to record ad-material mapping:`, mappingErr.message)
          }
        }
      }
      logger.info(`[BulkAd] Saved ${adsDetails.length} ad records for review tracking`)
    } catch (adSaveErr: any) {
      logger.warn(`[BulkAd] Failed to save ad records:`, adSaveErr.message)
    }
    
    // 更新总体进度（原子操作）
    await updateTaskProgressAtomic(taskId)
    
    logger.info(`[BulkAd] Task ${finalStatus} for account ${accountId}: ${adIds.length} ads created`)
    
    return {
      success: finalStatus === 'success',
      campaignId,
      adsetIds: allAdsetIds,
      adIds,
      expectedCount: expectedAdCount,
      skippedCount,
    }
    
  } catch (error: any) {
    logger.error(`[BulkAd] Task failed for account ${accountId}:`, error)
    if (pinnedCredentialId) {
      try {
        await recordOperationalCredentialFailure(pinnedCredentialId, error)
      } catch (credentialError) {
        logger.error(
          `[BulkAd] Failed to record System User credential failure ${pinnedCredentialId}:`,
          credentialError,
        )
      }
    }
    
    // 原子更新失败状态
    await updateTaskItemAtomic(taskId, accountId, {
      'items.$.status': 'failed',
      'items.$.completedAt': new Date(),
      'items.$.errors': [diagnoseBulkAdError(error, { fallbackCode: 'EXECUTION_ERROR', entityType: 'general' })],
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
export const getTask = async (taskId: string, accessFilter: any = {}) => {
  const task = await AdTask.findOne(combineFilters({ _id: taskId }, accessFilter)).populate('draftId')
  if (!task) {
    throw new Error('Task not found')
  }
  return enrichTaskDiagnostics(task)
}

export const getTaskDiagnostics = async (taskId: string, accessFilter: any = {}) => {
  const task = await AdTask.findOne(combineFilters({ _id: taskId }, accessFilter)).lean()
  if (!task) {
    throw new Error('Task not found')
  }
  return buildTaskOperationalDiagnostics(task)
}

const buildTaskSupportId = (taskId: string, generatedAt: Date) => {
  const timestamp = generatedAt.toISOString().replace(/\D/g, '').slice(0, 14)
  const suffix = String(taskId || 'task').slice(-6)
  return `AUTOARK-TASK-${timestamp}-${suffix}`
}

const redactSensitiveText = (value: any) => {
  if (typeof value !== 'string') return value
  return value
    .replace(/(access[_-]?token|token|secret|password)(\s*[=:]\s*)[^&\s,;]+/gi, '$1$2[REDACTED]')
    .replace(/\bEAA[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_TOKEN]')
}

const safeDiagnosticError = (error: any) => ({
  entityType: error.entityType,
  errorCode: error.errorCode,
  customerMessage: error.customerMessage,
  operatorMessage: redactSensitiveText(error.operatorMessage),
  retryable: error.retryable,
  nextActions: error.nextActions,
  source: error.source,
  rawCode: error.rawCode,
  rawSubcode: error.rawSubcode,
  timestamp: error.timestamp,
})

const TASK_SUPPORT_FAILED_ITEM_LIMIT = 20
const TASK_SUPPORT_ITEM_ERROR_LIMIT = 5

export const getTaskSupportPackage = async (taskId: string, accessFilter: any = {}) => {
  const task: any = await AdTask.findOne(combineFilters({ _id: taskId }, accessFilter))
    .populate('draftId')
    .lean()
  if (!task) {
    throw new Error('Task not found')
  }

  const generatedAt = new Date()
  const diagnostics = buildTaskOperationalDiagnostics(task)
  const allFailedItems = (task.items || [])
    .filter((item: any) => item.status === 'failed' || (Array.isArray(item.errors) && item.errors.length > 0))
  const failedItems = allFailedItems
    .slice(0, TASK_SUPPORT_FAILED_ITEM_LIMIT)
    .map((item: any) => {
      const itemErrors = Array.isArray(item.errors) && item.errors.length > 0
        ? item.errors
        : item.error || 'Task item failed without structured error'
      const normalizedErrors = normalizeTaskErrors(itemErrors, {
        entityType: item.status === 'failed' ? 'general' : undefined,
      })
      const errorTotal = normalizedErrors.length

      return {
        accountId: item.accountId,
        accountName: item.accountName,
        status: item.status,
        createdCount: item.result?.createdCount || 0,
        startedAt: item.startedAt,
        completedAt: item.completedAt,
        duration: item.duration,
        errorTotal,
        errorsTruncated: errorTotal > TASK_SUPPORT_ITEM_ERROR_LIMIT,
        errors: normalizedErrors
          .slice(0, TASK_SUPPORT_ITEM_ERROR_LIMIT)
          .map(safeDiagnosticError),
      }
    })

  const auditQuery: any = {
    $or: [
      { targetType: 'ad_task', targetId: taskId },
      { 'related.newTaskIds': taskId },
    ],
  }
  if (task.organizationId) {
    auditQuery.organizationId = task.organizationId
  }
  const recentAuditLogs = await OpsLog.find(auditQuery)
    .sort({ createdAt: -1 })
    .limit(12)
    .select('category action status targetType targetId summary reason related requestId createdAt')
    .lean()
  const safeRecentAuditLogs = recentAuditLogs.map((log: any) => ({
    category: log.category,
    action: log.action,
    status: log.status,
    targetType: log.targetType,
    targetId: log.targetId,
    summary: redactSensitiveText(log.summary),
    reason: redactSensitiveText(log.reason),
    related: log.related,
    requestId: log.requestId,
    createdAt: log.createdAt,
  }))

  return {
    supportId: buildTaskSupportId(taskId, generatedAt),
    generatedAt: generatedAt.toISOString(),
    system: {
      build: getBuildInfo(),
    },
    task: {
      id: String(task._id),
      name: task.name,
      status: task.status,
      platform: task.platform,
      taskType: task.taskType,
      organizationId: task.organizationId ? String(task.organizationId) : undefined,
      createdBy: task.createdBy,
      draftId: task.draftId?._id ? String(task.draftId._id) : task.draftId ? String(task.draftId) : undefined,
      createdAt: task.createdAt,
      queuedAt: task.queuedAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      duration: task.duration,
      reviewStatus: task.reviewStatus,
      progress: task.progress,
    },
    diagnostics: {
      ...diagnostics,
      buckets: diagnostics.buckets.slice(0, 8).map(bucket => ({
        ...bucket,
        accounts: bucket.accounts.slice(0, 10),
        nextActions: bucket.nextActions.slice(0, 4),
      })),
      topNextActions: diagnostics.topNextActions.slice(0, 6),
    },
    failedItems,
    limits: {
      failedItems: {
        total: allFailedItems.length,
        returned: failedItems.length,
        maxReturned: TASK_SUPPORT_FAILED_ITEM_LIMIT,
        truncated: allFailedItems.length > failedItems.length,
      },
      itemErrors: {
        maxReturned: TASK_SUPPORT_ITEM_ERROR_LIMIT,
      },
    },
    recentAuditLogs: safeRecentAuditLogs,
  }
}

const buildTaskListDiagnostics = (task: any) => {
  const diagnostics = buildTaskOperationalDiagnostics(task)
  return {
    ...diagnostics,
    buckets: diagnostics.buckets.slice(0, 3).map(bucket => ({
      ...bucket,
      accounts: bucket.accounts.slice(0, 3),
      nextActions: bucket.nextActions.slice(0, 2),
    })),
    topNextActions: diagnostics.topNextActions.slice(0, 3),
  }
}

const normalizeDiagnosticFilter = (value: any) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed && trimmed !== 'all' ? trimmed : undefined
}

const toTaskListItem = (task: any) => {
  const enriched = enrichTaskDiagnostics(task)
  return {
    ...enriched,
    operationalDiagnostics: buildTaskListDiagnostics(enriched),
  }
}

/**
 * 获取任务列表
 * @param query 查询参数
 * @param userFilter 用户过滤条件（来自 getAssetFilter）
 */
export const getTaskList = async (query: any = {}, userFilter: any = {}) => {
  const status = pickAllowedString(query.status, TASK_LIST_STATUSES, '')
  const taskType = pickAllowedString(query.taskType, TASK_LIST_TYPES, '')
  const platform = pickAllowedString(query.platform, TASK_LIST_PLATFORMS, '')
  const { page, pageSize, skip } = parsePagination(query)
  const diagnosticHealth = normalizeDiagnosticFilter(query.diagnosticHealth || query.health)
  const diagnosticErrorCode = normalizeDiagnosticFilter(query.errorCode)?.toUpperCase()
  
  // 合并用户过滤条件
  const filter: any = { ...userFilter }
  if (status) filter.status = status
  if (taskType) filter.taskType = taskType
  if (platform) filter.platform = platform

  if (diagnosticHealth || diagnosticErrorCode) {
    const scanLimit = parseLimitedNumber(
      query.diagnosticScanLimit ?? query.scanLimit,
      DEFAULT_DIAGNOSTIC_TASK_SCAN_LIMIT,
      MAX_DIAGNOSTIC_TASK_SCAN_LIMIT,
    )
    const tasks = await AdTask.find(filter)
      .sort({ createdAt: -1 })
      .limit(scanLimit + 1)
      .lean()
    const scanTruncated = tasks.length > scanLimit
    const scannedTasks = scanTruncated ? tasks.slice(0, scanLimit) : tasks
    const filtered = scannedTasks.map(toTaskListItem).filter(task => {
      const diagnostics = task.operationalDiagnostics
      if (diagnosticHealth && diagnostics.health !== diagnosticHealth) return false
      if (diagnosticErrorCode && !diagnostics.buckets.some((bucket: any) => bucket.errorCode === diagnosticErrorCode)) return false
      return true
    })
    return {
      list: filtered.slice(skip, skip + pageSize),
      total: filtered.length,
      page,
      pageSize,
      meta: {
        diagnosticScan: {
          enabled: true,
          scanLimit,
          scannedCount: scannedTasks.length,
          matchedCount: filtered.length,
          truncated: scanTruncated,
        },
      },
    }
  }
  
  const [list, total] = await Promise.all([
    AdTask.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean(),
    AdTask.countDocuments(filter),
  ])
  
  return {
    list: list.map(toTaskListItem),
    total,
    page,
    pageSize,
  }
}

/**
 * 取消任务
 */
export const cancelTask = async (taskId: string, accessFilter: any = {}) => {
  const task: any = await AdTask.findOne(combineFilters({ _id: taskId }, accessFilter))
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
export const retryFailedItems = async (taskId: string, accessFilter: any = {}) => {
  const task: any = await AdTask.findOne(combineFilters({ _id: taskId }, accessFilter))
  if (!task) {
    throw new Error('Task not found')
  }

  if (hasAiExecutionLineage(task.configSnapshot?.aiOrigin)) {
    const error: any = new Error(
      'AI 投放任务禁止通过通用失败重试重复写入 Meta；请检查已有对象后，以有效授权单创建新的 ReplicaRun',
    )
    error.statusCode = 409
    error.errorCode = 'AI_REPLICA_RETRY_FORBIDDEN'
    throw error
  }
  if (task.draftId) {
    const sourceDraft: any = await AdDraft.findOne(
      combineFilters({ _id: task.draftId }, accessFilter),
    )
      .select('aiOrigin')
      .lean()
    if (hasAiExecutionLineage(sourceDraft?.aiOrigin)) {
      const error: any = new Error(
        'AI 投放任务禁止通过通用失败重试重复写入 Meta；请检查已有对象后，以有效授权单创建新的 ReplicaRun',
      )
      error.statusCode = 409
      error.errorCode = 'AI_REPLICA_RETRY_FORBIDDEN'
      throw error
    }
  }
  
  const failedItems = task.items.filter((i: any) => i.status === 'failed')
  if (failedItems.length === 0) {
    throw new Error('No failed items to retry')
  }

  const isRetryableItem = (item: any) => {
    const itemErrors = normalizeTaskErrors(
      Array.isArray(item.errors) && item.errors.length > 0
        ? item.errors
        : item.error || 'Task item failed without structured error',
      { entityType: 'general' },
    )
    return itemErrors.some(error => error.retryable)
  }

  const retryableItems = failedItems.filter(isRetryableItem)
  const blockedItems = failedItems.filter((item: any) => !isRetryableItem(item))
  if (retryableItems.length === 0) {
    const diagnostics = buildTaskOperationalDiagnostics(task)
    const blockedReasons = diagnostics.buckets
      .filter(bucket => !bucket.retryable)
      .slice(0, 3)
      .map(bucket => `${bucket.errorCode}：${bucket.customerMessage}`)
      .join('；')
    throw new Error(blockedReasons
      ? `没有可重试的失败项。请先处理：${blockedReasons}`
      : '没有可重试的失败项。请先修复权限、账户、Page、Pixel 或素材配置后重新发布任务')
  }
  
  // 只重置可重试项；权限、账户、Pixel 等阻断型失败保留失败状态，避免反复空跑。
  for (const item of retryableItems) {
    item.status = 'pending'
    item.errors = []
    item.startedAt = undefined
    item.completedAt = undefined
  }
  
  const retryCount = (task.retryInfo?.retryCount || 0) + 1
  const successCount = task.items.filter((item: any) => ['success', 'completed'].includes(item.status)).length
  const blockedCount = blockedItems.length
  const completedCount = successCount + blockedCount
  const totalCount = task.items.length || 1

  task.status = blockedCount > 0 ? 'partial_success' : 'pending'
  task.progress = {
    ...(task.progress?.toObject?.() || task.progress || {}),
    successAccounts: successCount,
    failedAccounts: blockedCount,
    completedAccounts: completedCount,
    percentage: Math.round((completedCount / totalCount) * 100),
  }
  task.retryInfo = {
    retryCount,
    lastRetryAt: new Date(),
  }

  const accountIds = retryableItems.map((item: any) => item.accountId)
  const { getRedisClient } = await import('../config/redis')
  const redisAvailable = (() => {
    try {
      return getRedisClient() !== null
    } catch {
      return false
    }
  })()

  if (redisAvailable) {
    const { addBulkAdJobsBatch } = await import('../queue/bulkAd.queue')
    task.status = 'queued'
    task.queuedAt = new Date()
    await task.save()

    await addBulkAdJobsBatch(task._id.toString(), accountIds, 1, `retry-${retryCount}-${Date.now()}`)
    logger.info(`[BulkAd] Task retry queued: ${taskId}, ${accountIds.length} account(s)`)
  } else {
    task.status = 'processing'
    task.startedAt = new Date()
    await task.save()

    for (const accountId of accountIds) {
      executeTaskForAccount(task._id.toString(), accountId).catch(err => {
        logger.error(`[BulkAd] Retry failed for account ${accountId}:`, err)
      })
    }
    logger.info(`[BulkAd] Task retry started synchronously: ${taskId}, ${accountIds.length} account(s)`)
  }
  
  return task
}

/**
 * 重新执行任务（基于原任务配置创建新任务）
 * @param taskId 原任务ID
 * @param multiplier 执行倍率（创建多少个新任务）
 * @param userId 当前用户ID（用于任务命名）
 */
export const rerunTask = async (
  taskId: string,
  multiplier: number = 1,
  userId?: string,
  accessFilter: any = {},
) => {
  const originalTask: any = await AdTask.findOne(combineFilters({ _id: taskId }, accessFilter))
  if (!originalTask) {
    throw new Error('Task not found')
  }
  
  if (!originalTask.configSnapshot || !originalTask.configSnapshot.accounts) {
    throw new Error('Task config snapshot not found')
  }

  if (hasAiExecutionLineage(originalTask.configSnapshot?.aiOrigin)) {
    const error: any = new Error(
      'AI 投放任务不能通过通用重跑复制；必须使用当前有效授权单创建新的 ReplicaRun',
    )
    error.statusCode = 409
    error.errorCode = 'AI_REPLICA_RERUN_FORBIDDEN'
    throw error
  }

  if (originalTask.draftId) {
    const sourceDraft: any = await AdDraft.findOne(
      combineFilters({ _id: originalTask.draftId }, accessFilter),
    )
      .select('aiOrigin')
      .lean()
    if (hasAiExecutionLineage(sourceDraft?.aiOrigin)) {
      const error: any = new Error(
        'AI 投放任务不能通过通用重跑复制；必须使用当前有效授权单创建新的 ReplicaRun',
      )
      error.statusCode = 409
      error.errorCode = 'AI_REPLICA_RERUN_FORBIDDEN'
      throw error
    }
  }
  
  const config = originalTask.configSnapshot
  const safeMultiplier = normalizeRerunMultiplier(multiplier)  // 限制 1-20
  await assertBulkAdPublishAllowed({
    organizationId: originalTask.organizationId?.toString(),
    requestedAccounts: config.accounts.length,
    requestedTasks: safeMultiplier,
  })
  
  // 获取用户名
  let userName = 'unknown'
  if (userId) {
    try {
      const user = await User.findById(userId).lean()
      userName = user?.username?.replace(/[^a-zA-Z0-9\u4e00-\u9fa5-]/g, '') || 'unknown'
    } catch (e) {
      logger.warn('[BulkAd] Failed to get username for rerun')
    }
  } else if (originalTask.createdBy) {
    // 如果没有传入 userId，尝试从原任务获取
    try {
      const user = await User.findById(originalTask.createdBy).lean()
      userName = user?.username?.replace(/[^a-zA-Z0-9\u4e00-\u9fa5-]/g, '') || 'unknown'
    } catch (e) {
      logger.warn('[BulkAd] Failed to get username from original task')
    }
  }
  
  const newTasks: any[] = []
  
  for (let i = 0; i < safeMultiplier; i++) {
    // 生成任务名称：日期时间精确到秒
    const now = new Date()
    const dateTimeStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
    const taskName = `autoark${userName}_${dateTimeStr}${safeMultiplier > 1 ? `_${i + 1}` : ''}`
    
    // 创建新任务
    const newTask: any = new AdTask({
      name: taskName,
      taskType: originalTask.taskType,
      status: 'pending',
      platform: originalTask.platform,
      draftId: originalTask.draftId,
      organizationId: originalTask.organizationId,
      configSnapshot: config,
      publishSettings: originalTask.publishSettings,
      notes: `重新执行自任务 ${taskId}${safeMultiplier > 1 ? ` (${i + 1}/${safeMultiplier})` : ''}`,
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
      createdBy: userId || originalTask.createdBy,
    })
    
    await newTask.save()
    newTasks.push(newTask)
    logger.info(`[BulkAd] Task rerun created: ${newTask._id} (from ${taskId}, ${i + 1}/${safeMultiplier})`)
  }
  
  // 检查 Redis 是否可用
  const { getRedisClient } = await import('../config/redis')
  const redisAvailable = (() => {
    try {
      return getRedisClient() !== null
    } catch {
      return false
    }
  })()
  
  // 为每个新任务启动执行
  for (const newTask of newTasks) {
    const accountIds = config.accounts.map((acc: any) => acc.accountId)
    
    if (redisAvailable) {
      // Redis 可用，使用队列异步执行
      const { addBulkAdJobsBatch } = await import('../queue/bulkAd.queue')
      
      newTask.status = 'queued'
      newTask.queuedAt = new Date()
      await newTask.save()
      
      await addBulkAdJobsBatch(newTask._id.toString(), accountIds)
      logger.info(`[BulkAd] Task ${newTask._id} queued, ${accountIds.length} accounts`)
    } else {
      // Redis 不可用，直接同步执行
      logger.info(`[BulkAd] Redis unavailable, executing task ${newTask._id} synchronously`)
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
  }
  
  return newTasks
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
  getTaskDiagnostics,
  getTaskSupportPackage,
  getTaskList,
  cancelTask,
  retryFailedItems,
  rerunTask,
}
