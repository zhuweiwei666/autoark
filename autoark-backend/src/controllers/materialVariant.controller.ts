import { NextFunction, Request, Response } from 'express'
import { createHash, randomUUID } from 'crypto'
import mongoose from 'mongoose'
import Material from '../models/Material'
import MaterialVariantJob from '../models/MaterialVariantJob'
import { UserRole } from '../models/User'
import { writeAuditLog } from '../services/auditLog.service'
import {
  buildMaterialVariantScopeKey,
  buildRequestFingerprint,
  buildUpstreamIdempotencyKey,
  buildVariantMaterialRecord,
  getMaterialVariantGenerationConfig,
  getMaterialVariantGenerationConfigStatus,
  inferMaterialAspectRatio,
  isAmbiguousGenerationSubmissionError,
  isTerminalMaterialVariantStatus,
  MaterialVariantError,
  MATERIAL_VARIANT_CAPABILITY,
  normalizeIdempotencyKey,
  parseMaterialVariantInput,
  safeGenerationError,
  serializeMaterialVariantJob,
  submitMaterialVariantGeneration,
  verifyMaterialVariantCallback,
} from '../services/materialVariant.service'
import {
  combineFilters,
  objectIdValue,
  scopedOwnerFilter,
} from '../utils/accessControl'
import logger from '../utils/logger'

const CALLBACK_STATUSES = new Set(['completed', 'failed', 'cancelled'])

const responseError = (res: Response, error: any) => {
  const statusCode = Number(error?.statusCode) || 500
  return res.status(statusCode).json({
    success: false,
    code: error?.code || 'MATERIAL_VARIANT_ERROR',
    error: statusCode >= 500 && process.env.NODE_ENV === 'production'
      ? 'AI 视频变体服务暂不可用'
      : error?.message || 'AI 视频变体操作失败',
  })
}

const materialFilter = (req: Request, materialId: string) => combineFilters(
  { _id: objectIdValue(materialId), status: { $ne: 'deleted' } },
  scopedOwnerFilter(req),
)

const variantJobFilter = (req: Request, jobId: string) => combineFilters(
  { _id: objectIdValue(jobId) },
  scopedOwnerFilter(req),
)

export const requireMaterialVariantAdmin = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user) {
    return res.status(401).json({ success: false, error: '未认证' })
  }
  if (![UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN].includes(req.user.role)) {
    return res.status(403).json({ success: false, error: 'AI 视频变体仅限管理员使用' })
  }
  return next()
}

const updateSubmittedJob = async (job: any, upstream: any) => {
  // The terminal callback can win the race against this HTTP response. Only
  // update a still-submitting record so a late response never regresses a
  // completed local material back to queued.
  const upstreamStatus = upstream.status === 'processing' ? 'processing' : 'queued'
  const updated = await MaterialVariantJob.findOneAndUpdate(
    {
      _id: job._id,
      status: { $in: ['submitting', 'submission_unknown'] },
    },
    {
      $set: {
        status: upstreamStatus,
        generationJobId: upstream.jobId,
        'generation.provider': upstream.routing?.provider,
      },
      $unset: { error: 1 },
    },
    { new: true },
  )
  return updated || MaterialVariantJob.findById(job._id)
}

const submitVariantJob = async (job: any) => {
  try {
    const upstream = await submitMaterialVariantGeneration(job)
    return {
      job: await updateSubmittedJob(job, upstream),
      statusCode: 202,
    }
  } catch (error: any) {
    const safeError = safeGenerationError(error)
    if (isAmbiguousGenerationSubmissionError(error)) {
      const updated = await MaterialVariantJob.findOneAndUpdate(
        {
          _id: job._id,
          status: { $in: ['submitting', 'submission_unknown'] },
        },
        {
          $set: {
            status: 'submission_unknown',
            error: safeError,
          },
        },
        { new: true },
      )
      const current = updated || await MaterialVariantJob.findById(job._id)
      return {
        job: current,
        statusCode: 202,
        warning: current?.status === 'completed'
          ? undefined
          : '上游提交结果暂不确定；使用相同 Idempotency-Key 重试不会重复生成。',
      }
    }

    const updated = await MaterialVariantJob.findOneAndUpdate(
      {
        _id: job._id,
        status: { $in: ['submitting', 'submission_unknown'] },
      },
      {
        $set: {
          status: 'failed',
          error: safeError,
        },
      },
      { new: true },
    )
    const current = updated || await MaterialVariantJob.findById(job._id)
    if (current?.status === 'completed') {
      return { job: current, statusCode: 200 }
    }
    throw new MaterialVariantError(
      Number(error?.response?.status) === 429 ? 503 : 502,
      safeError.code,
      `${safeError.message}（任务 ${current?._id || job._id} 已记录）`,
    )
  }
}

