import mongoose from 'mongoose'
import AdDraft from '../models/AdDraft'
import AdTask from '../models/AdTask'
import CopywritingPackage from '../models/CopywritingPackage'
import CreativeGroup from '../models/CreativeGroup'
import MetricsDaily from '../models/MetricsDaily'
import PlaybookVersion from '../models/PlaybookVersion'
import ReplicaRun from '../models/ReplicaRun'
import { combineFilters } from '../utils/accessControl'
import { normalizeForStorage } from '../utils/accountId'
import {
  canonicalJson,
  frozenCopywritingSnapshot,
  frozenCreativeSnapshot,
} from '../utils/aiExecutionSnapshot'
import { createDraft, publishDraft, validateDraft } from './bulkAd.service'
import {
  listExecutionSetup,
  resolveExecutionMandate,
} from './optimizerExecution.service'

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

export const listReplicaAssets = async ({
  playbookId,
  accessFilter = {},
  tokenAccessFilter = {},
}: {
  playbookId: string
  accessFilter?: any
  tokenAccessFilter?: any
}) => {
  return listExecutionSetup({
    playbookId,
    accessFilter,
    tokenAccessFilter,
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

const createExecutionSnapshots = async ({
  run,
  playbook,
  selection,
  createdBy,
}: {
  run: any
  playbook: any
  selection: any
  createdBy?: string
}) => {
  const selectedMaterials = (selection.creativeGroup?.materials || []).filter(
    (material: any) =>
      ['image', 'video'].includes(material?.type) &&
      /^https?:\/\//i.test(cleanString(material?.url, 2000)),
  )
  if (
    selectedMaterials.length === 0 ||
    selectedMaterials.length !== selection.creativeGroup.materials.length
  ) {
    throw errorWithStatus(
      '管理员所选创意组包含不可跨账户执行的素材；每个素材都必须有稳定 URL',
      409,
    )
  }
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
      width: material.width,
      height: material.height,
      duration: material.duration,
      size: material.size,
      format: material.format,
      thumbnail: material.thumbnail || material.thumbnailUrl,
      status: 'uploaded',
      source: 'url_import',
    })),
    config: {
      format: selection.creativeGroup.config?.format || 'single',
      dynamicCreative: selection.creativeGroup.config?.dynamicCreative === true,
      carousel: selection.creativeGroup.config?.carousel,
    },
    reusePolicy: {
      scope: 'account',
      sourceMode: 'manual',
      requiresTargetUpload: true,
    },
    description:
      `AI 执行快照；来源为管理员授权的创意组 ${selection.creativeGroup._id}。` +
      '仅保留稳定 URL，不继承来源 Facebook image hash/video id。',
    tags: [
      'AI执行快照',
      `投手:${playbook.optimizerId}`,
      `打法:v${playbook.version}`,
      `授权单:${selection.mandate._id}`,
    ],
    createdBy,
  })

  const copy = selection.copywritingPackage
  const callToAction = CTA_VALUES.has(copy.callToAction)
    ? copy.callToAction
    : 'SHOP_NOW'
  const copywritingPackage: any = await CopywritingPackage.create({
    name: `AI_${optimizerLabel}_v${playbook.version}_${suffix}_执行文案`,
    organizationId: playbook.organizationId,
    platform: 'facebook',
    content: {
      primaryTexts: (copy.content?.primaryTexts || []).slice(0, 5),
      headlines: (copy.content?.headlines || []).slice(0, 5),
      descriptions: (copy.content?.descriptions || []).slice(0, 5),
    },
    callToAction,
    links: {
      websiteUrl: copy.links?.websiteUrl,
      displayLink: copy.links?.displayLink,
      deepLink: copy.links?.deepLink,
    },
    product: copy.product,
    urlParameters: copy.urlParameters,
    language: copy.language,
    description: `AI 执行快照；产品与落地链接来自管理员授权的文案包 ${copy._id}。`,
    tags: [
      'AI执行快照',
      `投手:${playbook.optimizerId}`,
      `打法:v${playbook.version}`,
      `授权单:${selection.mandate._id}`,
    ],
    createdBy,
  })
  return { creativeGroup, copywritingPackage }
}

