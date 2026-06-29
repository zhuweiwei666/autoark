import { Request } from 'express'
import mongoose from 'mongoose'
import OpsLog from '../models/OpsLog'
import { UserRole } from '../models/User'
import { JwtPayload } from '../utils/jwt'
import logger from '../utils/logger'
import { objectIdValue } from '../utils/accessControl'
import { redactSensitiveData } from '../utils/sensitiveData'
import { parseLimitedNumber, pickAllowedString, pickSafeQueryString } from '../utils/pagination'

export const AUDIT_LOG_STATUSES = ['success', 'failed', 'warning'] as const

type AuditStatus = typeof AUDIT_LOG_STATUSES[number]

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

const pickAuditLogObjectId = (value: any) => {
  if (typeof value !== 'string') return undefined
  return mongoose.Types.ObjectId.isValid(value) ? objectIdValue(value) : undefined
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
    organizationId?: any
    category?: any
    action?: any
    status?: any
    limit?: any
  },
) {
  const query: any = {}

  if (currentUser.role === UserRole.SUPER_ADMIN) {
    const organizationId = pickAuditLogObjectId(filters.organizationId)
    if (organizationId) {
      query.organizationId = organizationId
    }
  } else if (currentUser.role === UserRole.ORG_ADMIN && currentUser.organizationId) {
    query.organizationId = objectIdValue(currentUser.organizationId)
  } else {
    query.userId = objectIdValue(currentUser.userId)
  }

  const category = pickSafeQueryString(filters.category, 80)
  const action = pickSafeQueryString(filters.action, 120)
  const status = pickAllowedString(filters.status, AUDIT_LOG_STATUSES, '')
  if (category) query.category = category
  if (action) query.action = action
  if (status) query.status = status

  const limit = parseLimitedNumber(filters.limit, 50, 200)
  return OpsLog.find(query).sort({ createdAt: -1 }).limit(limit).lean()
}
