import { Request, Response } from 'express'
import mongoose from 'mongoose'
import { UserRole } from '../models/User'
import {
  getPlaybook,
  listBoundOptimizers,
  listPlaybooks,
} from '../services/optimizerLearning.service'
import {
  getPlaybookGeneration,
  requestPlaybookGeneration,
} from '../services/optimizerPlaybookGeneration.service'
import {
  approveReplica,
  createReplica,
  evaluateReplica,
  getReplica,
  listReplicaAssets,
  listReplicas,
  publishReplica,
  replicaConfirmations,
} from '../services/optimizerReplica.service'
import {
  confirmNameMatchedPixel,
  createExecutionMandate,
  listExecutionMandates,
  materializeReusableAssets,
  revokeExecutionMandate,
} from '../services/optimizerExecution.service'
import { writeAuditLog } from '../services/auditLog.service'
import { scopedOrgFilter, scopedTokenFilter } from '../utils/accessControl'

const requestOrganizationId = (req: Request): string | undefined => {
  if (!req.user) return undefined
  if (req.user.role !== UserRole.SUPER_ADMIN) return req.user.organizationId
  const value = req.body?.organizationId ?? req.query.organizationId
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || !mongoose.Types.ObjectId.isValid(value)) {
    throw Object.assign(new Error('organizationId 无效'), { statusCode: 400 })
  }
  return value
}

