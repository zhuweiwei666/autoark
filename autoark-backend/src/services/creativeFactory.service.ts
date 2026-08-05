import { createHash, randomUUID } from 'crypto'
import mongoose from 'mongoose'
import CreativeFactoryJob from '../models/CreativeFactoryJob'
import Material from '../models/Material'
import {
  generatePresignedUploadUrl,
  getPublicUrlForKey,
} from './r2Storage.service'
import { validateMaterialFileMeta } from '../utils/materialUploadLimits'
import {
  createAiHostGeneration,
  getAiHostCreativeCatalog,
  getAiHostGenerationStatus,
  type AiHostGeneration,
} from './aiHostCreativeFactory.service'
import {
  getCreativeFactoryTemplate,
  listCreativeFactoryTemplates,
} from '../config/creativeFactoryTemplates.config'

export class CreativeFactoryError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.statusCode = statusCode
  }
}

export type CreativeFactoryScope = {
  organizationId?: string
  userId: string
  isSuperAdmin: boolean
}

type CreateAssetInput = {
  materialId?: string
  sourceUrl?: string
  mediaType?: 'image' | 'video'
  name?: string
}

type ResolvedCreativeAsset = {
  materialId?: mongoose.Types.ObjectId
  url: string
  mediaType: 'image' | 'video'
  name: string
}

type CreateBatchInput = {
  title?: string
  intent?: string
  brandKey?: string
  outputMediaType?: 'image' | 'video'
  aspectRatio?: string
  variantsPerAsset?: number
  assets?: CreateAssetInput[]
  styleReference?: { materialId?: string }
  templateKey?: string
}

const clean = (value: unknown, max = 500) =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

const jobScopeFilter = (scope: CreativeFactoryScope) => {
  if (scope.isSuperAdmin) return {}
  if (!scope.organizationId)
    throw new CreativeFactoryError('当前用户未关联组织', 403)
  return { organizationId: scope.organizationId }
}

const assertPublicUrl = (value: string) => {
  try {
    const parsed = new URL(value)
    if (
      parsed.protocol !== 'https:' &&
      !(parsed.protocol === 'http:' && parsed.hostname === 'localhost')
    )
      throw new Error('protocol')
    return parsed.toString()
  } catch {
    throw new CreativeFactoryError('素材 URL 必须是可公开访问的 HTTPS 地址')
  }
}

const hashStorageScope = (value: string) =>
  createHash('sha256').update(String(value)).digest('hex').slice(0, 16)

export const getCreativeFactoryStorageRoot = (job: {
  organizationId?: unknown
  createdBy?: unknown
}) => {
  if (job.organizationId) {
    return `tenants/org-${hashStorageScope(String(job.organizationId))}`
  }
  if (job.createdBy) {
    return `tenants/user-${hashStorageScope(String(job.createdBy))}`
  }
  throw new CreativeFactoryError('生产任务缺少租户存储归属', 500)
}

export const validateCreativeFactoryStorageKey = (
  job: { organizationId?: unknown; createdBy?: unknown },
  value: unknown,
) => {
  const storageKey = clean(value, 1000).replace(/^\/+/, '')
  const expectedPrefix = `${getCreativeFactoryStorageRoot(job)}/creative-factory/`
  if (
    !storageKey ||
    storageKey.includes('..') ||
    !storageKey.startsWith(expectedPrefix)
  ) {
    throw new CreativeFactoryError('成品存储路径不属于当前生产任务的租户')
  }
  return storageKey
}

const assertCodexJobOwner = (job: any, workerId: string) => {
  if (!workerId || job.codex?.workerId !== workerId) {
    throw new CreativeFactoryError('Codex 任务不属于当前执行器', 409)
  }
}

async function resolveSource(
  asset: CreateAssetInput,
  scope: CreativeFactoryScope,
): Promise<ResolvedCreativeAsset> {
  const materialId = clean(asset.materialId, 100)
  if (materialId) {
    if (!mongoose.Types.ObjectId.isValid(materialId)) {
      throw new CreativeFactoryError(`无效素材 ID: ${materialId}`)
    }
    const material = await Material.findOne({
      _id: materialId,
      ...jobScopeFilter(scope),
    }).lean()
    if (!material)
      throw new CreativeFactoryError(`素材不存在或无权限: ${materialId}`, 404)
    if (!['image', 'video'].includes(String(material.type))) {
      throw new CreativeFactoryError(
        `素材不是可处理的图片或视频: ${materialId}`,
      )
    }
    return {
      materialId: material._id,
      url: assertPublicUrl(String(material.storage?.url || '')),
      mediaType: material.type as 'image' | 'video',
      name: material.name,
    }
  }

  const sourceUrl = assertPublicUrl(clean(asset.sourceUrl, 2000))
  const mediaType = asset.mediaType === 'video' ? 'video' : 'image'
  return {
    url: sourceUrl,
    mediaType,
    name: clean(asset.name, 160) || sourceUrl.split('/').pop() || '外部素材',
  }
}

