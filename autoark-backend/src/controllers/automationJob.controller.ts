import { Request, Response } from 'express'
import mongoose from 'mongoose'
import logger from '../utils/logger'
import AutomationJob, {
  AUTOMATION_JOB_STATUSES,
  AUTOMATION_JOB_TYPES,
} from '../models/AutomationJob'
import {
  createAutomationJob,
  listAutomationJobs,
  cancelAutomationJob,
  retryAutomationJob,
} from '../services/automationJob.service'
import { UserRole } from '../models/User'
import { parsePagination, pickSafeQueryString } from '../utils/pagination'

const AUTOMATION_JOB_MAX_PAGE_SIZE = 100
const AUTOMATION_JOB_PAYLOAD_MAX_BYTES = 64 * 1024
const AUTOMATION_JOB_PAYLOAD_MAX_DEPTH = 6
const AUTOMATION_JOB_PAYLOAD_MAX_KEYS = 50
const AUTOMATION_JOB_PAYLOAD_MAX_ARRAY_ITEMS = 100
const AUTOMATION_JOB_PAYLOAD_STRING_MAX_LENGTH = 1000
const AUTOMATION_JOB_KEY_MAX_LENGTH = 80
const AUTOMATION_JOB_IDEMPOTENCY_KEY_MAX_LENGTH = 160
const AUTOMATION_JOB_PRIORITY_MAX = 10
const AUTOMATION_JOB_SENSITIVE_PAYLOAD_KEYS = new Set([
  'accessToken',
  'access_token',
  'fbToken',
  'token',
  'password',
  'secret',
  'appSecret',
  'app_secret',
])

const API_CREATABLE_JOB_TYPES = new Set([
  'RUN_AGENT',
  'RUN_AGENT_AS_JOBS',
  'EXECUTE_AGENT_OPERATION',
  'PUBLISH_DRAFT',
  'SYNC_FB_USER_ASSETS',
])

const pickOptionalAutomationJobFilter = (
  value: unknown,
  allowedValues: readonly string[],
  fieldName: string,
): { value?: string; error?: string } => {
  if (value === undefined || value === '') return {}
  if (typeof value !== 'string') return { error: `${fieldName} filter is invalid` }
  if (!allowedValues.includes(value)) return { error: `${fieldName} filter is invalid` }
  return { value }
}

const pickOptionalAgentId = (value: unknown): { value?: string; error?: string } => {
  if (value === undefined || value === '') return {}
  if (typeof value !== 'string') return { error: 'agentId filter is invalid' }
  if (!mongoose.Types.ObjectId.isValid(value)) return { error: 'agentId filter is invalid' }
  return { value }
}

const pickOptionalCreateAgentId = (value: unknown): { value?: string; error?: string } => {
  if (value === undefined || value === '') return {}
  if (typeof value !== 'string' || !mongoose.Types.ObjectId.isValid(value)) {
    return { error: 'agentId is invalid' }
  }
  return { value }
}

const pickOptionalIdempotencyKey = (value: unknown): { value?: string; error?: string } => {
  if (value === undefined || value === '') return {}
  if (typeof value !== 'string') return { error: 'idempotencyKey is invalid' }
  const safeValue = pickSafeQueryString(value, AUTOMATION_JOB_IDEMPOTENCY_KEY_MAX_LENGTH)
  return safeValue ? { value: safeValue } : {}
}

const parseJobPriority = (value: unknown): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 1
  return Math.min(AUTOMATION_JOB_PRIORITY_MAX, Math.floor(parsed))
}

const sanitizePayloadKey = (key: string): string | undefined => {
  const safeKey = pickSafeQueryString(key, AUTOMATION_JOB_KEY_MAX_LENGTH)
  if (!safeKey || safeKey.startsWith('$') || safeKey.includes('.')) return undefined
  return safeKey
}

