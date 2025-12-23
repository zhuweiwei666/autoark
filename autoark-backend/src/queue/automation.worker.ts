import { Worker, Job, WorkerOptions } from 'bullmq'
import { getRedisClient } from '../config/redis'
import logger from '../utils/logger'
import AutomationJob from '../models/AutomationJob'
import FbToken from '../models/FbToken'

let automationWorker: Worker | null = null

const createWorkerOptions = (concurrency: number): WorkerOptions => {
  const client = getRedisClient()
  if (!client) throw new Error('Redis not configured')
  const connection = client.duplicate()
  // BullMQ required
  connection.options.maxRetriesPerRequest = null
  return {
    connection,
    concurrency,
    limiter: { max: 50, duration: 60000 },
  }
}

export const initAutomationWorker = () => {
  const client = getRedisClient()
  if (!client) {
    logger.warn('[AutomationWorker] Worker not initialized (Redis not configured)')
    return
  }

  automationWorker = new Worker(
    'automation.jobs',
    async (job: Job) => {
      const { automationJobId } = job.data as { automationJobId: string }
      const doc: any = await AutomationJob.findById(automationJobId)
      if (!doc) throw new Error('AutomationJob not found')

      // 幂等：已完成则直接返回
      if (doc.status === 'completed') {
        return { skipped: true, reason: 'already_completed' }
      }
      if (doc.status === 'cancelled') {
        return { skipped: true, reason: 'cancelled' }
      }

      doc.status = 'running'
      doc.startedAt = doc.startedAt || new Date()
      doc.attempts = Number(doc.attempts || 0) + 1
      await doc.save()

      try {
        let result: any
        const payload = doc.payload || {}

        // 使用动态导入打破循环依赖
        const { agentService } = await import('../domain/agent/agent.service')
        const bulkAdService = (await import('../services/bulkAd.service')).default
        const fbSyncService = await import('../services/facebook.sync.service')
        const { syncFacebookUserAssets } = await import('../services/facebookUser.service')

        switch (doc.type) {
          case 'RUN_AGENT': {
            if (!payload.agentId && !doc.agentId) throw new Error('agentId is required')
            const agentId = String(payload.agentId || doc.agentId)
            result = await agentService.runAgent(agentId)
            break
          }
          case 'RUN_AGENT_AS_JOBS': {
            if (!payload.agentId && !doc.agentId) throw new Error('agentId is required')
            const agentId = String(payload.agentId || doc.agentId)
            result = await (agentService as any).runAgentAsJobs(agentId)
            break
          }
          case 'EXECUTE_AGENT_OPERATION': {
            const operationId = String(payload.operationId || '')
            if (!operationId) throw new Error('operationId is required')
            // 可选：传递 agentId 用于 token scope
            const agentId = payload.agentId ? String(payload.agentId) : undefined
            const agent = agentId ? await (require('../domain/agent/agent.model').AgentConfig).findById(agentId) : undefined
            result = await (agent ? (agentService as any).executeOperation(operationId, agent) : agentService.executeOperation(operationId))
            break
          }
          case 'PUBLISH_DRAFT': {
            const draftId = String(payload.draftId || '')
            if (!draftId) throw new Error('draftId is required')
            result = await bulkAdService.publishDraft(draftId)
            break
          }
          case 'RUN_FB_FULL_SYNC': {
            // 注意：runFullSync 内部已包含日志与错误处理
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

        return { success: true, result }
      } catch (e: any) {
        doc.status = 'failed'
        doc.lastError = e?.message || String(e)
        doc.finishedAt = new Date()
        await doc.save()
        throw e
      }
    },
    createWorkerOptions(5),
  )

  automationWorker.on('failed', (job, err) => {
    logger.error(`[AutomationWorker] Job ${job?.id} failed:`, err)
  })
  automationWorker.on('error', (err) => {
    logger.error('[AutomationWorker] Worker error:', err)
  })

  logger.info('[AutomationWorker] Worker initialized')
}

export default automationWorker