async function resolveStyleReference(
  input: CreateBatchInput['styleReference'],
  scope: CreativeFactoryScope,
) {
  if (!input) return null
  const materialId = clean(input.materialId, 100)
  if (!materialId) {
    throw new CreativeFactoryError('素材示例必须来自 AutoArk 素材库')
  }
  const reference = await resolveSource({ materialId }, scope)
  return {
    ...reference,
    analysis: { status: 'pending' as const },
  }
}

const resolveWorkflow = (
  sourceMediaType: 'image' | 'video',
  referenceMediaType?: 'image' | 'video',
) => {
  if (referenceMediaType === 'image' && sourceMediaType === 'video') {
    return 'extract_frame_then_edit' as const
  }
  if (referenceMediaType === 'video' && sourceMediaType === 'image') {
    return 'generate_then_edit' as const
  }
  if (referenceMediaType) return 'edit_only' as const
  return sourceMediaType === 'video'
    ? ('edit_only' as const)
    : ('generate_then_edit' as const)
}

const REFERENCE_ANALYSIS_FIELDS = [
  'summary',
  'visualLanguage',
  'typography',
  'layout',
  'hookPattern',
  'pacing',
  'transitions',
  'overlays',
  'callToAction',
  'audio',
  'generationPrompt',
] as const

const sanitizeReferenceAnalysis = (input: unknown) => {
  if (!input || typeof input !== 'object') return null
  const value = input as Record<string, unknown>
  const result: Record<string, unknown> = {
    status: 'completed',
    extractedAt: new Date(),
  }
  for (const field of REFERENCE_ANALYSIS_FIELDS) {
    result[field] = clean(
      value[field],
      field === 'generationPrompt' ? 1600 : 1000,
    )
  }
  result.palette = Array.isArray(value.palette)
    ? value.palette
        .map((item) => clean(item, 40))
        .filter(Boolean)
        .slice(0, 8)
    : []
  result.avoid = Array.isArray(value.avoid)
    ? value.avoid
        .map((item) => clean(item, 160))
        .filter(Boolean)
        .slice(0, 12)
    : []
  return clean(result.summary, 1000) ? result : null
}

const mapAiHostFields = (result: AiHostGeneration) => ({
  status: result.status,
  generationId: result.generationId,
  presetToken: result.presetToken,
  genJobId: result.genJobId || undefined,
  resultUrl: result.resultUrl || undefined,
  landingUrl: result.landingUrl || undefined,
  error: result.error || undefined,
  updatedAt: new Date(),
})

