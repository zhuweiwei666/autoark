import { Request, Response } from 'express'
import { UserRole } from '../models/User'
import {
  claimCreativeFactoryJob,
  completeCreativeFactoryJob,
  createCreativeFactoryUploadUrl,
  createCreativeFactoryBatch,
  failCreativeFactoryJob,
  getCreativeFactoryBatch,
  getCreativeFactoryCatalog,
  listCreativeFactoryBatches,
  planCreativeFactoryJob,
  refreshCreativeFactoryJob,
  CreativeFactoryError,
  type CreativeFactoryScope,
} from '../services/creativeFactory.service'

const readParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : String(value || '')

const scopeFromRequest = (req: Request): CreativeFactoryScope => ({
  organizationId: req.user?.organizationId,
  userId: req.user?.userId || '',
  isSuperAdmin: req.user?.role === UserRole.SUPER_ADMIN,
})

const sendError = (res: Response, error: any) => {
  const status = error instanceof CreativeFactoryError ? error.statusCode : 500
  res.status(status).json({
    success: false,
    message: error?.message || 'Creative Factory 操作失败',
  })
}

export const createBatch = async (req: Request, res: Response) => {
  try {
    res.status(201).json({
      success: true,
      data: await createCreativeFactoryBatch(
        req.body || {},
        scopeFromRequest(req),
      ),
    })
  } catch (error) {
    sendError(res, error)
  }
}

export const listBatches = async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: await listCreativeFactoryBatches(scopeFromRequest(req)),
    })
  } catch (error) {
    sendError(res, error)
  }
}

export const getBatch = async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: await getCreativeFactoryBatch(
        readParam(req.params.batchId),
        scopeFromRequest(req),
      ),
    })
  } catch (error) {
    sendError(res, error)
  }
}

export const catalog = async (req: Request, res: Response) => {
  try {
    const featureKey = Array.isArray(req.query.featureKey)
      ? req.query.featureKey[0]
      : req.query.featureKey
    res.json({
      success: true,
      data: await getCreativeFactoryCatalog(String(featureKey || '')),
    })
  } catch (error) {
    sendError(res, error)
  }
}

export const refreshJob = async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: await refreshCreativeFactoryJob(
        readParam(req.params.jobId),
        scopeFromRequest(req),
      ),
    })
  } catch (error) {
    sendError(res, error)
  }
}

export const codexClaim = async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: await claimCreativeFactoryJob(req.body?.workerId),
    })
  } catch (error) {
    sendError(res, error)
  }
}

export const codexCatalog = async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: await getCreativeFactoryCatalog(String(req.body?.featureKey || '')),
    })
  } catch (error) {
    sendError(res, error)
  }
}

export const codexUploadUrl = async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: await createCreativeFactoryUploadUrl(
        readParam(req.params.jobId),
        req.body,
        req.body?.workerId,
      ),
    })
  } catch (error) {
    sendError(res, error)
  }
}

export const codexPlan = async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: await planCreativeFactoryJob(
        readParam(req.params.jobId),
        req.body?.plan,
        req.body?.workerId,
      ),
    })
  } catch (error) {
    sendError(res, error)
  }
}

export const codexRefresh = async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: await refreshCreativeFactoryJob(
        readParam(req.params.jobId),
        undefined,
        req.body?.workerId,
      ),
    })
  } catch (error) {
    sendError(res, error)
  }
}

export const codexComplete = async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: await completeCreativeFactoryJob(
        readParam(req.params.jobId),
        req.body,
        req.body?.workerId,
      ),
    })
  } catch (error) {
    sendError(res, error)
  }
}

export const codexFail = async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: await failCreativeFactoryJob(
        readParam(req.params.jobId),
        req.body,
        req.body?.workerId,
      ),
    })
  } catch (error) {
    sendError(res, error)
  }
}
