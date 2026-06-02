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
import { parsePagination } from '../utils/pagination'

const AUTOMATION_JOB_MAX_PAGE_SIZE = 100

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

export const createJob = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: '未认证' })

    const { type, payload, agentId, idempotencyKey, priority } = req.body || {}
    if (!type) return res.status(400).json({ success: false, error: 'type is required' })
    if (!API_CREATABLE_JOB_TYPES.has(type)) {
      return res.status(400).json({ success: false, error: 'Unsupported automation job type' })
    }
    if (payload?.accessToken) {
      return res.status(400).json({ success: false, error: 'Raw accessToken is not allowed in automation job payload' })
    }

    const organizationId =
      req.user.organizationId && mongoose.Types.ObjectId.isValid(req.user.organizationId)
        ? new mongoose.Types.ObjectId(req.user.organizationId)
        : undefined

    const job = await createAutomationJob({
      type,
      payload,
      agentId,
      idempotencyKey,
      priority,
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
