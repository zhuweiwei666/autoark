import { Request, Response } from 'express'
import * as credentialService from '../services/metaBusinessCredential.service'
import { writeAuditLog } from '../services/auditLog.service'
import { pickSafeQueryString } from '../utils/pagination'
import { redactSensitiveData } from '../utils/sensitiveData'

const sendError = (res: Response, error: any) => {
  const statusCode = Number(error?.statusCode)
  const safeMessage = redactSensitiveData(
    error?.message || 'Meta credential operation failed',
  )
  res.status(
    Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 600
      ? statusCode
      : 500,
  ).json({
    success: false,
    error: safeMessage,
  })
}

export const getCredentials = async (req: Request, res: Response) => {
  try {
    const organizationId = pickSafeQueryString(req.query.organizationId, 64)
    const credentials = await credentialService.listCredentials(organizationId)
    res.json({ success: true, data: credentials })
  } catch (error: any) {
    sendError(res, error)
  }
}

export const getBootstrapTokens = async (_req: Request, res: Response) => {
  try {
    const tokens = await credentialService.listBootstrapTokens()
    res.json({ success: true, data: tokens })
  } catch (error: any) {
    sendError(res, error)
  }
}

export const getMigrationInventory = async (_req: Request, res: Response) => {
  try {
    const inventory = await credentialService.getMigrationInventory()
    res.json({ success: true, data: inventory })
  } catch (error: any) {
    sendError(res, error)
  }
}

export const discoverBusinesses = async (req: Request, res: Response) => {
  try {
    const businesses = await credentialService.discoverBusinesses(
      req.body?.bootstrapTokenId,
    )
    res.json({ success: true, data: businesses })
  } catch (error: any) {
    sendError(res, error)
  }
}

export const inspectBusiness = async (req: Request, res: Response) => {
  try {
    const inventory = await credentialService.inspectBusiness(
      req.body?.bootstrapTokenId,
      req.body?.businessId,
    )
    res.json({ success: true, data: inventory })
  } catch (error: any) {
    sendError(res, error)
  }
}

export const getProvisionPlan = async (req: Request, res: Response) => {
  try {
    const plan = await credentialService.buildProvisionPlan(req.body)
    res.json({ success: true, data: plan })
  } catch (error: any) {
    sendError(res, error)
  }
}

export const provisionSystemUser = async (req: Request, res: Response) => {
  if (req.body?.confirmation !== 'PROVISION_SYSTEM_USER') {
    return res.status(400).json({
      success: false,
      error: 'confirmation must equal PROVISION_SYSTEM_USER',
    })
  }

  try {
    const result = await credentialService.provisionSystemUser(
      req.body,
      req.user?.userId,
    )
    await writeAuditLog(req, {
      category: 'meta_iam',
      action: 'meta_system_user.provision',
      targetType: 'meta_business_credential',
      targetId: result.credential?._id
        ? String(result.credential._id)
        : undefined,
      organizationId: result.credential?.organizationId,
      summary: 'Provisioned organization Meta System User publishing credential',
      metadata: {
        businessId: result.credential?.businessId,
        systemUserId: result.credential?.systemUserId,
        tokenFingerprint: result.credential?.tokenFingerprint,
        assignedAssetCount: result.readback?.assignedAssetCount,
        systemUserCreated: result.readback?.systemUserCreated,
      },
    })
    res.json({
      success: true,
      data: credentialService.safeProvisionResult(result),
    })
  } catch (error: any) {
    await writeAuditLog(req, {
      category: 'meta_iam',
      action: 'meta_system_user.provision',
      status: 'failed',
      targetType: 'meta_business',
      targetId: pickSafeQueryString(req.body?.businessId, 80),
      organizationId: pickSafeQueryString(req.body?.organizationId, 64),
      summary: 'Meta System User provisioning failed',
      reason: redactSensitiveData(error?.message),
      metadata: {
        facebookAppId: pickSafeQueryString(req.body?.facebookAppId, 64),
      },
    })
    sendError(res, error)
  }
}

export const refreshCredential = async (req: Request, res: Response) => {
  try {
    const result = await credentialService.refreshCredential(
      req.params.id,
      req.user?.userId,
    )
    await writeAuditLog(req, {
      category: 'meta_iam',
      action: 'meta_system_user.validate',
      targetType: 'meta_business_credential',
      targetId: req.params.id,
      organizationId: result.credential?.organizationId,
      summary: 'Validated Meta System User credential and assigned assets',
      metadata: {
        tokenFingerprint: result.credential?.tokenFingerprint,
        checkedAssetCount: result.checks?.length,
      },
    })
    res.json({ success: true, data: result })
  } catch (error: any) {
    await writeAuditLog(req, {
      category: 'meta_iam',
      action: 'meta_system_user.validate',
      status: 'failed',
      targetType: 'meta_business_credential',
      targetId: req.params.id,
      summary: 'Meta System User credential validation failed',
      reason: redactSensitiveData(error?.message),
    })
    sendError(res, error)
  }
}

export const deactivateCredential = async (req: Request, res: Response) => {
  if (req.body?.confirmation !== 'DEACTIVATE_SYSTEM_USER_CREDENTIAL') {
    return res.status(400).json({
      success: false,
      error: 'confirmation must equal DEACTIVATE_SYSTEM_USER_CREDENTIAL',
    })
  }

  try {
    const credential = await credentialService.deactivateCredential(
      req.params.id,
      req.user?.userId,
    )
    await writeAuditLog(req, {
      category: 'meta_iam',
      action: 'meta_system_user.deactivate',
      status: 'warning',
      targetType: 'meta_business_credential',
      targetId: req.params.id,
      organizationId: credential.organizationId,
      summary: 'Deactivated AutoArk Meta System User credential locally',
      metadata: {
        businessId: credential.businessId,
        systemUserId: credential.systemUserId,
        tokenFingerprint: credential.tokenFingerprint,
        metaAssetAssignmentsChanged: false,
      },
    })
    res.json({ success: true, data: credential })
  } catch (error: any) {
    sendError(res, error)
  }
}