const boolValue = (value: any, fallback: boolean) => {
  if (value === undefined) return fallback
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

const sendError = async (
  req: Request,
  res: Response,
  error: any,
  action: string,
  targetType?: string,
  targetId?: string,
) => {
  await writeAuditLog(req, {
    category: 'ai_optimizer',
    action,
    status: 'failed',
    targetType,
    targetId,
    summary: error?.message || 'AI 投手操作失败',
    metadata: error?.details,
  })
  return res.status(error?.statusCode || 500).json({
    success: false,
    message: error?.message || 'AI 投手操作失败',
    code: error?.code || error?.errorCode,
    details: error?.details,
  })
}

export const getOptimizers = async (req: Request, res: Response) => {
  try {
    const organizationId = requestOrganizationId(req)
    const data = await listBoundOptimizers({ organizationId })
    res.json({ success: true, data })
  } catch (error: any) {
    await sendError(req, res, error, 'list_optimizers')
  }
}

export const createPlaybook = async (req: Request, res: Response) => {
  try {
    const organizationId = requestOrganizationId(req)
    const data = await requestPlaybookGeneration({
      optimizerId: req.params.optimizerId,
      organizationId,
      currency: req.body?.currency,
      windowDays: req.body?.windowDays,
      refreshInsights: boolValue(req.body?.refreshInsights, true),
      generatedBy: req.user?.userId,
    })
    await writeAuditLog(req, {
      category: 'ai_optimizer',
      action: 'queue_playbook_generation',
      targetType: 'PlaybookGeneration',
      targetId: String(data.generation._id),
      organizationId,
      summary: `提交投手 ${data.generation.optimizerId} 的异步打法学习任务`,
      metadata: {
        status: data.generation.status,
        currency: data.generation.currency,
        windowDays: data.generation.windowDays,
        refreshInsights: data.generation.refreshInsights,
        reused: data.reused,
      },
    })
    res.status(202).json({ success: true, data })
  } catch (error: any) {
    await sendError(
      req,
      res,
      error,
      'queue_playbook_generation',
      'Optimizer',
      req.params.optimizerId,
    )
  }
}

export const getPlaybookGenerationById = async (
  req: Request,
  res: Response,
) => {
  try {
    const data = await getPlaybookGeneration(
      req.params.id,
      scopedOrgFilter(req),
    )
    res.json({ success: true, data })
  } catch (error: any) {
    await sendError(
      req,
      res,
      error,
      'get_playbook_generation',
      'PlaybookGeneration',
      req.params.id,
    )
  }
}

export const getPlaybooks = async (req: Request, res: Response) => {
  try {
    const organizationId = requestOrganizationId(req)
    const data = await listPlaybooks({
      optimizerId:
        typeof req.query.optimizerId === 'string'
          ? req.query.optimizerId
          : undefined,
      organizationId,
      allOrganizations:
        req.user?.role === UserRole.SUPER_ADMIN && !organizationId,
      limit: Number(req.query.limit),
    })
    res.json({ success: true, data })
  } catch (error: any) {
    await sendError(req, res, error, 'list_playbooks')
  }
}

export const getPlaybookById = async (req: Request, res: Response) => {
  try {
    const data = await getPlaybook(req.params.id, scopedOrgFilter(req))
    res.json({ success: true, data })
  } catch (error: any) {
    await sendError(
      req,
      res,
      error,
      'get_playbook',
      'PlaybookVersion',
      req.params.id,
    )
  }
}

export const getReplicaAssets = async (req: Request, res: Response) => {
  try {
    const playbookId =
      typeof req.query.playbookId === 'string' ? req.query.playbookId : ''
    if (!playbookId) {
      return res
        .status(400)
        .json({ success: false, message: 'playbookId 不能为空' })
    }
    const data = await listReplicaAssets({
      playbookId,
      accessFilter: scopedOrgFilter(req),
      tokenAccessFilter: scopedTokenFilter(req),
    })
    res.json({ success: true, data })
  } catch (error: any) {
    await sendError(req, res, error, 'list_replica_assets')
  }
}

export const createReusableAssets = async (req: Request, res: Response) => {
  try {
    const data = await materializeReusableAssets({
      playbookId: req.params.id,
      materialLimit: req.body?.materialLimit,
      countryLimit: req.body?.countryLimit,
      createdBy: req.user?.userId,
      accessFilter: scopedOrgFilter(req),
    })
    await writeAuditLog(req, {
      category: 'ai_optimizer',
      action: 'materialize_reusable_assets',
      targetType: 'PlaybookVersion',
      targetId: req.params.id,
      organizationId: data.targetingPackage?.organizationId,
      summary: '将真人投手只读方法提炼为 AutoArk 可复用定向包和创意组',
      metadata: {
        targetingPackageId: data.targetingPackage?._id,
        creativeGroupId: data.creativeGroup?._id,
        generatedCopywritingPackage: false,
        sourceMode: 'read_only_context',
      },
    })
    res.json({ success: true, data })
  } catch (error: any) {
    await sendError(
      req,
      res,
      error,
      'materialize_reusable_assets',
      'PlaybookVersion',
      req.params.id,
    )
  }
}

export const createMandate = async (req: Request, res: Response) => {
  try {
    const data = await createExecutionMandate({
      playbookId: req.params.id,
      name: req.body?.name,
      authorizationType: req.body?.authorizationType,
      facebookTokenId: req.body?.facebookTokenId,
      metaCredentialId: req.body?.metaCredentialId,
      accounts: req.body?.accounts,
      targetingPackageId: req.body?.targetingPackageId,
      creativeGroupId: req.body?.creativeGroupId,
      copywritingPackageId: req.body?.copywritingPackageId,
      defaultDailyBudget: req.body?.defaultDailyBudget,
      maximumDailyBudget: req.body?.maximumDailyBudget,
      createdBy: req.user?.userId,
      accessFilter: scopedOrgFilter(req),
      tokenAccessFilter: scopedTokenFilter(req),
    })
    await writeAuditLog(req, {
      category: 'ai_optimizer',
      action: 'create_execution_mandate',
      targetType: 'AiExecutionMandate',
      targetId: String(data._id),
      organizationId: data.organizationId,
      summary: '管理员创建 AI 投放授权单',
      metadata: {
        playbookVersionId: data.playbookVersionId,
        sourceBoundary: data.sourceBoundary,
        authorizationType: data.authorizationType,
        facebookTokenId: data.facebookTokenId,
        metaCredentialId: data.metaCredentialId,
        accountIds: (data.accounts || []).map(
          (account: any) => account.accountId,
        ),
        targetingPackageId: data.targetingPackageId,
        creativeGroupId: data.creativeGroupId,
        copywritingPackageId: data.copywritingPackageId,
        productId: data.productId,
        budget: data.budget,
      },
    })
    res.status(201).json({ success: true, data })
  } catch (error: any) {
    await sendError(
      req,
      res,
      error,
      'create_execution_mandate',
      'PlaybookVersion',
      req.params.id,
    )
  }
}

export const confirmNamePixelMapping = async (req: Request, res: Response) => {
  try {
    const data = await confirmNameMatchedPixel({
      playbookId: req.params.id,
      copywritingPackageId: req.body?.copywritingPackageId,
      tokenId: req.body?.tokenId,
      accountId: req.body?.accountId,
      pixelId: req.body?.pixelId,
      confirmedBy: req.user?.userId,
      accessFilter: scopedOrgFilter(req),
      tokenAccessFilter: scopedTokenFilter(req),
    })
    await writeAuditLog(req, {
      category: 'ai_optimizer',
      action: 'confirm_name_pixel_mapping',
      targetType: 'Product',
      targetId: data.productId,
      summary: '管理员确认文案包与 Pixel 的精确名称关联',
      metadata: {
        playbookVersionId: req.params.id,
        copywritingPackageId: data.copywritingPackageId,
        productKey: data.productKey,
        tokenId: data.tokenId,
        accountId: data.accountId,
        pixelId: data.pixelId,
      },
    })
    res.status(201).json({ success: true, data })
  } catch (error: any) {
    await sendError(
      req,
      res,
      error,
      'confirm_name_pixel_mapping',
      'PlaybookVersion',
      req.params.id,
    )
  }
}

export const getMandates = async (req: Request, res: Response) => {
  try {
    const data = await listExecutionMandates({
      playbookId:
        typeof req.query.playbookId === 'string'
          ? req.query.playbookId
          : undefined,
      status:
        typeof req.query.status === 'string' ? req.query.status : undefined,
      accessFilter: scopedOrgFilter(req),
    })
    res.json({ success: true, data })
  } catch (error: any) {
    await sendError(req, res, error, 'list_execution_mandates')
  }
}

export const revokeMandate = async (req: Request, res: Response) => {
  try {
    const data = await revokeExecutionMandate({
      id: req.params.id,
      revokedBy: req.user?.userId,
      reason: req.body?.reason,
      accessFilter: scopedOrgFilter(req),
    })
    await writeAuditLog(req, {
      category: 'ai_optimizer',
      action: 'revoke_execution_mandate',
      targetType: 'AiExecutionMandate',
      targetId: String(data._id),
      organizationId: data.organizationId,
      summary: '管理员撤销 AI 投放授权单',
      metadata: { reason: data.revokeReason },
    })
    res.json({ success: true, data })
  } catch (error: any) {
    await sendError(
      req,
      res,
      error,
      'revoke_execution_mandate',
      'AiExecutionMandate',
      req.params.id,
    )
  }
}

export const createReplicaRun = async (req: Request, res: Response) => {
  try {
    const data = await createReplica({
      playbookId: req.params.id,
      mandateId: req.body?.mandateId,
      dailyBudget: req.body?.dailyBudget,
      createdBy: req.user?.userId,
      accessFilter: scopedOrgFilter(req),
      tokenAccessFilter: scopedTokenFilter(req),
    })
    await writeAuditLog(req, {
      category: 'ai_optimizer',
      action: 'create_paused_replica',
      targetType: 'ReplicaRun',
      targetId: String(data.run._id),
      organizationId: data.run.organizationId,
      summary: `创建打法 v${data.run.playbookVersion} 的 PAUSED AI 复制草稿`,
      metadata: {
        mandateId: data.run.mandateId,
        status: data.run.status,
        targets: data.run.targets,
        productId: data.run.productId,
        sourceBoundary: data.run.assetSnapshot?.sourceBoundary,
        aiChanges: data.run.aiChanges,
        validation: data.validation,
      },
    })
    res.json({ success: true, data })
  } catch (error: any) {
    await sendError(
      req,
      res,
      error,
      'create_paused_replica',
      'PlaybookVersion',
      req.params.id,
    )
  }
}

export const getReplicaRuns = async (req: Request, res: Response) => {
  try {
    const data = await listReplicas({
      accessFilter: scopedOrgFilter(req),
      optimizerId:
        typeof req.query.optimizerId === 'string'
          ? req.query.optimizerId
          : undefined,
      status:
        typeof req.query.status === 'string' ? req.query.status : undefined,
      limit: Number(req.query.limit),
    })
    res.json({ success: true, data, confirmations: replicaConfirmations })
  } catch (error: any) {
    await sendError(req, res, error, 'list_replicas')
  }
}

export const getReplicaRun = async (req: Request, res: Response) => {
  try {
    const data = await getReplica(req.params.id, scopedOrgFilter(req))
    res.json({ success: true, data, confirmations: replicaConfirmations })
  } catch (error: any) {
    await sendError(req, res, error, 'get_replica', 'ReplicaRun', req.params.id)
  }
}

export const approveReplicaRun = async (req: Request, res: Response) => {
  try {
    const data = await approveReplica({
      id: req.params.id,
      confirmation: req.body?.confirmation,
      note: req.body?.note,
      approvedBy: req.user?.userId,
      accessFilter: scopedOrgFilter(req),
      tokenAccessFilter: scopedTokenFilter(req),
    })
    await writeAuditLog(req, {
      category: 'ai_optimizer',
      action: 'approve_paused_replica',
      targetType: 'ReplicaRun',
      targetId: String(data._id),
      organizationId: data.organizationId,
      summary: '人工批准 PAUSED AI 复制任务',
      metadata: { draftId: data.draftId, validation: data.validation },
    })
    res.json({ success: true, data })
  } catch (error: any) {
    await sendError(
      req,
      res,
      error,
      'approve_paused_replica',
      'ReplicaRun',
      req.params.id,
    )
  }
}

export const publishReplicaRun = async (req: Request, res: Response) => {
  try {
    const data = await publishReplica({
      id: req.params.id,
      confirmation: req.body?.confirmation,
      publishedBy: req.user?.userId,
      accessFilter: scopedOrgFilter(req),
      tokenAccessFilter: scopedTokenFilter(req),
    })
    await writeAuditLog(req, {
      category: 'ai_optimizer',
      action: 'publish_paused_replica',
      targetType: 'ReplicaRun',
      targetId: String(data._id),
      organizationId: data.organizationId,
      summary: '发布 PAUSED AI 复制对象到 Meta',
      metadata: {
        taskId: data.taskId,
        effectiveStatus: data.effectiveStatus,
        statusLock: 'Campaign/AdSet/Ad=PAUSED',
      },
    })
    res.json({ success: true, data })
  } catch (error: any) {
    await sendError(
      req,
      res,
      error,
      'publish_paused_replica',
      'ReplicaRun',
      req.params.id,
    )
  }
}

export const evaluateReplicaRun = async (req: Request, res: Response) => {
  try {
    const data = await evaluateReplica({
      id: req.params.id,
      evaluatedBy: req.user?.userId,
      accessFilter: scopedOrgFilter(req),
    })
    await writeAuditLog(req, {
      category: 'ai_optimizer',
      action: 'evaluate_replica',
      targetType: 'ReplicaRun',
      targetId: req.params.id,
      organizationId: data.run.organizationId,
      summary: `评估 AI 复制任务 ${data.evaluation.checkpoint}`,
      metadata: data.evaluation,
    })
    res.json({ success: true, data })
  } catch (error: any) {
    await sendError(
      req,
      res,
      error,
      'evaluate_replica',
      'ReplicaRun',
      req.params.id,
    )
  }
}