const sanitizeAutomationPayloadValue = (
  value: any,
  depth = 0,
): { value: any; hasSensitiveKey: boolean } => {
  if (depth > AUTOMATION_JOB_PAYLOAD_MAX_DEPTH) return { value: undefined, hasSensitiveKey: false }
  if (value === null || typeof value === 'boolean') return { value, hasSensitiveKey: false }
  if (typeof value === 'number') {
    return { value: Number.isFinite(value) ? value : undefined, hasSensitiveKey: false }
  }
  if (typeof value === 'string') {
    return {
      value: pickSafeQueryString(value, AUTOMATION_JOB_PAYLOAD_STRING_MAX_LENGTH) || '',
      hasSensitiveKey: false,
    }
  }
  if (Array.isArray(value)) {
    let hasSensitiveKey = false
    const items = value
      .slice(0, AUTOMATION_JOB_PAYLOAD_MAX_ARRAY_ITEMS)
      .map((item) => {
        const sanitized = sanitizeAutomationPayloadValue(item, depth + 1)
        hasSensitiveKey = hasSensitiveKey || sanitized.hasSensitiveKey
        return sanitized.value
      })
      .filter((item) => item !== undefined)
    return { value: items, hasSensitiveKey }
  }
  if (!value || typeof value !== 'object') return { value: undefined, hasSensitiveKey: false }

  let hasSensitiveKey = false
  const output: any = {}
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, AUTOMATION_JOB_PAYLOAD_MAX_KEYS)) {
    const key = sanitizePayloadKey(rawKey)
    if (!key) continue
    if (AUTOMATION_JOB_SENSITIVE_PAYLOAD_KEYS.has(key)) {
      hasSensitiveKey = true
      continue
    }
    const sanitized = sanitizeAutomationPayloadValue(rawValue, depth + 1)
    hasSensitiveKey = hasSensitiveKey || sanitized.hasSensitiveKey
    if (sanitized.value !== undefined) output[key] = sanitized.value
  }

  return { value: output, hasSensitiveKey }
}

const sanitizeAutomationPayload = (payload: any): { value?: any; error?: string } => {
  if (payload === undefined) return { value: {} }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: 'payload must be an object' }
  }

  const rawPayload = JSON.stringify(payload)
  if (Buffer.byteLength(rawPayload, 'utf8') > AUTOMATION_JOB_PAYLOAD_MAX_BYTES) {
    return { error: 'payload is too large' }
  }

  const sanitized = sanitizeAutomationPayloadValue(payload)
  if (sanitized.hasSensitiveKey) {
    return { error: 'Raw token or secret is not allowed in automation job payload' }
  }

  return { value: sanitized.value || {} }
}

export const createJob = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: '未认证' })

    const { type, payload, agentId, idempotencyKey, priority } = req.body || {}
    if (!type) return res.status(400).json({ success: false, error: 'type is required' })
    if (!API_CREATABLE_JOB_TYPES.has(type)) {
      return res.status(400).json({ success: false, error: 'Unsupported automation job type' })
    }
    const safeAgentId = pickOptionalCreateAgentId(agentId)
    if (safeAgentId.error) return res.status(400).json({ success: false, error: safeAgentId.error })

    const safeIdempotencyKey = pickOptionalIdempotencyKey(idempotencyKey)
    if (safeIdempotencyKey.error) return res.status(400).json({ success: false, error: safeIdempotencyKey.error })

    const safePayload = sanitizeAutomationPayload(payload)
    if (safePayload.error) return res.status(400).json({ success: false, error: safePayload.error })

    const organizationId =
      req.user.organizationId && mongoose.Types.ObjectId.isValid(req.user.organizationId)
        ? new mongoose.Types.ObjectId(req.user.organizationId)
        : undefined

    const job = await createAutomationJob({
      type,
      payload: safePayload.value,
      agentId: safeAgentId.value,
      idempotencyKey: safeIdempotencyKey.value,
      priority: parseJobPriority(priority),
      organizationId,
      createdBy: req.user.userId,
    })

    res.json({ success: true, data: job })
  } catch (e: any) {
    logger.error('[AutomationJob] Create job failed:', e)
    res.status(500).json({ success: false, error: e.message })
  }
}