export async function createCreativeFactoryBatch(
  input: CreateBatchInput,
  scope: CreativeFactoryScope,
) {
  const title = clean(input.title, 120)
  const intent = clean(input.intent, 4000)
  const assets = Array.isArray(input.assets) ? input.assets.slice(0, 20) : []
  const variantsPerAsset = Math.min(
    Math.max(Number(input.variantsPerAsset) || 1, 1),
    4,
  )
  const templateKey = clean(input.templateKey, 120)
  const template = templateKey ? getCreativeFactoryTemplate(templateKey) : null

  if (!title) throw new CreativeFactoryError('请输入批次名称')
  if (!intent) throw new CreativeFactoryError('请输入投放意图')
  if (assets.length === 0)
    throw new CreativeFactoryError('至少提供一个素材 ID 或 URL')
  if (templateKey && !template)
    throw new CreativeFactoryError('生产模板不存在或已停用')

  const resolvedAssets = []
  for (const asset of assets)
    resolvedAssets.push(await resolveSource(asset, scope))
  if (
    template &&
    resolvedAssets.some((asset) => asset.mediaType !== template.inputMediaType)
  ) {
    throw new CreativeFactoryError(`${template.name}只接受图片来源素材`)
  }
  if (template && input.styleReference) {
    throw new CreativeFactoryError(
      `${template.name}已经固化广告结构，无需素材示例`,
    )
  }
  const styleReference = await resolveStyleReference(
    input.styleReference,
    scope,
  )
  const outputMediaType = template
    ? template.outputMediaType
    : styleReference
      ? styleReference.mediaType
      : input.outputMediaType === 'video'
        ? 'video'
        : 'image'

  const batchId = randomUUID()
  const docs = []
  let variantIndex = 0
  for (const source of resolvedAssets) {
    const variantCount = template ? template.variantsPerAsset : variantsPerAsset
    for (let index = 0; index < variantCount; index += 1) {
      variantIndex += 1
      const variantId = `v${String(variantIndex).padStart(3, '0')}`
      docs.push({
        organizationId: scope.organizationId || undefined,
        batchId,
        variantId,
        title,
        intent,
        brandKey: clean(input.brandKey, 80) || 'clingai',
        templateKey: template?.key,
        templateVersion: template?.version,
        workflow: resolveWorkflow(source.mediaType, styleReference?.mediaType),
        status: template ? 'generating' : 'awaiting_codex',
        source,
        styleReference: styleReference || undefined,
        requestedOutput: {
          mediaType: outputMediaType,
          aspectRatio: clean(input.aspectRatio, 20) || '9:16',
        },
        analysis: template
          ? {
              intentSummary: intent,
              hook: template.composition.title,
              featureKey: 'pipeline',
              templateId: template.key,
              rationale: `固定执行 ${template.name} v${template.version}`,
              editRecipe: template.composition,
            }
          : undefined,
        pipeline: template
          ? {
              status: 'queued',
              currentStep: 'closeup_image',
              progressLabel: template.steps[0],
              steps: {},
              attempts: 0,
              nextAttemptAt: new Date(),
            }
          : undefined,
        codex: { status: template ? 'completed' : 'queued' },
        attribution: { status: 'pending', mappings: [] },
        createdBy: scope.userId,
      })
    }
  }

  const jobs = await CreativeFactoryJob.insertMany(docs)
  return { batchId, jobCount: jobs.length, jobs }
}

export async function listCreativeFactoryBatches(scope: CreativeFactoryScope) {
  const jobs: any[] = await CreativeFactoryJob.find(jobScopeFilter(scope))
    .sort({ createdAt: -1 })
    .limit(400)
    .lean()
  const groups = new Map<string, any>()

  for (const job of jobs) {
    if (!groups.has(job.batchId)) {
      groups.set(job.batchId, {
        batchId: job.batchId,
        title: job.title,
        intent: job.intent,
        brandKey: job.brandKey,
        templateKey: job.templateKey,
        templateVersion: job.templateVersion,
        styleReference: job.styleReference,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        total: 0,
        ready: 0,
        failed: 0,
        attributed: 0,
        statuses: {},
      })
    }
    const group = groups.get(job.batchId)
    group.total += 1
    group.ready += job.status === 'ready' ? 1 : 0
    group.failed += job.status === 'failed' ? 1 : 0
    group.attributed += job.attribution?.status === 'linked' ? 1 : 0
    group.statuses[job.status] = (group.statuses[job.status] || 0) + 1
    if (job.updatedAt > group.updatedAt) group.updatedAt = job.updatedAt
  }

  return Array.from(groups.values())
}

export async function getCreativeFactoryBatch(
  batchId: string,
  scope: CreativeFactoryScope,
) {
  const jobs = await CreativeFactoryJob.find({
    batchId: clean(batchId, 100),
    ...jobScopeFilter(scope),
  })
    .sort({ variantId: 1 })
    .populate({
      path: 'outputMaterialId',
      select: 'name type status storage.url metrics usage tags createdAt',
    })
    .lean()
  if (jobs.length === 0) throw new CreativeFactoryError('生产批次不存在', 404)
  return { batchId, jobs }
}

export async function getCreativeFactoryCatalog(featureKey?: string) {
  return getAiHostCreativeCatalog(clean(featureKey, 100) || undefined)
}

export function getCreativeFactoryTemplates() {
  return listCreativeFactoryTemplates()
}

