import crypto from 'crypto'
import mongoose from 'mongoose'
import logger from '../utils/logger'
import AutomationJob, {
  AUTOMATION_JOB_STATUSES,
  AUTOMATION_JOB_TYPES,
} from '../models/AutomationJob'
import { addAutomationJob } from '../queue/automation.queue'
import FbToken from '../models/FbToken'
import { combineFilters, objectIdValue, userIdVariants } from '../utils/accessControl'
import { parsePagination } from '../utils/pagination'

const buildJobAssetAccessFilter = (doc: any): any => {
  const organizationId = doc.organizationId?.toString?.() || doc.organizationId
  if (organizationId) {
    return { organizationId: objectIdValue(String(organizationId)) }
  }

  const ownerVariants = userIdVariants(doc.createdBy)
  if (ownerVariants.length > 0) {
    return { createdBy: { $in: ownerVariants } }
  }

  return { _id: null }
}

const buildJobTokenFilter = (doc: any, tokenId?: string): any => {
  const filters: any[] = [{ status: 'active' }]
  if (tokenId) filters.push({ _id: tokenId })

  const organizationId = doc.organizationId?.toString?.() || doc.organizationId
  if (organizationId) {
    filters.push({ organizationId: objectIdValue(String(organizationId)) })
  } else if (doc.createdBy) {
    filters.push({ userId: doc.createdBy })
  } else {
    filters.push({ _id: null })
  }

  return combineFilters(...filters)
}

const assertGlobalJobAllowed = (doc: any) => {
  if (doc.organizationId || doc.createdBy) {
    throw new Error('Global automation job requires internal scheduler context')
  }
}

const assertAgentJobAccess = async (doc: any, agentId: string) => {
  const organizationId = doc.organizationId?.toString?.() || doc.organizationId
  if (!organizationId && !doc.createdBy) return

  const { AgentConfig } = await import('../domain/agent/agent.model')
  const agent: any = await AgentConfig.findById(agentId).select('organizationId createdBy').lean()
  if (!agent) {
    throw new Error('Agent not found')
  }

  if (organizationId) {
    const agentOrganizationId = agent.organizationId?.toString?.() || agent.organizationId
    if (String(agentOrganizationId || '') !== String(organizationId)) {
      throw new Error('Automation job cannot access agent outside its organization')
    }
    return
  }

  if (doc.createdBy && String(agent.createdBy || '') !== String(doc.createdBy)) {
    throw new Error('Automation job cannot access agent outside its owner scope')
  }
}

const pickAllowedAutomationJobValue = (
  value: unknown,
  allowedValues: readonly string[],
): string | undefined => {
  if (typeof value !== 'string') return undefined
  return allowedValues.includes(value) ? value : undefined
}

const pickAutomationJobAgentId = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  return mongoose.Types.ObjectId.isValid(value) ? value : undefined
}

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

    // 使用动态导入打破循环依赖
    const { agentService } = await import('../domain/agent/agent.service')
    const bulkAdService = (await import('./bulkAd.service')).default
    const fbSyncService = await import('./facebook.sync.service')
    const { syncFacebookUserAssets } = await import('./facebookUser.service')

    switch (doc.type) {
      case 'RUN_AGENT': {
        const agentId = String(payload.agentId || doc.agentId || '')
        if (!agentId) throw new Error('agentId is required')
        await assertAgentJobAccess(doc, agentId)
        result = await agentService.runAgent(agentId)
        break
      }
      case 'RUN_AGENT_AS_JOBS': {
        const agentId = String(payload.agentId || doc.agentId || '')
        if (!agentId) throw new Error('agentId is required')
        await assertAgentJobAccess(doc, agentId)
        result = await (agentService as any).runAgentAsJobs(agentId)
        break
      }
      case 'EXECUTE_AGENT_OPERATION': {
        const operationId = String(payload.operationId || '')
        const agentId = String(payload.agentId || doc.agentId || '')
        if (!operationId) throw new Error('operationId is required')
        if (!agentId && (doc.organizationId || doc.createdBy)) {
          throw new Error('agentId is required for scoped operation job')
        }
        if (agentId) await assertAgentJobAccess(doc, agentId)
        result = await agentService.executeOperation(operationId)
        break
      }
      case 'PUBLISH_DRAFT': {
        const draftId = String(payload.draftId || '')
        if (!draftId) throw new Error('draftId is required')
        result = await bulkAdService.publishDraft(draftId, doc.createdBy, buildJobAssetAccessFilter(doc))
        break
      }
      case 'RUN_FB_FULL_SYNC': {
        assertGlobalJobAllowed(doc)
        fbSyncService.runFullSync()
        result = { started: true }
        break
      }
      case 'SYNC_FB_USER_ASSETS': {
        const fbUserId = String(payload.fbUserId || '')
        const tokenId = payload.tokenId ? String(payload.tokenId) : undefined
        if (!fbUserId) throw new Error('fbUserId is required')

        if (payload.accessToken) {
          throw new Error('Raw accessToken is not allowed in automation job payload')
        }
        if (!tokenId) throw new Error('tokenId is required')

        const tokenDoc: any = await FbToken.findOne(buildJobTokenFilter(doc, tokenId)).lean()
        const token = tokenDoc?.token
        const organizationId = tokenDoc?.organizationId || doc.organizationId
        if (!token) throw new Error('No accessible active Facebook token found')

        result = await syncFacebookUserAssets(fbUserId, token, tokenId, organizationId)
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
  agentId?: any
  status?: any
  type?: any
  page?: any
  pageSize?: any
}) {
  const { page, pageSize, skip } = parsePagination(query, {
    defaultPageSize: 20,
    maxPageSize: 200,
  })
  const status = pickAllowedAutomationJobValue(query.status, AUTOMATION_JOB_STATUSES)
  const type = pickAllowedAutomationJobValue(query.type, AUTOMATION_JOB_TYPES)
  const agentId = pickAutomationJobAgentId(query.agentId)

  const filter: any = {}
  if (query.organizationId) filter.organizationId = query.organizationId
  if (agentId) filter.agentId = agentId
  if (status) filter.status = status
  if (type) filter.type = type

  const [list, total] = await Promise.all([
    AutomationJob.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize),
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
