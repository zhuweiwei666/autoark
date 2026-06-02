import { Request } from 'express'
import mongoose from 'mongoose'
import OpsLog from '../models/OpsLog'
import { UserRole } from '../models/User'
import { JwtPayload } from '../utils/jwt'
import logger from '../utils/logger'
import { objectIdValue } from '../utils/accessControl'
import { redactSensitiveData } from '../utils/sensitiveData'
import { parseLimitedNumber } from '../utils/pagination'

type AuditStatus = 'success' | 'failed' | 'warning'

export interface AuditLogInput {
  category: string
  action: string
  status?: AuditStatus
  targetType?: string
  targetId?: string
  summary?: string
  before?: any
  after?: any
  reason?: string
  related?: any
  metadata?: any
  organizationId?: any
  userId?: any
  username?: string
  userEmail?: string
  userRole?: string
}

const toObjectId = (value: any) => {
  if (!value) return undefined
  if (value instanceof mongoose.Types.ObjectId) return value
  if (typeof value === 'object' && value._id) return toObjectId(value._id)
  if (mongoose.Types.ObjectId.isValid(String(value))) return new mongoose.Types.ObjectId(String(value))
  return undefined
}

export async function writeAuditLog(req: Request, input: AuditLogInput): Promise<void> {
  try {
    const requestUser = req.user
    await OpsLog.create({
      organizationId: toObjectId(input.organizationId || requestUser?.organizationId),
      userId: toObjectId(input.userId || requestUser?.userId),
      username: input.username || (requestUser as any)?.username,
      userEmail: input.userEmail,
      userRole: input.userRole || requestUser?.role,
      operator: input.username || requestUser?.userId || 'anonymous',
      channel: 'web',
      category: input.category,
      action: input.action,
      status: input.status || 'success',
      targetType: input.targetType,
      targetId: input.targetId,
      summary: redactSensitiveData(input.summary),
      before: redactSensitiveData(input.before),
      after: redactSensitiveData(input.after),
      reason: redactSensitiveData(input.reason),
      related: redactSensitiveData(input.related),
      metadata: redactSensitiveData(input.metadata),
      requestId: req.requestId,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    })
  } catch (error: any) {
    logger.warn(`[AuditLog] write failed: ${error.message}`)
  }
}

export async function listAuditLogs(
  currentUser: JwtPayload,
  filters: {
    organizationId?: string
    category?: string
    action?: string
    status?: AuditStatus
    limit?: number
  },
) {
  const query: any = {}

  if (currentUser.role === UserRole.SUPER_ADMIN) {
    if (filters.organizationId) {
      query.organizationId = objectIdValue(filters.organizationId)
    }
  } else if (currentUser.role === UserRole.ORG_ADMIN && currentUser.organizationId) {
    query.organizationId = objectIdValue(currentUser.organizationId)
  } else {
    query.userId = objectIdValue(currentUser.userId)
  }

  if (filters.category) query.category = filters.category
  if (filters.action) query.action = filters.action
  if (filters.status) query.status = filters.status

  const limit = parseLimitedNumber(filters.limit, 50, 200)
  return OpsLog.find(query).sort({ createdAt: -1 }).limit(limit).lean()
}