export async function createCreativeFactoryUploadUrl(
  jobId: string,
  input: any,
  workerIdInput: unknown,
) {
  const workerId = clean(workerIdInput, 120)
  const job: any = await CreativeFactoryJob.findById(jobId)
  if (!job) throw new CreativeFactoryError('Codex 任务不存在', 404)
  assertCodexJobOwner(job, workerId)
  if (!['claimed', 'processing'].includes(job.codex?.status)) {
    throw new CreativeFactoryError('Codex 任务当前不可上传成品', 409)
  }
  if (job.codex?.leaseUntil && new Date(job.codex.leaseUntil) < new Date()) {
    throw new CreativeFactoryError('Codex 任务租约已过期，请重新认领', 409)
  }

  const fileName = clean(input?.fileName, 240)
  const mimeType = clean(input?.mimeType, 120)
  const size = Number(input?.size)
  const validationError = validateMaterialFileMeta(
    { fileName, mimeType, size },
    { requireSize: true },
  )
  if (validationError) throw new CreativeFactoryError(validationError)

  const result = await generatePresignedUploadUrl({
    fileName,
    mimeType,
    folder: `${getCreativeFactoryStorageRoot(job)}/creative-factory`,
    expiresIn: 15 * 60,
  })
  if (!result.success || !result.uploadUrl || !result.key) {
    throw new CreativeFactoryError(result.error || '生成成品上传地址失败', 502)
  }
  return {
    uploadUrl: result.uploadUrl,
    key: result.key,
    publicUrl: getPublicUrlForKey(result.key),
    expiresIn: 15 * 60,
  }
}

export async function claimCreativeFactoryJob(workerIdInput: unknown) {
  const workerId = clean(workerIdInput, 120)
  if (!workerId) throw new CreativeFactoryError('workerId 不能为空')
  const now = new Date()
  const leaseUntil = new Date(now.getTime() + 20 * 60_000)
  const job = await CreativeFactoryJob.findOneAndUpdate(
    {
      $and: [
        {
          $or: [
            { status: 'awaiting_codex', 'codex.status': 'queued' },
            {
              status: {
                $in: ['awaiting_codex', 'generating', 'codex_processing'],
              },
              'codex.status': { $in: ['claimed', 'processing'] },
              'codex.leaseUntil': { $lt: now },
            },
          ],
        },
        {
          $or: [
            { 'styleReference.materialId': { $exists: false } },
            { 'styleReference.analysis.status': 'completed' },
            {
              variantId: 'v001',
              'styleReference.analysis.status': { $in: ['pending', 'failed'] },
            },
          ],
        },
      ],
    },
    {
      $set: {
        'codex.status': 'claimed',
        'codex.workerId': workerId,
        'codex.claimedAt': now,
        'codex.leaseUntil': leaseUntil,
      },
    },
    { new: true, sort: { createdAt: 1 } },
  ).lean()

  return job ? { job, leaseUntil } : { job: null }
}

