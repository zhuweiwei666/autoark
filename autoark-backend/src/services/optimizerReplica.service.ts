import mongoose from 'mongoose'
import Account from '../models/Account'
import AdDraft from '../models/AdDraft'
import AdTask from '../models/AdTask'
import CopywritingPackage from '../models/CopywritingPackage'
import CreativeGroup from '../models/CreativeGroup'
import FacebookUser from '../models/FacebookUser'
import FbToken from '../models/FbToken'
import MetricsDaily from '../models/MetricsDaily'
import PlaybookVersion from '../models/PlaybookVersion'
import ReplicaRun from '../models/ReplicaRun'
import { combineFilters, objectIdValue } from '../utils/accessControl'
import { getAccountIdsForQuery, normalizeForStorage } from '../utils/accountId'
import { createDraft, publishDraft, validateDraft } from './bulkAd.service'

const APPROVE_CONFIRMATION = 'APPROVE_PAUSED_REPLICA'
const PUBLISH_CONFIRMATION = 'PUBLISH_PAUSED_REPLICA'
const PURCHASE_ACTION_TYPES = [
  'purchase',
  'mobile_app_purchase',
  'offsite_conversion.fb_pixel_purchase',
  'onsite_conversion.purchase',
  'onsite_conversion.purchase.mobile_app',
]
const CTA_VALUES = new Set([
  'SHOP_NOW',
  'LEARN_MORE',
  'SIGN_UP',
  'DOWNLOAD',
  'GET_OFFER',
  'GET_QUOTE',
  'BOOK_NOW',
  'CONTACT_US',
  'SUBSCRIBE',
  'WATCH_MORE',
  'APPLY_NOW',
  'BUY_NOW',
  'ORDER_NOW',
  'SEE_MORE',
  'MESSAGE_PAGE',
  'WHATSAPP_MESSAGE',
  'CALL_NOW',
  'GET_DIRECTIONS',
  'NO_BUTTON',
])