export const createReplica = async ({
  playbookId,
  mandateId,
  dailyBudget,
  createdBy,
  accessFilter = {},
  tokenAccessFilter = {},
}: {
  playbookId: string
  mandateId: string
  dailyBudget?: number
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
  if (!mandateId) {
    const error: any = errorWithStatus(
      '创建 AI 投放任务前必须由管理员提供有效授权单',
      409,
    )
    error.code = 'AI_EXECUTION_MANDATE_REQUIRED'
    throw error
  }
  const selection = await resolveExecutionMandate({
    mandateId,
    playbook,
    accessFilter,
    tokenAccessFilter,
  })
  const maximumBudget = Math.max(
    1,
    asNumber(selection.mandate.budget?.maximumDailyBudget),
  )
  const defaultBudget = Math.max(
    1,
    asNumber(selection.mandate.budget?.defaultDailyBudget, 20),
  )
  const selectedBudget = asNumber(dailyBudget, defaultBudget)
  if (selectedBudget < 1 || selectedBudget > maximumBudget) {
    throw errorWithStatus(
      `试投日预算必须在 1-${maximumBudget} ${selection.currency} 之间`,
      409,
      { maximumDailyBudget: maximumBudget, currency: selection.currency },
    )
  }
  const targetIds = selection.targets.map((target: any) => target.accountId)
  const run: any = await ReplicaRun.create({
    organizationId: playbook.organizationId,
    scopeKey: playbook.scopeKey,
    optimizerId: playbook.optimizerId,
    profileId: playbook.profileId,
    playbookVersionId: playbook._id,
    playbookVersion: playbook.version,
    mandateId: selection.mandate._id,
    status: 'building',
    source: {
      accountIds: playbook.source?.accountIds,
      tokenIds: playbook.source?.tokenIds,
      campaignId: playbook.structure?.sourceCampaignId,
      adsetId: playbook.structure?.sourceAdsetId,
      mode: 'read_only_context',
      executable: false,
    },
    targets: {
      authorizationType: selection.authorizationType,
      ...(selection.authorizationType === 'system_user'
        ? { metaCredentialId: selection.metaCredential._id }
        : { facebookTokenId: selection.token._id }),
      accountIds: targetIds,
      accounts: selection.targets,
      dailyBudget: selectedBudget,
      currency: selection.currency,
      assignmentMode: 'admin_explicit',
    },
    blueprint: {
      structure: playbook.structure,
      targeting: selection.targeting,
      recommendedGeography: playbook.geography,
      recommendedPlacements: playbook.placements,
      recommendedHours: playbook.hours,
      deliveryInsights: selection.targetingPackage.deliveryInsights,
      guardrails: playbook.guardrails,
    },
    aiChanges: [
      '真人投手账户、Token、Page、Pixel 和账户专属素材 ID 仅作只读上下文，不进入执行链',
      '执行定向来自管理员授权的 AutoArk 可复用定向包',
      '执行素材来自管理员授权的 AutoArk 创意组，并在目标账户重新上传',
      '产品、文案和落地链接只来自管理员授权的文案包',
      'Pixel 按文案包对应产品和每个执行账户的已验证映射解析',
      'Campaign、AdSet、Ad 强制设为 PAUSED',
      `试投日预算为 ${selectedBudget} ${selection.currency}，不超过授权上限 ${maximumBudget}`,
      '高转化小时仅作为建议，未自动设置分时排期',
    ],
    sourceCreativeGroupId: selection.creativeGroup._id,
    sourceCopywritingPackageId: selection.copywritingPackage._id,
    targetingPackageId: selection.targetingPackage._id,
    productId: selection.product._id,
    assetSnapshot: {
      mandateId: selection.mandate._id,
      targetingPackageId: selection.targetingPackage._id,
      creativeGroupId: selection.creativeGroup._id,
      copywritingPackageId: selection.copywritingPackage._id,
      productId: selection.product._id,
      landingUrl: selection.copywritingPackage.links?.websiteUrl,
      authorizationType: selection.authorizationType,
      authorizationId: selection.authorizationId,
      targets: selection.targets,
      sourceBoundary: selection.boundary,
      capturedAt: new Date(),
    },
    approval: { required: true },
    createdBy,
    updatedBy: createdBy,
  })

  try {
    const { creativeGroup, copywritingPackage } =
      await createExecutionSnapshots({
        run,
        playbook,
        selection,
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
        name: `AI投放_${optimizerLabel}_v${playbook.version}_${String(run._id).slice(-8)}`,
        ...(selection.authorizationType === 'system_user'
          ? { metaCredentialId: selection.metaCredential._id }
          : {
              facebookTokenId: (selection.token as any)._id,
              facebookTokenOwnerUserId: (selection.token as any).userId,
            }),
        status: 'draft',
        accounts: selection.targets,
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
          inlineTargeting: selection.targeting,
        },
        ad: {
          nameTemplate: `AI_${optimizerLabel}_v${playbook.version}_{materialName}_{index}`,
          status: 'PAUSED',
          tracking: {
            websiteEvent: true,
            appEvent: false,
            urlTags: `utm_source=autoark_ai&utm_medium=paid_social&utm_campaign=optimizer_${optimizerLabel}_v${playbook.version}`,
          },
          format: ['CAROUSEL', 'COLLECTION'].includes(
            String(selection.creativeGroup.config?.format || '').toUpperCase(),
          )
            ? String(selection.creativeGroup.config?.format).toUpperCase()
            : 'SINGLE',
          creativeGroupIds: [creativeGroup._id],
          copywritingPackageIds: [copywritingPackage._id],
          dynamicCreative:
            selection.creativeGroup.config?.dynamicCreative === true,
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
          mandateId: selection.mandate._id,
          sourceOptimizerId: playbook.optimizerId,
          generatedAt: new Date(),
          statusLockedToPaused: true,
        },
        notes:
          `AI 投手执行任务 ${run._id}；管理员授权单 ${selection.mandate._id}。` +
          '仅创建 PAUSED 广告，真实启用前必须人工审核。',
      },
      createdBy,
    )
    assertAiDraftPaused(draft)
    const validation = await validateDraft(String(draft._id), accessFilter)
    run.creativeGroupId = creativeGroup._id
    run.copywritingPackageId = copywritingPackage._id
    run.draftId = draft._id
    run.assetSnapshot = {
      ...(run.assetSnapshot || {}),
      executionCreativeGroupId: creativeGroup._id,
      executionCopywritingPackageId: copywritingPackage._id,
      frozenTargeting: selection.targeting,
      frozenCreative: frozenCreativeSnapshot(creativeGroup),
      frozenCopywriting: frozenCopywritingSnapshot(copywritingPackage),
    }
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

const revalidateReplicaMandate = async ({
  run,
  draft,
  accessFilter,
  tokenAccessFilter,
}: {
  run: any
  draft: any
  accessFilter: any
  tokenAccessFilter: any
}) => {
  if (!run.mandateId) {
    const error: any = errorWithStatus(
      '旧版 AI 复制任务没有管理员授权单，不能审批或发布',
      409,
    )
    error.code = 'AI_EXECUTION_MANDATE_REQUIRED'
    throw error
  }
  const playbook = await findPlaybook(
    String(run.playbookVersionId),
    accessFilter,
  )
  const selection = await resolveExecutionMandate({
    mandateId: String(run.mandateId),
    playbook,
    accessFilter,
    tokenAccessFilter,
  })
  const mandateId = String(selection.mandate._id)
  if (
    String(draft.aiOrigin?.mandateId || '') !== mandateId ||
    String(draft.aiOrigin?.replicaRunId || '') !== String(run._id)
  ) {
    throw errorWithStatus('AI 草稿与管理员授权单绑定不一致', 409)
  }
  const authorizationType =
    selection.authorizationType ||
    selection.mandate.authorizationType ||
    (selection.mandate.metaCredentialId ? 'system_user' : 'personal_user')
  const draftAuthorizationMatches =
    authorizationType === 'system_user'
      ? String(draft.metaCredentialId || '') ===
          String(selection.mandate.metaCredentialId || '') &&
        !draft.facebookTokenId
      : String(draft.facebookTokenId || '') ===
          String(selection.mandate.facebookTokenId || '') &&
        !draft.metaCredentialId
  if (!draftAuthorizationMatches) {
    throw errorWithStatus('AI 草稿使用的 Facebook 授权与授权单不一致', 409)
  }
  const expectedTargets = new Map(
    selection.targets.map((target: any) => [target.accountId, target]),
  )
  if ((draft.accounts || []).length !== expectedTargets.size) {
    throw errorWithStatus('AI 草稿执行账户数量与授权单不一致', 409)
  }
  for (const account of draft.accounts || []) {
    const expected: any = expectedTargets.get(
      normalizeForStorage(account.accountId),
    )
    if (
      !expected ||
      String(account.pageId || '') !== String(expected.pageId || '') ||
      String(account.pixelId || '') !== String(expected.pixelId || '')
    ) {
      throw errorWithStatus(
        `AI 草稿账户 ${account.accountId} 的 Page 或 Pixel 与授权单不一致`,
        409,
      )
    }
  }
  if (
    String(run.sourceCreativeGroupId || '') !==
      String(selection.creativeGroup._id) ||
    String(run.sourceCopywritingPackageId || '') !==
      String(selection.copywritingPackage._id) ||
    String(run.targetingPackageId || '') !==
      String(selection.targetingPackage._id) ||
    String(run.productId || '') !== String(selection.product._id)
  ) {
    throw errorWithStatus('AI 任务的方法资产或产品绑定与授权单不一致', 409)
  }
  const selectedBudget = asNumber(run.targets?.dailyBudget)
  if (
    selectedBudget < 1 ||
    selectedBudget > asNumber(selection.mandate.budget?.maximumDailyBudget)
  ) {
    throw errorWithStatus('AI 任务预算已超出当前授权单上限', 409)
  }
  if (
    canonicalJson(draft.adset?.inlineTargeting || {}) !==
    canonicalJson(run.assetSnapshot?.frozenTargeting || {})
  ) {
    throw errorWithStatus('AI 草稿的冻结定向已被修改，必须重新创建任务', 409)
  }
  const [creativeGroup, copywritingPackage]: any[] = await Promise.all([
    CreativeGroup.findOne(
      combineFilters({ _id: run.creativeGroupId }, accessFilter),
    ).lean(),
    CopywritingPackage.findOne(
      combineFilters({ _id: run.copywritingPackageId }, accessFilter),
    ).lean(),
  ])
  if (!creativeGroup || !copywritingPackage) {
    throw errorWithStatus('AI 执行素材或文案快照不存在', 409)
  }
  if (
    canonicalJson(frozenCreativeSnapshot(creativeGroup)) !==
      canonicalJson(run.assetSnapshot?.frozenCreative) ||
    canonicalJson(frozenCopywritingSnapshot(copywritingPackage)) !==
      canonicalJson(run.assetSnapshot?.frozenCopywriting)
  ) {
    throw errorWithStatus(
      'AI 执行素材或文案快照已被修改，必须重新创建任务',
      409,
    )
  }
  return selection
}

export const approveReplica = async ({
  id,
  confirmation,
  note,
  approvedBy,
  accessFilter = {},
  tokenAccessFilter = {},
}: {
  id: string
  confirmation: string
  note?: string
  approvedBy?: string
  accessFilter?: any
  tokenAccessFilter?: any
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
  await revalidateReplicaMandate({
    run,
    draft,
    accessFilter,
    tokenAccessFilter,
  })
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
  tokenAccessFilter = {},
}: {
  id: string
  confirmation: string
  publishedBy?: string
  accessFilter?: any
  tokenAccessFilter?: any
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
  await revalidateReplicaMandate({
    run,
    draft,
    accessFilter,
    tokenAccessFilter,
  })
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
      { aiReplicaRunId: String(run._id) },
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
