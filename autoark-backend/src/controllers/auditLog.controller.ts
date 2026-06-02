import { Request, Response } from 'express'
import logger from '../utils/logger'
import { AUDIT_LOG_STATUSES, listAuditLogs } from '../services/auditLog.service'
import { parseLimitedNumber, pickAllowedString, pickSafeQueryString } from '../utils/pagination'

export const getAuditLogs = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: '未认证' })
    }

    const logs = await listAuditLogs(req.user, {
      organizationId: pickSafeQueryString(req.query.organizationId, 40),
      category: pickSafeQueryString(req.query.category, 80),
      action: pickSafeQueryString(req.query.action, 120),
      status: pickAllowedString(req.query.status, AUDIT_LOG_STATUSES, ''),
      limit: parseLimitedNumber(req.query.limit, 50, 200),
    })

    res.json({ success: true, data: logs })
  } catch (error: any) {
    logger.error('[AuditLog] list failed:', error)
    res.status(500).json({ success: false, message: error.message || '获取审计日志失败' })
  }
}