const returnExistingOrResubmit = async (
  existing: any,
  requestFingerprint: string,
  res: Response,
) => {
  if (existing.requestFingerprint !== requestFingerprint) {
    throw new MaterialVariantError(
      409,
      'IDEMPOTENCY_CONFLICT',
      '相同 Idempotency-Key 已用于不同的视频变体请求',
    )
  }

  if (
    ['submitting', 'submission_unknown'].includes(existing.status)
    && !existing.generationJobId
  ) {
    const submitted = await submitVariantJob(existing)
    return res.status(submitted.statusCode).json({
      success: true,
      data: serializeMaterialVariantJob(submitted.job, {
        idempotentReplay: true,
        warning: submitted.warning,
      }),
    })
  }

  return res.status(isTerminalMaterialVariantStatus(existing.status) ? 200 : 202).json({
    success: true,
    data: serializeMaterialVariantJob(existing, { idempotentReplay: true }),
  })
}

export const getMaterialVariantConfigStatus = async (_req: Request, res: Response) => {
  const status = getMaterialVariantGenerationConfigStatus()
  return res.json({ success: true, data: status })
}

export const createMaterialVariant = async (req: Request, res: Response) => {
  try {
    // Fail before writing a local job if the cross-project contract is not configured.
    getMaterialVariantGenerationConfig()

    const parentMaterialId = typeof req.body?.parentMaterialId === 'string'
      ? req.body.parentMaterialId.trim()
      : ''
    if (!mongoose.Types.ObjectId.isValid(parentMaterialId)) {
      throw new MaterialVariantError(400, 'INVALID_PARENT_MATERIAL', 'parentMaterialId 无效')
    }

    const parent = await Material.findOne(materialFilter(req, parentMaterialId))
    if (!parent) {
      throw new MaterialVariantError(404, 'PARENT_MATERIAL_NOT_FOUND', '父素材不存在')
    }
    if (parent.type !== 'video') {
      throw new MaterialVariantError(400, 'VIDEO_REQUIRED', '目前仅支持视频素材生成变体')
    }

    const userId = String(req.user!.userId)
    const input = parseMaterialVariantInput(
      req.body,
      parent.storage?.url,
      inferMaterialAspectRatio(parent.file),
    )
    const idempotencyKey = normalizeIdempotencyKey(req.get('Idempotency-Key'))
    const scopeKey = buildMaterialVariantScopeKey(parent, userId)
    const requestFingerprint = buildRequestFingerprint(parent._id, input)

    const existing = await MaterialVariantJob.findOne({ scopeKey, idempotencyKey })
    if (existing) {
      return await returnExistingOrResubmit(existing, requestFingerprint, res)
    }

    let job: any
    try {
      job = await MaterialVariantJob.create({
        organizationId: parent.organizationId,
        scopeKey,
        parentMaterialId: parent._id,
        createdBy: userId,
        status: 'submitting',
        idempotencyKey,
        upstreamIdempotencyKey: buildUpstreamIdempotencyKey(scopeKey, idempotencyKey),
        requestFingerprint,
        externalId: `autoark-material-variant:${randomUUID()}`,
        input,
        generation: {
          service: 'ai-host-v2',
          capability: MATERIAL_VARIANT_CAPABILITY,
          priority: 20,
          resultUrlPolicy: 'permanent',
        },
      })
    } catch (error: any) {
      if (error?.code !== 11000) throw error
      const raced = await MaterialVariantJob.findOne({ scopeKey, idempotencyKey })
      if (!raced) throw error
      return await returnExistingOrResubmit(raced, requestFingerprint, res)
    }

    const submitted = await submitVariantJob(job)
    await writeAuditLog(req, {
      category: 'material_variant',
      action: 'material_variant.create',
      status: submitted.warning ? 'warning' : 'success',
      targetType: 'MaterialVariantJob',
      targetId: String(submitted.job?._id || job._id),
      summary: '提交 AI 视频素材变体任务',
      related: {
        parentMaterialId: String(parent._id),
        generationJobId: submitted.job?.generationJobId,
      },
      organizationId: parent.organizationId,
    })

    return res.status(submitted.statusCode).json({
      success: true,
      data: serializeMaterialVariantJob(submitted.job, {
        warning: submitted.warning,
      }),
    })
  } catch (error: any) {
    logger.warn(`[MaterialVariant] create failed: ${error.message}`)
    return responseError(res, error)
  }
}

