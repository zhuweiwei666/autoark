import { Request, Response } from 'express'
import logger from '../utils/logger'
import {
  getCommercialOrganizationReadiness,
  getCommercialPlans,
  getCommercialReadiness,
  getCommercialSupportPackage,
  getCommercialUsageLedger,
} from '../services/commercial.service'
import { writeAuditLog } from '../services/auditLog.service'

export const getReadiness = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: '未认证' })
    }

    const data = await getCommercialReadiness(
      req.user,
      typeof req.query.organizationId === 'string' ? req.query.organizationId : undefined,
    )

    res.json({ success: true, data })
  } catch (error: any) {
    logger.error('[Commercial] Get readiness failed:', error)
    const message = error.message || '获取商用状态失败'
    const status = message.includes('无权') || message.includes('未关联') ? 403 : 500
    res.status(status).json({ success: false, message })
  }
}

export const getPlans = async (_req: Request, res: Response) => {
  res.json({ success: true, data: getCommercialPlans() })
}

export const getOrganizationReadiness = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: '未认证' })
    }

    const data = await getCommercialOrganizationReadiness(req.user)
    res.json({ success: true, data })
  } catch (error: any) {
    logger.error('[Commercial] Get organization readiness failed:', error)
    const message = error.message || '获取客户商用状态失败'
    const status = message.includes('无权') ? 403 : 500
    res.status(status).json({ success: false, message })
  }
}

export const getSupportPackage = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: '未认证' })
    }

    const requestedOrganizationId = typeof req.query.organizationId === 'string'
      ? req.query.organizationId
      : undefined
    const data = await getCommercialSupportPackage(
      req.user,
      requestedOrganizationId,
    )

    await writeAuditLog(req, {
      category: 'commercial',
      action: 'commercial.support_package.generate',
      status: 'success',
      organizationId: data.scope.organizationId,
      targetType: 'commercial_support_package',
      targetId: data.supportId,
      summary: `生成客户支持包 ${data.scope.organizationName}：${data.readiness.state.label}`,
      metadata: {
        supportId: data.supportId,
        scopeMode: data.scope.mode,
        organizationId: data.scope.organizationId,
        organizationName: data.scope.organizationName,
        readinessScore: data.readiness.score,
        readinessState: data.readiness.state.level,
        readinessLabel: data.readiness.state.label,
        readyAccountCount: data.facebookAssets.summary.readyAccountCount,
        accountCount: data.facebookAssets.summary.accountCount,
        tokenCount: data.facebookAssets.summary.tokenCount,
        expiredTokenCount: data.facebookAssets.summary.expiredTokenCount,
        expiringSoonTokenCount: data.facebookAssets.summary.expiringSoonTokenCount,
        staleTokenCheckCount: data.facebookAssets.summary.staleTokenCheckCount,
        tokenWithoutExpiryCount: data.facebookAssets.summary.tokenWithoutExpiryCount,
        earliestTokenExpiresAt: data.facebookAssets.summary.earliestTokenExpiresAt,
        facebookRiskCount: data.facebookAssets.risks.length,
        firstFacebookAssetRisk: data.facebookAssets.risks[0]?.message,
        recentTaskCount: data.recentTasks.length,
        riskCount: data.readiness.risks.length,
        nextActionIds: data.readiness.nextActions.map((action: any) => action.id).slice(0, 5),
      },
    })

    res.json({ success: true, data })
  } catch (error: any) {
    logger.error('[Commercial] Get support package failed:', error)
    const message = error.message || '生成客户支持包失败'
    const status = message.includes('无权') || message.includes('未关联') ? 403 : 500
    if (req.user) {
      await writeAuditLog(req, {
        category: 'commercial',
        action: 'commercial.support_package.generate',
        status: 'failed',
        organizationId: typeof req.query.organizationId === 'string'
          ? req.query.organizationId
          : req.user.organizationId,
        targetType: 'commercial_support_package',
        summary: '生成客户支持包失败',
        reason: message,
        metadata: {
          requestedOrganizationId: typeof req.query.organizationId === 'string'
            ? req.query.organizationId
            : undefined,
          statusCode: status,
        },
      })
    }
    res.status(status).json({ success: false, message })
  }
}

export const getUsageLedger = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: '未认证' })
    }

    const data = await getCommercialUsageLedger(
      req.user,
      typeof req.query.organizationId === 'string' ? req.query.organizationId : undefined,
    )

    res.json({ success: true, data })
  } catch (error: any) {
    logger.error('[Commercial] Get usage ledger failed:', error)
    const message = error.message || '获取商用用量流水失败'
    const status = message.includes('无权') || message.includes('未关联') ? 403 : 500
    res.status(status).json({ success: false, message })
  }
}
