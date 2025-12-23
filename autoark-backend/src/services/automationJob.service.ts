import crypto from 'crypto'
import logger from '../utils/logger'
import AutomationJob from '../models/AutomationJob'
import { addAutomationJob } from '../queue/automation.queue'
import { agentService } from '../domain/agent/agent.service'
import bulkAdService from './bulkAd.service'
import * as fbSyncService from './facebook.sync.service'
import { syncFacebookUserAssets } from './facebookUser.service'
import FbToken from '../models/FbToken'

export const buildIdempotencyKey = (type: string, payload: any, agentId?: string) => {
  const raw = JSON.stringify({ type, agentId: agentId || null, payload: payload || {} })
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 40)
}

export async function createAutomationJob(input: {
  type: string
  payload?: any
  agentId?: string
  organizationId?: any
  createdBy?: string
  idempotencyKey?: string
  priority?: number
}) {
  const idempotencyKey =
    input.idempotencyKey || buildIdempotencyKey(input.type, input.payload, input.agentId)

  // 幂等创建：如果已存在则直接返回
  const doc: any = await AutomationJob.findOneAndUpdate(
    { idempotencyKey },
    {
      $setOnInsert: {
        type: input.type,
        payload: input.payload || {},
        agentId: input.agentId,
        organizationId: input.organizationId,
        createdBy: input.createdBy,
        status: 'queued',
        queuedAt: new Date(),
      },
    },
    { upsert: true, new: true },
  )

  // 如果是新建/仍可执行，尝试入队
  if (doc.status === 'queued') {
    await enqueueAutomationJob(doc._id.toString(), input.priority || 1)
  }

  return doc
}

export async function enqueueAutomationJob(automationJobId: string, priority = 1) {
  const queued = await addAutomationJob(automationJobId, priority)
  if (!queued) {
    // Redis 不可用：同步执行兜底（避免“创建了 job 但永远不跑”）
    logger.warn('[AutomationJob] Queue unavailable, executing inline fallback')
    await executeAutomationJobInline(automationJobId)
  }
  return queued
}

export async function executeAutomationJobInline(automationJobId: string) {
  const doc: any = await AutomationJob.findById(automationJobId)
  if (!doc) throw new Error('AutomationJob not found')
  if (doc.status === 'completed') return doc
  if (doc.status === 'cancelled') return doc

  doc.status = 'running'
  doc.startedAt = doc.startedAt || new Date()
  doc.attempts = Number(doc.attempts || 0) + 1
  await doc.save()

  try {
    const payload = doc.payload || {}
    let result: any

    switch (doc.type) {
      case 'RUN_AGENT': {
        const agentId = String(payload.agentId || doc.agentId || '')
        if (!agentId) throw new Error('agentId is required')
        result = await agentService.runAgent(agentId)
        break
      }
      case 'RUN_AGENT_AS_JOBS': {
        const agentId = String(payload.agentId || doc.agentId || '')
        if (!agentId) throw new Error('agentId is required')
        result = await (agentService as any).runAgentAsJobs(agentId)
        break
      }
      case 'EXECUTE_AGENT_OPERATION': {
        const operationId = String(payload.operationId || '')
        if (!operationId) throw new Error('operationId is required')
        result = await agentService.executeOperation(operationId)
        break
      }
      case 'PUBLISH_DRAFT': {
        const draftId = String(payload.draftId || '')
        if (!draftId) throw new Error('draftId is required')
        result = await bulkAdService.publishDraft(draftId)
        break
      }
      case 'RUN_FB_FULL_SYNC': {
        fbSyncService.runFullSync()
        result = { started: true }
        break
      }
      case 'SYNC_FB_USER_ASSETS': {
        const fbUserId = String(payload.fbUserId || '')
        const tokenId = payload.tokenId ? String(payload.tokenId) : undefined
        if (!fbUserId) throw new Error('fbUserId is required')

        let token: string | undefined = payload.accessToken
        if (!token && tokenId) {
          const t: any = await FbToken.findById(tokenId).lean()
          token = t?.token
        }
        if (!token) throw new Error('accessToken or tokenId is required')

        result = await syncFacebookUserAssets(fbUserId, token, tokenId)
        break
      }
      default:
        throw new Error(`Unsupported job type: ${doc.type}`)
    }

    doc.status = 'completed'
    doc.result = result
    doc.finishedAt = new Date()
    doc.lastError = undefined
    await doc.save()
    return doc
  } catch (e: any) {
    doc.status = 'failed'
    doc.lastError = e?.message || String(e)
    doc.finishedAt = new Date()
    await doc.save()
    throw e
  }
}

export async function listAutomationJobs(query: {
  organizationId?: any
  agentId?: string
  status?: string
  type?: string
  page?: number
  pageSize?: number
}) {
  const page = Math.max(1, Number(query.page || 1))
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize || 20)))

  const filter: any = {}
  if (query.organizationId) filter.organizationId = query.organizationId
  if (query.agentId) filter.agentId = query.agentId
  if (query.status) filter.status = query.status
  if (query.type) filter.type = query.type

  const [list, total] = await Promise.all([
    AutomationJob.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize),
    AutomationJob.countDocuments(filter),
  ])

  return { list, total, page, pageSize }
}

export async function cancelAutomationJob(id: string) {
  const doc: any = await AutomationJob.findById(id)
  if (!doc) throw new Error('AutomationJob not found')
  if (doc.status === 'completed') return doc
  doc.status = 'cancelled'
  doc.finishedAt = new Date()
  await doc.save()
  return doc
}

export async function retryAutomationJob(id: string) {
  const doc: any = await AutomationJob.findById(id)
  if (!doc) throw new Error('AutomationJob not found')
  if (doc.status !== 'failed') return doc

  doc.status = 'queued'
  doc.lastError = undefined
  doc.finishedAt = undefined
  await doc.save()

  await enqueueAutomationJob(id, 1)
  return doc
}