export const getJobs = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: '未认证' })

    const statusFilter = pickOptionalAutomationJobFilter(req.query.status, AUTOMATION_JOB_STATUSES, 'status')
    const typeFilter = pickOptionalAutomationJobFilter(req.query.type, AUTOMATION_JOB_TYPES, 'type')
    const agentIdFilter = pickOptionalAgentId(req.query.agentId)
    const filterError = statusFilter.error || typeFilter.error || agentIdFilter.error
    if (filterError) return res.status(400).json({ success: false, error: filterError })

    const { page, pageSize } = parsePagination(req.query, {
      defaultPageSize: 20,
      maxPageSize: AUTOMATION_JOB_MAX_PAGE_SIZE,
    })

    if (req.user.role !== UserRole.SUPER_ADMIN && !req.user.organizationId) {
      return res.json({ success: true, data: { list: [], total: 0, page, pageSize } })
    }

    const organizationId =
      req.user.role !== UserRole.SUPER_ADMIN &&
      req.user.organizationId &&
      mongoose.Types.ObjectId.isValid(req.user.organizationId)
        ? new mongoose.Types.ObjectId(req.user.organizationId)
        : undefined

    const data = await listAutomationJobs({
      organizationId,
      status: statusFilter.value,
      type: typeFilter.value,
      agentId: agentIdFilter.value,
      page,
      pageSize,
    })

    res.json({ success: true, data })
  } catch (e: any) {
    logger.error('[AutomationJob] Get jobs failed:', e)
    res.status(500).json({ success: false, error: e.message })
  }
}

export const getJob = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: '未认证' })

    const doc: any = await AutomationJob.findById(req.params.id)
    if (!doc) return res.status(404).json({ success: false, error: 'Job not found' })

    // 组织隔离：非超管只能看自己组织
    if (req.user.role !== UserRole.SUPER_ADMIN) {
      if (!req.user.organizationId || String(doc.organizationId || '') !== String(req.user.organizationId)) {
        return res.status(403).json({ success: false, error: 'Forbidden' })
      }
    }

    res.json({ success: true, data: doc })
  } catch (e: any) {
    logger.error('[AutomationJob] Get job failed:', e)
    res.status(500).json({ success: false, error: e.message })
  }
}

export const cancelJob = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: '未认证' })
    const doc: any = await AutomationJob.findById(req.params.id)
    if (!doc) return res.status(404).json({ success: false, error: 'Job not found' })

    if (req.user.role !== UserRole.SUPER_ADMIN) {
      if (!req.user.organizationId || String(doc.organizationId || '') !== String(req.user.organizationId)) {
        return res.status(403).json({ success: false, error: 'Forbidden' })
      }
    }

    const updated = await cancelAutomationJob(req.params.id)
    res.json({ success: true, data: updated })
  } catch (e: any) {
    logger.error('[AutomationJob] Cancel job failed:', e)
    res.status(500).json({ success: false, error: e.message })
  }
}

export const retryJob = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: '未认证' })
    const doc: any = await AutomationJob.findById(req.params.id)
    if (!doc) return res.status(404).json({ success: false, error: 'Job not found' })

    if (req.user.role !== UserRole.SUPER_ADMIN) {
      if (!req.user.organizationId || String(doc.organizationId || '') !== String(req.user.organizationId)) {
        return res.status(403).json({ success: false, error: 'Forbidden' })
      }
    }

    const updated = await retryAutomationJob(req.params.id)
    res.json({ success: true, data: updated })
  } catch (e: any) {
    logger.error('[AutomationJob] Retry job failed:', e)
    res.status(500).json({ success: false, error: e.message })
  }
}
