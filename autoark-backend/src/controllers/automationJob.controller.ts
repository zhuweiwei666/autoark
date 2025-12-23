import { Request, Response } from 'express'
import mongoose from 'mongoose'
import logger from '../utils/logger'
import AutomationJob from '../models/AutomationJob'
import {
  createAutomationJob,
  listAutomationJobs,
  cancelAutomationJob,
  retryAutomationJob,
} from '../services/automationJob.service'
import { UserRole } from '../models/User'

export const createJob = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: '未认证' })

    const { type, payload, agentId, idempotencyKey, priority } = req.body || {}
    if (!type) return res.status(400).json({ success: false, error: 'type is required' })

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

    const { status, type, agentId, page, pageSize } = req.query

    const organizationId =
      req.user.role !== UserRole.SUPER_ADMIN &&
      req.user.organizationId &&
      mongoose.Types.ObjectId.isValid(req.user.organizationId)
        ? new mongoose.Types.ObjectId(req.user.organizationId)
        : undefined

    const data = await listAutomationJobs({
      organizationId,
      status: status as string,
      type: type as string,
      agentId: agentId as string,
      page: Number(page || 1),
      pageSize: Number(pageSize || 20),
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
    if (req.user.role !== UserRole.SUPER_ADMIN && req.user.organizationId) {
      if (String(doc.organizationId || '') !== String(req.user.organizationId)) {
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

    if (req.user.role !== UserRole.SUPER_ADMIN && req.user.organizationId) {
      if (String(doc.organizationId || '') !== String(req.user.organizationId)) {
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

    if (req.user.role !== UserRole.SUPER_ADMIN && req.user.organizationId) {
      if (String(doc.organizationId || '') !== String(req.user.organizationId)) {
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