const asNumber = (value: any, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const errorWithStatus = (message: string, statusCode = 400, details?: any) => {
  const error: any = new Error(message)
  error.statusCode = statusCode
  if (details) error.details = details
  return error
}

const cleanString = (value: any, max = 200): string =>
  String(value || '')
    .trim()
    .slice(0, max)

const uniqueStrings = (values: any[]): string[] =>
  Array.from(
    new Set(values.map((value) => cleanString(value, 300)).filter(Boolean)),
  )

const orgConstraint = (organizationId?: any) =>
  organizationId
    ? { organizationId: objectIdValue(String(organizationId)) }
    : {
        $or: [{ organizationId: { $exists: false } }, { organizationId: null }],
      }

const findPlaybook = async (id: string, accessFilter: any) => {
  if (!mongoose.Types.ObjectId.isValid(id))
    throw errorWithStatus('打法版本 ID 无效')
  const playbook: any = await PlaybookVersion.findOne(
    combineFilters({ _id: id }, accessFilter),
  ).lean()
  if (!playbook) throw errorWithStatus('打法版本不存在或无权访问', 404)
  return playbook
}

const taskStatusToReplicaStatus = (status?: string) => {
  if (status === 'success') return 'published'
  if (status === 'partial_success') return 'partial'
  if (status === 'failed' || status === 'cancelled') return 'failed'
  if (status === 'pending' || status === 'queued' || status === 'processing')
    return 'publishing'
  return undefined
}

const buildEffectiveReplica = (run: any, task?: any) => {
  const taskDerivedStatus = taskStatusToReplicaStatus(task?.status)
  const shouldUseTaskStatus = [
    'publishing',
    'published',
    'partial',
    'failed',
  ].includes(run.status)
  return {
    ...run,
    effectiveStatus:
      shouldUseTaskStatus && taskDerivedStatus ? taskDerivedStatus : run.status,
    task: task
      ? {
          _id: task._id,
          name: task.name,
          status: task.status,
          progress: task.progress,
          createdAt: task.createdAt,
          completedAt: task.completedAt,
        }
      : undefined,
  }
}

const candidatePagesForAccount = (snapshot: any, accountId: string) =>
  (snapshot.pages || []).filter((page: any) => {
    const explicitlyLinked = (page.accounts || []).some(
      (account: any) => normalizeForStorage(account.accountId) === accountId,
    )
    const sameTokenManaged =
      typeof page.accessToken === 'string' && page.accessToken.trim().length > 0
    return explicitlyLinked || sameTokenManaged
  })

const candidatePixelsForAccount = (snapshot: any, accountId: string) =>
  (snapshot.pixels || []).filter((pixel: any) =>
    (pixel.accounts || []).some(
      (account: any) => normalizeForStorage(account.accountId) === accountId,
    ),
  )

const sanitizedAssetSnapshot = (token: any, snapshot: any) => ({
  tokenId: String(token._id),
  optimizer: token.optimizer,
  fbUserId: token.fbUserId,
  fbUserName: token.fbUserName || snapshot?.fbUserName,
  status: token.status,
  lastSyncedAt: snapshot?.lastSyncedAt,
  syncStatus: snapshot?.syncStatus,
  accounts: (snapshot?.adAccounts || []).map((account: any) => {
    const accountId = normalizeForStorage(account.accountId)
    return {
      accountId,
      name: account.name,
      status: account.status,
      currency: account.currency,
      timezone: account.timezone,
      pages: candidatePagesForAccount(snapshot, accountId).map((page: any) => ({
        pageId: page.pageId,
        name: page.name,
      })),
      pixels: candidatePixelsForAccount(snapshot, accountId).map(
        (pixel: any) => ({
          pixelId: pixel.pixelId,
          name: pixel.name,
        }),
      ),
    }
  }),
})

export const listReplicaAssets = async ({
  playbookId,
  accessFilter = {},
  tokenAccessFilter = {},
}: {
  playbookId: string
  accessFilter?: any
  tokenAccessFilter?: any
}) => {
  const playbook = await findPlaybook(playbookId, accessFilter)
  const tokens: any[] = await FbToken.find(
    combineFilters(
      { status: 'active' },
      tokenAccessFilter,
      orgConstraint(playbook.organizationId),
    ),
  )
    .select('_id userId optimizer status fbUserId fbUserName organizationId')
    .lean()
  const tokenIds = tokens.map((token) => token._id)
  const snapshots: any[] =
    tokenIds.length > 0
      ? await FacebookUser.find({
          tokenId: { $in: tokenIds },
          syncStatus: 'completed',
        }).lean()
      : []
  const snapshotByToken = new Map(
    snapshots.map((snapshot) => [String(snapshot.tokenId), snapshot]),
  )

  return {
    playbookId: String(playbook._id),
    organizationId: playbook.organizationId,
    tokens: tokens
      .map((token) => {
        const snapshot = snapshotByToken.get(String(token._id))
        return snapshot ? sanitizedAssetSnapshot(token, snapshot) : null
      })
      .filter(Boolean),
  }
}

const selectSingleAsset = ({
  requestedId,
  candidates,
  idKey,
  label,
  accountId,
}: {
  requestedId?: string
  candidates: any[]
  idKey: string
  label: string
  accountId: string
}) => {
  if (requestedId) {
    const selected = candidates.find(
      (candidate) => String(candidate[idKey]) === requestedId,
    )
    if (!selected) {
      throw errorWithStatus(`账户 ${accountId} 无权使用所选 ${label}`, 409, {
        accountId,
        candidates: candidates.map((candidate) => ({
          id: candidate[idKey],
          name: candidate.name,
        })),
      })
    }
    return selected
  }
  if (candidates.length !== 1) {
    throw errorWithStatus(
      `账户 ${accountId} 的可用 ${label} 数量为 ${candidates.length}，需要明确选择`,
      409,
      {
        accountId,
        candidates: candidates.map((candidate) => ({
          id: candidate[idKey],
          name: candidate.name,
        })),
      },
    )
  }
  return candidates[0]
}

const resolveTargetAccounts = async ({
  snapshot,
  requestedAccounts,
  organizationId,
  requiresPixel,
}: {
  snapshot: any
  requestedAccounts: any[]
  organizationId?: any
  requiresPixel: boolean
}) => {
  if (!Array.isArray(requestedAccounts) || requestedAccounts.length === 0) {
    throw errorWithStatus('请至少选择一个目标广告账户')
  }
  if (requestedAccounts.length > 20) {
    throw errorWithStatus('单个 AI 复制任务最多支持 20 个目标账户')
  }
  const normalizedRequested = requestedAccounts.map((account) => ({
    ...account,
    accountId: normalizeForStorage(
      typeof account === 'string' ? account : account?.accountId,
    ),
  }))
  if (normalizedRequested.some((account) => !account.accountId)) {
    throw errorWithStatus('目标账户列表包含无效 accountId')
  }
  if (
    uniqueStrings(normalizedRequested.map((account) => account.accountId))
      .length !== normalizedRequested.length
  ) {
    throw errorWithStatus('目标广告账户不能重复')
  }

  const cachedAccountById = new Map(
    (snapshot.adAccounts || []).map((account: any) => [
      normalizeForStorage(account.accountId),
      account,
    ]),
  )
  const scopedAccounts: any[] = await Account.find({
    channel: 'facebook',
    accountId: {
      $in: getAccountIdsForQuery(
        normalizedRequested.map((account) => account.accountId),
      ),
    },
    ...orgConstraint(organizationId),
  })
    .select('accountId name status organizationId')
    .lean()
  const scopedAccountById = new Map(
    scopedAccounts.map((account) => [
      normalizeForStorage(account.accountId),
      account,
    ]),
  )

  return normalizedRequested.map((requested) => {
    const cachedAccount: any = cachedAccountById.get(requested.accountId)
    const scopedAccount: any = scopedAccountById.get(requested.accountId)
    if (!cachedAccount || !scopedAccount) {
      throw errorWithStatus(
        `目标账户 ${requested.accountId} 不在当前授权或组织范围内`,
        409,
      )
    }
    if (cachedAccount.status !== 1) {
      throw errorWithStatus(
        `目标账户 ${requested.accountId} 当前状态不可投放`,
        409,
      )
    }

    const page = selectSingleAsset({
      requestedId: cleanString(requested.pageId),
      candidates: candidatePagesForAccount(snapshot, requested.accountId),
      idKey: 'pageId',
      label: 'Facebook Page',
      accountId: requested.accountId,
    })
    const pixelCandidates = candidatePixelsForAccount(
      snapshot,
      requested.accountId,
    )
    const pixel = requiresPixel
      ? selectSingleAsset({
          requestedId: cleanString(requested.pixelId),
          candidates: pixelCandidates,
          idKey: 'pixelId',
          label: 'Pixel',
          accountId: requested.accountId,
        })
      : requested.pixelId
        ? selectSingleAsset({
            requestedId: cleanString(requested.pixelId),
            candidates: pixelCandidates,
            idKey: 'pixelId',
            label: 'Pixel',
            accountId: requested.accountId,
          })
        : undefined

    return {
      accountId: requested.accountId,
      accountName: cleanString(
        requested.accountName || cachedAccount.name || scopedAccount.name,
      ),
      currency: cleanString(cachedAccount.currency, 20) || undefined,
      pageId: String(page.pageId),
      pageName: page.name,
      instagramAccountId:
        cleanString(requested.instagramAccountId) || undefined,
      pixelId: pixel?.pixelId ? String(pixel.pixelId) : undefined,
      pixelName: pixel?.name,
      domain: cleanString(requested.domain) || undefined,
      conversionEvent: cleanString(requested.conversionEvent || 'PURCHASE', 80),
    }
  })
}

const attributionFromPlaybook = (spec: any) => {
  if (!Array.isArray(spec)) return undefined
  const result: any = {}
  for (const entry of spec) {
    const eventType = String(entry?.event_type || '').toUpperCase()
    const days = asNumber(entry?.window_days)
    if (eventType === 'CLICK_THROUGH' && [1, 7, 28].includes(days))
      result.clickWindow = days
    if (eventType === 'VIEW_THROUGH' && [0, 1].includes(days))
      result.viewWindow = days
    if (eventType === 'ENGAGED_VIDEO_VIEW' && [0, 1].includes(days))
      result.engagedViewWindow = days
  }
  return Object.keys(result).length > 0 ? result : undefined
}

export const assertAiDraftPaused = (draft: any) => {
  if (!draft?.aiOrigin?.statusLockedToPaused) {
    throw errorWithStatus('草稿缺少 AI PAUSED 状态锁', 409)
  }
  const statuses = {
    campaign: draft.campaign?.status,
    adset: draft.adset?.status,
    ad: draft.ad?.status,
  }
  if (Object.values(statuses).some((status) => status !== 'PAUSED')) {
    throw errorWithStatus(
      'AI 草稿的 Campaign、AdSet 和 Ad 必须全部为 PAUSED',
      409,
      statuses,
    )
  }
  return true
}

const buildTargeting = (
  playbook: any,
  applyTopCountries: boolean,
  countryLimit: number,
) => {
  const targeting = JSON.parse(JSON.stringify(playbook.targeting?.value || {}))
  const changes: string[] = [
    ...(playbook.targeting?.removedAccountScopedKeys || []).map(
      (key: string) => `移除账户专属定向字段 ${key}`,
    ),
  ]
  if (applyTopCountries) {
    const countries = uniqueStrings(
      (playbook.geography || [])
        .filter(
          (entry: any) =>
            entry?.dimension?.country &&
            entry.purchases > 0 &&
            entry.confidence >= 0.34,
        )
        .slice(0, countryLimit)
        .map((entry: any) => entry.dimension.country),
    )
    if (countries.length > 0) {
      targeting.geo_locations = { countries }
      changes.push(`将地域收敛为高转化国家：${countries.join(', ')}`)
    }
  }
  return { targeting, changes }
}

const createReplicaAssets = async ({
  run,
  playbook,
  materialLimit,
  createdBy,
}: {
  run: any
  playbook: any
  materialLimit: number
  createdBy?: string
}) => {
  const selectedMaterials = (playbook.creatives?.materials || []).slice(
    0,
    materialLimit,
  )
  if (selectedMaterials.length === 0)
    throw errorWithStatus('打法版本没有可复制素材', 409)
  const suffix = String(run._id).slice(-8)
  const optimizerLabel = cleanString(playbook.optimizerId, 40).replace(
    /[^\w\u4e00-\u9fa5-]+/g,
    '_',
  )
  const creativeGroup: any = await CreativeGroup.create({
    name: `AI_${optimizerLabel}_v${playbook.version}_${suffix}_素材`,
    organizationId: playbook.organizationId,
    platform: 'facebook',
    materials: selectedMaterials.map((material: any) => ({
      type: material.type,
      url: material.url,
      name: material.name,
      thumbnail: material.thumbnailUrl,
      status: 'uploaded',
      source: 'facebook_sync',
      sourceId: material.materialId,
    })),
    config: {
      format: 'single',
      dynamicCreative: false,
    },
    description: `由投手 ${playbook.optimizerId} 的打法 v${playbook.version} 自动生成`,
    tags: [
      'AI复制',
      `投手:${playbook.optimizerId}`,
      `打法:v${playbook.version}`,
    ],
    createdBy,
  })

  const copy = playbook.copywriting || {}
  const callToAction = CTA_VALUES.has(copy.callToAction)
    ? copy.callToAction
    : 'SHOP_NOW'
  const copywritingPackage: any = await CopywritingPackage.create({
    name: `AI_${optimizerLabel}_v${playbook.version}_${suffix}_文案`,
    organizationId: playbook.organizationId,
    platform: 'facebook',
    content: {
      primaryTexts: (copy.primaryTexts || []).slice(0, 5),
      headlines: (copy.headlines || []).slice(0, 5),
      descriptions: (copy.descriptions || []).slice(0, 5),
    },
    callToAction,
    links: {
      websiteUrl: copy.websiteUrl,
      displayLink: copy.displayLink,
    },
    urlParameters: {
      utmSource: 'autoark_ai',
      utmMedium: 'paid_social',
      utmCampaign: `optimizer_${optimizerLabel}_v${playbook.version}`,
      utmContent: suffix,
    },
    description: `由投手 ${playbook.optimizerId} 的打法 v${playbook.version} 自动生成`,
    tags: [
      'AI复制',
      `投手:${playbook.optimizerId}`,
      `打法:v${playbook.version}`,
    ],
    createdBy,
  })
  return { creativeGroup, copywritingPackage }
}

export const createReplica = async ({
  playbookId,
  facebookTokenId,
  accounts: requestedAccounts,
  dailyBudget,
  materialLimit: materialLimitInput = 3,
  applyTopCountries = true,
  countryLimit: countryLimitInput = 5,
  createdBy,
  accessFilter = {},
  tokenAccessFilter = {},
}: {
  playbookId: string
  facebookTokenId: string
  accounts: any[]
  dailyBudget?: number
  materialLimit?: number
  applyTopCountries?: boolean
  countryLimit?: number
  createdBy?: string
  accessFilter?: any
  tokenAccessFilter?: any
}) => {
  const playbook = await findPlaybook(playbookId, accessFilter)
  if (!playbook.eligibility?.eligible) {
    throw errorWithStatus(
      '该打法版本未达到 AI 复制门槛',
      409,
      playbook.eligibility,
    )
  }
  if (!mongoose.Types.ObjectId.isValid(facebookTokenId)) {
    throw errorWithStatus('facebookTokenId 无效')
  }
  const token: any = await FbToken.findOne(
    combineFilters(
      { _id: facebookTokenId, status: 'active' },
      tokenAccessFilter,
      orgConstraint(playbook.organizationId),
    ),
  ).lean()
  if (!token)
    throw errorWithStatus('目标 Facebook 授权不存在、已失效或无权访问', 404)
  const snapshot: any = await FacebookUser.findOne({
    tokenId: token._id,
    syncStatus: 'completed',
    ...orgConstraint(playbook.organizationId),
  }).lean()
  if (!snapshot)
    throw errorWithStatus(
      '目标 Facebook 授权的账户、Page、Pixel 尚未同步完成',
      409,
    )

  const requiresPixel =
    playbook.structure?.objective === 'OUTCOME_SALES' ||
    playbook.structure?.optimizationGoal === 'OFFSITE_CONVERSIONS'
  const targets = await resolveTargetAccounts({
    snapshot,
    requestedAccounts,
    organizationId: playbook.organizationId,
    requiresPixel,
  })
  const sourceCurrencies = uniqueStrings(playbook.source?.currencies || [])
  const targetCurrencies = uniqueStrings(
    targets.map((target) => target.currency),
  )
  if (targetCurrencies.length > 1) {
    throw errorWithStatus(
      `目标账户包含多种币种（${targetCurrencies.join(', ')}），当前复制任务只支持单一预算币种`,
      409,
    )
  }
  if (
    sourceCurrencies.length === 1 &&
    targetCurrencies.length === 1 &&
    sourceCurrencies[0] !== targetCurrencies[0]
  ) {
    throw errorWithStatus(
      `来源币种 ${sourceCurrencies[0]} 与目标币种 ${targetCurrencies[0]} 不一致，不能直接复制预算`,
      409,
    )
  }
  const maxBudget = asNumber(playbook.guardrails?.maximumPilotDailyBudget, 50)
  const suggestedBudget = asNumber(
    playbook.guardrails?.suggestedPilotDailyBudget,
    20,
  )
  const selectedBudget = Math.min(
    maxBudget,
    Math.max(1, asNumber(dailyBudget, suggestedBudget)),
  )
  if (dailyBudget !== undefined && asNumber(dailyBudget) > maxBudget) {
    throw errorWithStatus(`试投日预算不能超过打法护栏 ${maxBudget}`, 409)
  }
  const materialLimit = Math.min(
    10,
    Math.max(1, Math.round(asNumber(materialLimitInput, 3))),
  )
  const countryLimit = Math.min(
    20,
    Math.max(1, Math.round(asNumber(countryLimitInput, 5))),
  )
  const { targeting, changes } = buildTargeting(
    playbook,
    applyTopCountries,
    countryLimit,
  )
  const run: any = await ReplicaRun.create({
    organizationId: playbook.organizationId,
    scopeKey: playbook.scopeKey,
    optimizerId: playbook.optimizerId,
    profileId: playbook.profileId,
    playbookVersionId: playbook._id,
    playbookVersion: playbook.version,
    status: 'building',
    source: {
      accountIds: playbook.source?.accountIds,
      campaignId: playbook.structure?.sourceCampaignId,
      adsetId: playbook.structure?.sourceAdsetId,
    },
    targets: {
      facebookTokenId: token._id,
      accountIds: targets.map((target) => target.accountId),
      accounts: targets,
      dailyBudget: selectedBudget,
      currency: targetCurrencies[0] || sourceCurrencies[0],
    },
    blueprint: {
      structure: playbook.structure,
      targeting,
      recommendedGeography: playbook.geography,
      recommendedPlacements: playbook.placements,
      recommendedHours: playbook.hours,
      guardrails: playbook.guardrails,
    },
    aiChanges: [
      ...changes,
      'Campaign、AdSet、Ad 强制设为 PAUSED',
      `试投日预算限制为 ${selectedBudget}`,
      '高转化小时仅作为建议，未自动设置分时排期',
    ],
    approval: { required: true },
    createdBy,
    updatedBy: createdBy,
  })

  try {
    const { creativeGroup, copywritingPackage } = await createReplicaAssets({
      run,
      playbook,
      materialLimit,
      createdBy,
    })
    const budgetOptimization = playbook.structure?.budgetOptimization !== false
    const optimizerLabel = cleanString(playbook.optimizerId, 40).replace(
      /[^\w\u4e00-\u9fa5-]+/g,
      '_',
    )
    const draft: any = await createDraft(
      {
        organizationId: playbook.organizationId,
        name: `AI复制_${optimizerLabel}_v${playbook.version}_${String(run._id).slice(-8)}`,
        facebookTokenId: token._id,
        facebookTokenOwnerUserId: token.userId,
        status: 'draft',
        accounts: targets,
        campaign: {
          nameTemplate: `AI_${optimizerLabel}_v${playbook.version}_{accountName}_{date}`,
          status: 'PAUSED',
          objective: playbook.structure?.objective || 'OUTCOME_SALES',
          buyingType: playbook.structure?.buyingType || 'AUCTION',
          budgetOptimization,
          budgetType: 'DAILY',
          budget: selectedBudget,
          bidStrategy:
            playbook.structure?.bidStrategy || 'LOWEST_COST_WITHOUT_CAP',
          specialAdCategories: [],
        },
        adset: {
          nameTemplate: `AI_${optimizerLabel}_v${playbook.version}_测试组_{index}`,
          status: 'PAUSED',
          multiplier: 1,
          budgetType: 'DAILY',
          budget: selectedBudget,
          optimizationGoal:
            playbook.structure?.optimizationGoal || 'OFFSITE_CONVERSIONS',
          billingEvent: playbook.structure?.billingEvent || 'IMPRESSIONS',
          attribution: attributionFromPlaybook(
            playbook.structure?.attributionSpec,
          ),
          pacingType: 'standard',
          inlineTargeting: targeting,
        },
        ad: {
          nameTemplate: `AI_${optimizerLabel}_v${playbook.version}_{materialName}_{index}`,
          status: 'PAUSED',
          tracking: {
            websiteEvent: true,
            appEvent: false,
            urlTags: `utm_source=autoark_ai&utm_medium=paid_social&utm_campaign=optimizer_${optimizerLabel}_v${playbook.version}`,
          },
          format: 'SINGLE',
          creativeGroupIds: [creativeGroup._id],
          copywritingPackageIds: [copywritingPackage._id],
          dynamicCreative: false,
        },
        publishStrategy: {
          targetingLevel: 'ADSET',
          creativeLevel: 'ADSET',
          copywritingMode: 'SHARED',
          schedule: 'IMMEDIATE',
        },
        aiOrigin: {
          replicaRunId: run._id,
          playbookVersionId: playbook._id,
          sourceOptimizerId: playbook.optimizerId,
          generatedAt: new Date(),
          statusLockedToPaused: true,
        },
        notes: `AI 投手复制任务 ${run._id}；真实启用前必须人工审核。`,
      },
      createdBy,
    )
    assertAiDraftPaused(draft)
    const validation = await validateDraft(String(draft._id), accessFilter)
    run.creativeGroupId = creativeGroup._id
    run.copywritingPackageId = copywritingPackage._id
    run.draftId = draft._id
    run.validation = validation
    run.status = validation.isValid ? 'approval_required' : 'blocked'
    run.blockedReasons = validation.isValid
      ? []
      : (validation.errors || []).map((error: any) => error.message)
    await run.save()
    return {
      run: run.toObject(),
      draft: draft.toObject(),
      validation,
      requiredConfirmations: {
        approve: APPROVE_CONFIRMATION,
        publish: PUBLISH_CONFIRMATION,
      },
    }
  } catch (error: any) {
    run.status = 'failed'
    run.error = cleanString(error?.message || 'AI 复制草稿创建失败', 1000)
    run.blockedReasons = [run.error]
    await run.save()
    throw error
  }
}

const findRun = async (id: string, accessFilter: any = {}) => {
  if (!mongoose.Types.ObjectId.isValid(id))
    throw errorWithStatus('ReplicaRun ID 无效')
  const run: any = await ReplicaRun.findOne(
    combineFilters({ _id: id }, accessFilter),
  )
  if (!run) throw errorWithStatus('AI 复制任务不存在或无权访问', 404)
  return run
}

export const approveReplica = async ({
  id,
  confirmation,
  note,
  approvedBy,
  accessFilter = {},
}: {
  id: string
  confirmation: string
  note?: string
  approvedBy?: string
  accessFilter?: any
}) => {
  if (confirmation !== APPROVE_CONFIRMATION) {
    throw errorWithStatus(`审批确认文本必须为 ${APPROVE_CONFIRMATION}`)
  }
  const run = await findRun(id, accessFilter)
  if (run.status !== 'approval_required') {
    throw errorWithStatus(`当前状态 ${run.status} 不允许审批`, 409)
  }
  const draft: any = await AdDraft.findOne(
    combineFilters({ _id: run.draftId }, accessFilter),
  )
  if (!draft) throw errorWithStatus('关联草稿不存在或无权访问', 404)
  assertAiDraftPaused(draft)
  const validation = await validateDraft(String(draft._id), accessFilter)
  if (!validation.isValid) {
    run.status = 'blocked'
    run.validation = validation
    run.blockedReasons = validation.errors.map((error: any) => error.message)
    await run.save()
    throw errorWithStatus('草稿预检未通过，不能审批', 409, validation)
  }
  const approvedRun: any = await ReplicaRun.findOneAndUpdate(
    combineFilters({ _id: run._id, status: 'approval_required' }, accessFilter),
    {
      $set: {
        status: 'approved',
        validation,
        approval: {
          required: true,
          approvedBy,
          approvedAt: new Date(),
          note: cleanString(note, 1000),
        },
        updatedBy: approvedBy,
      },
    },
    { new: true },
  )
  if (!approvedRun) {
    throw errorWithStatus('复制任务状态已变化，请刷新后重试审批', 409)
  }
  return approvedRun.toObject()
}

export const publishReplica = async ({
  id,
  confirmation,
  publishedBy,
  accessFilter = {},
}: {
  id: string
  confirmation: string
  publishedBy?: string
  accessFilter?: any
}) => {
  if (confirmation !== PUBLISH_CONFIRMATION) {
    throw errorWithStatus(`发布确认文本必须为 ${PUBLISH_CONFIRMATION}`)
  }
  const run = await findRun(id, accessFilter)
  if (run.status !== 'approved') {
    throw errorWithStatus(
      `当前状态 ${run.status} 不允许发布，必须先明确审批`,
      409,
    )
  }
  const draft: any = await AdDraft.findOne(
    combineFilters({ _id: run.draftId }, accessFilter),
  )
  if (!draft) throw errorWithStatus('关联草稿不存在或无权访问', 404)
  assertAiDraftPaused(draft)
  const claimedRun: any = await ReplicaRun.findOneAndUpdate(
    combineFilters({ _id: run._id, status: 'approved' }, accessFilter),
    { $set: { status: 'publishing', updatedBy: publishedBy } },
    { new: true },
  )
  if (!claimedRun) {
    throw errorWithStatus('复制任务已被其他发布请求处理，请刷新状态', 409)
  }
  try {
    const task: any = await publishDraft(
      String(draft._id),
      publishedBy,
      accessFilter,
    )
    const updatedRun: any = await ReplicaRun.findByIdAndUpdate(
      claimedRun._id,
      {
        $set: {
          taskId: task._id,
          status: taskStatusToReplicaStatus(task.status) || 'publishing',
        },
      },
      { new: true },
    )
    return buildEffectiveReplica(updatedRun.toObject(), task.toObject())
  } catch (error: any) {
    await ReplicaRun.findByIdAndUpdate(claimedRun._id, {
      $set: {
        status: 'failed',
        error: cleanString(error?.message || 'AI 复制发布失败', 1000),
      },
    })
    throw error
  }
}

export const listReplicas = async ({
  accessFilter = {},
  optimizerId,
  status,
  limit = 50,
}: {
  accessFilter?: any
  optimizerId?: string
  status?: string
  limit?: number
} = {}) => {
  const query = combineFilters(
    accessFilter,
    optimizerId ? { optimizerId: cleanString(optimizerId, 120) } : {},
    status ? { status: cleanString(status, 40) } : {},
  )
  const runs: any[] = await ReplicaRun.find(query)
    .sort({ createdAt: -1 })
    .limit(Math.min(100, Math.max(1, Number(limit) || 50)))
    .lean()
  const taskIds = runs.map((run) => run.taskId).filter(Boolean)
  const tasks: any[] =
    taskIds.length > 0
      ? await AdTask.find({ _id: { $in: taskIds } })
          .select('name status progress createdAt completedAt')
          .lean()
      : []
  const taskById = new Map(tasks.map((task) => [String(task._id), task]))
  return runs.map((run) =>
    buildEffectiveReplica(run, taskById.get(String(run.taskId))),
  )
}

export const getReplica = async (id: string, accessFilter: any = {}) => {
  const run = await findRun(id, accessFilter)
  const task: any = run.taskId
    ? await AdTask.findById(run.taskId)
        .select('name status progress items createdAt completedAt')
        .lean()
    : undefined
  return buildEffectiveReplica(run.toObject(), task)
}

const purchaseCount = (actions: any) => {
  if (!Array.isArray(actions)) return 0
  for (const actionType of PURCHASE_ACTION_TYPES) {
    const match = actions.find(
      (entry: any) => entry?.action_type === actionType,
    )
    if (match) return asNumber(match.value)
  }
  return 0
}

export const evaluateReplica = async ({
  id,
  evaluatedBy,
  accessFilter = {},
}: {
  id: string
  evaluatedBy?: string
  accessFilter?: any
}) => {
  const run = await findRun(id, accessFilter)
  if (!run.taskId)
    throw errorWithStatus('该复制任务尚未发布，没有可评估的广告', 409)
  const task: any = await AdTask.findById(run.taskId).lean()
  if (!task) throw errorWithStatus('关联发布任务不存在', 404)
  const adIds = uniqueStrings(
    (task.items || []).flatMap((item: any) => item.result?.adIds || []),
  )
  const since = task.createdAt
    ? new Date(task.createdAt).toISOString().slice(0, 10)
    : undefined
  const rows: any[] =
    adIds.length > 0
      ? await MetricsDaily.find({
          level: 'ad',
          entityId: { $in: adIds },
          ...(since ? { date: { $gte: since } } : {}),
        }).lean()
      : []
  const metricsKnown = rows.length > 0
  const totals = rows.reduce(
    (result, row) => ({
      spend: result.spend + asNumber(row.spendUsd),
      impressions: result.impressions + asNumber(row.impressions),
      clicks: result.clicks + asNumber(row.clicks),
      purchases: result.purchases + purchaseCount(row.actions),
      purchaseValue:
        result.purchaseValue +
        asNumber(row.purchase_value_corrected ?? row.purchase_value),
    }),
    { spend: 0, impressions: 0, clicks: 0, purchases: 0, purchaseValue: 0 },
  )
  const current = metricsKnown
    ? {
        known: true,
        ...totals,
        roas: totals.spend > 0 ? totals.purchaseValue / totals.spend : 0,
        cpa: totals.purchases > 0 ? totals.spend / totals.purchases : null,
        ctr: totals.impressions > 0 ? totals.clicks / totals.impressions : 0,
        rowCount: rows.length,
      }
    : {
        known: false,
        spend: null,
        impressions: null,
        clicks: null,
        purchases: null,
        purchaseValue: null,
        roas: null,
        cpa: null,
        ctr: null,
        rowCount: 0,
      }
  const playbook: any = await PlaybookVersion.findById(
    run.playbookVersionId,
  ).lean()
  const sourceBaseline = playbook?.baseline || null
  const daysSinceLaunch = Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(task.createdAt || Date.now()).getTime()) /
        86400000,
    ),
  )
  const checkpoint =
    daysSinceLaunch >= 7 ? 'D7' : daysSinceLaunch >= 3 ? 'D3' : 'D1'
  const evaluation = {
    lastEvaluatedAt: new Date(),
    evaluatedBy,
    daysSinceLaunch,
    checkpoint,
    current,
    sourceBaseline,
    comparison:
      metricsKnown && sourceBaseline
        ? {
            roasDelta: current.roas - asNumber(sourceBaseline.roas),
            roasLiftPercent:
              asNumber(sourceBaseline.roas) > 0
                ? ((current.roas - asNumber(sourceBaseline.roas)) /
                    asNumber(sourceBaseline.roas)) *
                  100
                : null,
            cpaDelta:
              current.cpa !== null && sourceBaseline.cpa !== null
                ? current.cpa - asNumber(sourceBaseline.cpa)
                : null,
          }
        : {
            roasDelta: null,
            roasLiftPercent: null,
            cpaDelta: null,
            reason: 'AI 广告效果数据尚未同步，未知值不按 0 处理',
          },
  }
  run.evaluation = evaluation
  const taskTerminal = [
    'success',
    'partial_success',
    'failed',
    'cancelled',
  ].includes(task.status)
  run.status = taskTerminal && metricsKnown ? 'completed' : 'evaluating'
  run.updatedBy = evaluatedBy
  await run.save()
  return {
    run: run.toObject(),
    evaluation,
  }
}

export const replicaConfirmations = {
  approve: APPROVE_CONFIRMATION,
  publish: PUBLISH_CONFIRMATION,
}