export const listMaterialVariants = async (req: Request, res: Response) => {
  try {
    const parentMaterialId = typeof req.query.parentMaterialId === 'string'
      ? req.query.parentMaterialId.trim()
      : ''
    if (!mongoose.Types.ObjectId.isValid(parentMaterialId)) {
      throw new MaterialVariantError(400, 'INVALID_PARENT_MATERIAL', 'parentMaterialId 无效')
    }
    const parent = await Material.findOne(materialFilter(req, parentMaterialId)).select('_id')
    if (!parent) {
      throw new MaterialVariantError(404, 'PARENT_MATERIAL_NOT_FOUND', '父素材不存在')
    }

    const limitValue = Number(req.query.limit)
    const limit = Number.isFinite(limitValue)
      ? Math.min(50, Math.max(1, Math.floor(limitValue)))
      : 20
    const jobs = await MaterialVariantJob.find({ parentMaterialId: parent._id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
    return res.json({
      success: true,
      data: jobs.map(job => serializeMaterialVariantJob(job)),
    })
  } catch (error: any) {
    return responseError(res, error)
  }
}

export const getMaterialVariant = async (req: Request, res: Response) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.jobId)) {
      throw new MaterialVariantError(400, 'INVALID_VARIANT_JOB', '视频变体任务 ID 无效')
    }
    const job = await MaterialVariantJob.findOne(variantJobFilter(req, req.params.jobId)).lean()
    if (!job) {
      throw new MaterialVariantError(404, 'VARIANT_JOB_NOT_FOUND', '视频变体任务不存在')
    }
    return res.json({ success: true, data: serializeMaterialVariantJob(job) })
  } catch (error: any) {
    return responseError(res, error)
  }
}

const callbackMeta = (req: Request, body: any) => ({
  lastDeliveryId: String(body.deliveryId || req.get('X-Delivery-Id') || ''),
  lastFingerprint: String(
    body.fingerprint
    || createHash('sha256').update(req.rawBody || Buffer.alloc(0)).digest('hex'),
  ),
  receivedAt: new Date(),
  attempt: Math.max(1, Number(req.get('X-Callback-Attempt')) || 1),
})

const failCallbackJob = async (
  req: Request,
  job: any,
  body: any,
  status: 'failed' | 'cancelled' = 'failed',
) => {
  const error = {
    code: String(body?.error?.code || (status === 'cancelled' ? 'CANCELLED' : 'GENERATION_FAILED')).slice(0, 80),
    message: String(body?.error?.message || (status === 'cancelled' ? '生成任务已取消' : '视频变体生成失败')).slice(0, 500),
  }
  const updated = await MaterialVariantJob.findByIdAndUpdate(
    job._id,
    {
      $set: {
        status,
        generationJobId: body.jobId,
        error,
        callback: callbackMeta(req, body),
      },
    },
    { new: true },
  )
  return updated
}