export async function planCreativeFactoryJob(
  jobId: string,
  input: any,
  workerIdInput: unknown,
) {
  const workerId = clean(workerIdInput, 120)
  const job: any = await CreativeFactoryJob.findById(jobId)
  if (!job) throw new CreativeFactoryError('Codex 任务不存在', 404)
  assertCodexJobOwner(job, workerId)

  const analysis = {
    intentSummary: clean(input?.intentSummary, 1000),
    audience: clean(input?.audience, 500),
    hook: clean(input?.hook, 500),
    featureKey: clean(input?.featureKey, 100),
    templateId: clean(input?.templateId, 200),
    rationale: clean(input?.rationale, 1000),
    editRecipe:
      input?.editRecipe && typeof input.editRecipe === 'object'
        ? input.editRecipe
        : {},
  }
  if (!analysis.intentSummary || !analysis.hook) {
    throw new CreativeFactoryError('Codex 方案必须包含 intentSummary 和 hook')
  }
  if (job.workflow === 'generate_then_edit' && !analysis.featureKey) {
    throw new CreativeFactoryError('生成型任务必须选择 ai-host featureKey')
  }
  if (
    job.styleReference?.mediaType === 'video' &&
    job.source?.mediaType === 'image' &&
    analysis.featureKey !== 'video'
  ) {
    throw new CreativeFactoryError(
      '图片来源搭配视频示例时必须先走 ai-host 图生视频',
    )
  }

  if (job.styleReference?.materialId) {
    const existingReferenceAnalysis = job.styleReference?.analysis?.toObject
      ? job.styleReference.analysis.toObject()
      : job.styleReference?.analysis
    const referenceAnalysis =
      existingReferenceAnalysis?.status === 'completed'
        ? existingReferenceAnalysis
        : sanitizeReferenceAnalysis(input?.referenceAnalysis)
    if (!referenceAnalysis) {
      throw new CreativeFactoryError('首个变体必须完成素材示例广告元素分析')
    }
    job.styleReference.analysis = referenceAnalysis
    await CreativeFactoryJob.updateMany(
      {
        batchId: job.batchId,
        'styleReference.materialId': job.styleReference.materialId,
        _id: { $ne: job._id },
      },
      { $set: { 'styleReference.analysis': referenceAnalysis } },
    )
  }

  job.analysis = analysis
  job.codex.status = 'processing'
  job.codex.leaseUntil = new Date(Date.now() + 60 * 60_000)

  if (job.workflow !== 'generate_then_edit') {
    job.status = 'codex_processing'
    await job.save()
    return job.toObject()
  }

  job.status = 'generating'
  job.aiHost.status = 'submitting'
  await job.save()

  try {
    const result = await createAiHostGeneration({
      externalBatchId: job.batchId,
      externalVariantId: job.variantId,
      sourceImageUrl: job.source.url,
      featureKey: analysis.featureKey,
      templateId: analysis.templateId || undefined,
      creativeDirection: clean(
        job.styleReference?.analysis?.generationPrompt ||
          job.styleReference?.analysis?.summary,
        1600,
      ),
      styleReference: job.styleReference?.materialId
        ? {
            materialId: String(job.styleReference.materialId),
            url: job.styleReference.url,
            mediaType: job.styleReference.mediaType,
            name: job.styleReference.name,
          }
        : undefined,
    })
    job.aiHost = mapAiHostFields(result)
    if (result.status === 'succeeded') job.status = 'codex_processing'
    if (result.status === 'failed') {
      job.status = 'failed'
      job.codex.status = 'failed'
      job.error = result.error || 'ai-host 生成失败'
    }
    await job.save()
    return job.toObject()
  } catch (error: any) {
    job.status = 'generating'
    job.codex.status = 'processing'
    job.aiHost.status = 'submit_error'
    job.aiHost.error = error.message
    job.error = `ai-host 提交暂时失败，等待租约重试：${error.message}`
    await job.save()
    throw error
  }
}

export async function refreshCreativeFactoryJob(
  jobId: string,
  scope?: CreativeFactoryScope,
  workerIdInput?: unknown,
) {
  const filter = scope
    ? { _id: jobId, ...jobScopeFilter(scope) }
    : { _id: jobId }
  const job: any = await CreativeFactoryJob.findOne(filter)
  if (!job) throw new CreativeFactoryError('生产任务不存在', 404)
  if (workerIdInput !== undefined) {
    assertCodexJobOwner(job, clean(workerIdInput, 120))
    job.codex.leaseUntil = new Date(Date.now() + 60 * 60_000)
  }
  if (
    job.workflow === 'edit_only' ||
    job.workflow === 'extract_frame_then_edit' ||
    !job.analysis?.featureKey
  ) {
    if (workerIdInput !== undefined) await job.save()
    return job.toObject()
  }

  const result = await getAiHostGenerationStatus({
    externalBatchId: job.batchId,
    externalVariantId: job.variantId,
    featureKey: job.analysis.featureKey,
  })
  job.aiHost = mapAiHostFields(result)
  if (result.status === 'succeeded') job.status = 'codex_processing'
  if (result.status === 'failed') {
    job.status = 'failed'
    job.codex.status = 'failed'
    job.error = result.error || 'ai-host 生成失败'
  }
  await job.save()
  return job.toObject()
}

