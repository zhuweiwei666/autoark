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

export const createReplicaRun = async (req: Request, res: Response) => {
  try {
    const data = await createReplica({
      playbookId: req.params.id,
      facebookTokenId: req.body?.facebookTokenId,
      accounts: req.body?.accounts,
      dailyBudget: req.body?.dailyBudget,
      materialLimit: req.body?.materialLimit,
      applyTopCountries: boolValue(req.body?.applyTopCountries, true),
      countryLimit: req.body?.countryLimit,
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
        status: data.run.status,
        targets: data.run.targets,
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