export const handleMaterialVariantCallback = async (req: Request, res: Response) => {
  try {
    if (!req.rawBody || !Buffer.isBuffer(req.rawBody)) {
      throw new MaterialVariantError(400, 'RAW_BODY_MISSING', '回调原始请求体不可用')
    }
    if (!verifyMaterialVariantCallback(req.rawBody, req.get('X-Signature'))) {
      throw new MaterialVariantError(401, 'INVALID_SIGNATURE', '回调签名无效')
    }

    const body = req.body
    if (!body || typeof body !== 'object') {
      throw new MaterialVariantError(400, 'INVALID_CALLBACK', '回调请求体无效')
    }
    if (body.capability !== MATERIAL_VARIANT_CAPABILITY) {
      throw new MaterialVariantError(400, 'INVALID_CALLBACK', '回调 capability 不匹配')
    }
    if (!CALLBACK_STATUSES.has(String(body.status))) {
      throw new MaterialVariantError(400, 'INVALID_CALLBACK', '回调 status 无效')
    }
    if (
      req.get('X-Job-Id')
      && req.get('X-Job-Id') !== String(body.jobId || '')
    ) {
      throw new MaterialVariantError(400, 'INVALID_CALLBACK', 'X-Job-Id 与请求体不一致')
    }
    if (
      req.get('X-Delivery-Id')
      && req.get('X-Delivery-Id') !== String(body.deliveryId || '')
    ) {
      throw new MaterialVariantError(400, 'INVALID_CALLBACK', 'X-Delivery-Id 与请求体不一致')
    }
    if (typeof body.externalId !== 'string' || !body.externalId) {
      throw new MaterialVariantError(400, 'INVALID_CALLBACK', 'externalId 缺失')
    }

    const job: any = await MaterialVariantJob.findOne({ externalId: body.externalId })
    if (!job) {
      throw new MaterialVariantError(404, 'VARIANT_JOB_NOT_FOUND', '视频变体任务不存在')
    }
    if (job.generationJobId && job.generationJobId !== body.jobId) {
      throw new MaterialVariantError(409, 'GENERATION_JOB_MISMATCH', 'generation jobId 不匹配')
    }

    const meta = callbackMeta(req, body)
    if (
      isTerminalMaterialVariantStatus(job.status)
      && (
        job.callback?.lastDeliveryId === meta.lastDeliveryId
        || job.callback?.lastFingerprint === meta.lastFingerprint
      )
    ) {
      return res.json({
        success: true,
        data: {
          duplicate: true,
          status: job.status,
          outputMaterialId: job.outputMaterialId
            ? String(job.outputMaterialId)
            : undefined,
        },
      })
    }

    if (body.status === 'failed' || body.status === 'cancelled') {
      if (job.status === 'completed') {
        return res.json({
          success: true,
          data: { duplicate: false, ignoredTerminalRegression: true, status: job.status },
        })
      }
      const failed = await failCallbackJob(req, job, body, body.status)
      return res.json({
        success: true,
        data: { duplicate: false, status: failed?.status || body.status },
      })
    }

    const parent: any = await Material.findById(job.parentMaterialId)
    if (!parent || parent.status === 'deleted') {
      await failCallbackJob(req, job, {
        ...body,
        error: {
          code: 'PARENT_MATERIAL_NOT_FOUND',
          message: '生成完成时父素材已不存在',
        },
      })
      return res.json({
        success: true,
        data: { duplicate: false, status: 'failed' },
      })
    }

    let outputMaterial: any = await Material.findOne({
      'variant.variantJobId': job._id,
    })
    if (!outputMaterial) {
      const record = buildVariantMaterialRecord({ parent, job, callback: body })
      try {
        // Mongoose's generated create type widens nested string literals from
        // this factory; the schema remains the runtime validator at this edge.
        outputMaterial = await Material.create(record as never)
      } catch (error: any) {
        if (error?.code !== 11000) throw error
        outputMaterial = await Material.findOne({
          'variant.variantJobId': job._id,
        })
        if (!outputMaterial) throw error
      }
    }

    const updated: any = await MaterialVariantJob.findByIdAndUpdate(
      job._id,
      {
        $set: {
          status: 'completed',
          generationJobId: body.jobId,
          outputMaterialId: outputMaterial._id,
          output: {
            resultUrl: body.output?.resultUrl,
            metadata: body.output?.metadata,
          },
          'generation.provider': body.output?.metadata?.provider || 'comfyui-vace',
          callback: meta,
        },
        $unset: { error: 1 },
      },
      { new: true },
    )

    await writeAuditLog(req, {
      category: 'material_variant',
      action: 'material_variant.completed',
      targetType: 'MaterialVariantJob',
      targetId: String(job._id),
      summary: 'AI 视频素材变体已进入素材库，等待人工审核',
      related: {
        parentMaterialId: String(parent._id),
        outputMaterialId: String(outputMaterial._id),
        generationJobId: body.jobId,
      },
      organizationId: job.organizationId,
      userId: job.createdBy,
    })

    return res.json({
      success: true,
      data: {
        duplicate: false,
        status: updated?.status || 'completed',
        outputMaterialId: String(outputMaterial._id),
      },
    })
  } catch (error: any) {
    logger.warn(`[MaterialVariant] callback failed: ${error.message}`)
    return responseError(res, error)
  }
}