export async function completeCreativeFactoryJob(
  jobId: string,
  input: any,
  workerIdInput: unknown,
) {
  const workerId = clean(workerIdInput, 120)
  const job: any = await CreativeFactoryJob.findById(jobId)
  if (!job) throw new CreativeFactoryError('Codex 任务不存在', 404)
  assertCodexJobOwner(job, workerId)

  const materialScope = job.organizationId
    ? { organizationId: job.organizationId }
    : { createdBy: job.createdBy }
  if (job.status === 'ready' && job.outputMaterialId) {
    const completedMaterial: any = await Material.findOne({
      _id: job.outputMaterialId,
      ...materialScope,
    })
    if (!completedMaterial) {
      throw new CreativeFactoryError('已完成任务的成品素材不存在', 409)
    }
    return {
      job: job.toObject(),
      material: completedMaterial.toObject
        ? completedMaterial.toObject()
        : completedMaterial,
    }
  }
  if (job.status !== 'codex_processing' || job.codex?.status !== 'processing') {
    throw new CreativeFactoryError('生产任务尚未进入可完成状态', 409)
  }

  let material: any = null
  const existingMaterialId = clean(input?.outputMaterialId, 100)
  if (existingMaterialId) {
    material = await Material.findOne({
      _id: existingMaterialId,
      ...materialScope,
    })
    if (!material)
      throw new CreativeFactoryError('成品素材不存在或不属于当前组织', 404)
  } else {
    const outputs = Array.isArray(input?.outputs)
      ? input.outputs.slice(0, 10)
      : []
    const finalOutput =
      outputs.find((output: any) => output?.role === 'final') || outputs[0]
    const mediaType: 'image' | 'video' =
      finalOutput?.mediaType === 'video' ? 'video' : 'image'
    if (mediaType !== job.requestedOutput.mediaType) {
      throw new CreativeFactoryError('成品媒体类型与任务要求不一致')
    }
    if (clean(finalOutput?.storageProvider, 30) !== 'r2') {
      throw new CreativeFactoryError('Codex 成品必须上传到任务专属 R2 路径')
    }
    const storageKey = validateCreativeFactoryStorageKey(
      job,
      finalOutput?.storageKey,
    )
    const outputUrl = assertPublicUrl(getPublicUrlForKey(storageKey))
    const materialData = {
      organizationId: job.organizationId || undefined,
      name: clean(finalOutput?.name, 160) || `${job.title}-${job.variantId}`,
      type: mediaType,
      status: 'ready' as const,
      storage: {
        provider: 'r2' as const,
        key: storageKey,
        url: outputUrl,
      },
      file: {
        originalName: clean(finalOutput?.name, 160) || undefined,
        mimeType: clean(finalOutput?.mimeType, 120) || undefined,
        size: Number(finalOutput?.size) || undefined,
        width: Number(finalOutput?.width) || undefined,
        height: Number(finalOutput?.height) || undefined,
        duration: Number(finalOutput?.duration) || undefined,
      },
      source: {
        type: 'import' as const,
        platform: 'creative_factory',
        externalCreativeId: job._id.toString(),
        assetKind: mediaType,
        isOriginal: false,
        importedAt: new Date(),
        importedBy: workerId,
      },
      tags: ['creative-factory', job.brandKey, `batch:${job.batchId}`],
      folder: 'Creative Factory',
      createdBy: job.createdBy,
      notes: `Codex 处理；意图：${job.intent}`.slice(0, 1000),
    }
    material = await Material.findOne({
      ...materialScope,
      'source.platform': 'creative_factory',
      'source.externalCreativeId': job._id.toString(),
    })
    if (!material) material = await Material.create(materialData)
  }

  job.outputMaterialId = material._id
  job.status = 'ready'
  job.codex.status = 'completed'
  job.codex.completedAt = new Date()
  job.codex.notes = clean(input?.notes, 2000)
  job.codex.outputs = [
    {
      role: 'final',
      name: material.name,
      mediaType: material.type,
      storageProvider: material.storage?.provider,
      storageKey: material.storage?.key,
      url: material.storage?.url,
    },
  ]
  job.error = undefined
  await job.save()
  return {
    job: job.toObject(),
    material: material.toObject ? material.toObject() : material,
  }
}

export async function failCreativeFactoryJob(
  jobId: string,
  input: any,
  workerIdInput: unknown,
) {
  const workerId = clean(workerIdInput, 120)
  const error = clean(input?.error, 2000) || 'Codex 处理失败'
  const job: any = await CreativeFactoryJob.findOneAndUpdate(
    { _id: jobId, 'codex.workerId': workerId },
    { $set: { status: 'failed', 'codex.status': 'failed', error } },
    { new: true },
  ).lean()
  if (!job)
    throw new CreativeFactoryError('Codex 任务不存在或不属于当前执行器', 404)
  return job
}

export async function linkCreativeFactoryAttribution(
  materialId: string,
  mapping: Record<string, unknown>,
) {
  const now = new Date()
  await CreativeFactoryJob.updateMany(
    { outputMaterialId: materialId },
    {
      $set: { 'attribution.status': 'linked', 'attribution.linkedAt': now },
      $addToSet: { 'attribution.mappings': mapping },
    },
  )
}
