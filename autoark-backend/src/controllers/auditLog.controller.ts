import { Request, Response } from 'express'
import logger from '../utils/logger'
import { listAuditLogs } from '../services/auditLog.service'

export const getAuditLogs = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: '未认证' })
    }

    const logs = await listAuditLogs(req.user, {
      organizationId: typeof req.query.organizationId === 'string' ? req.query.organizationId : undefined,
      category: typeof req.query.category === 'string' ? req.query.category : undefined,
      action: typeof req.query.action === 'string' ? req.query.action : undefined,
      status: typeof req.query.status === 'string' ? req.query.status as any : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    })

    res.json({ success: true, data: logs })
  } catch (error: any) {
    logger.error('[AuditLog] list failed:', error)
    res.status(500).json({ success: false, message: error.message || '获取审计日志失败' })
  }
}
