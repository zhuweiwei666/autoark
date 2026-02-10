import cron from 'node-cron'
import dayjs from 'dayjs'
import logger from '../utils/logger'
import { AgentConfig } from '../domain/agent/agent.model'
import { createAutomationJob } from '../services/automationJob.service'
// Agent V2: LLM-powered optimization pipeline
import { runOptimizationPipeline } from '../agent'

// Feature flag: set to 'v2' to use the new LLM-powered agent, 'v1' for legacy
const AGENT_VERSION = process.env.AGENT_VERSION || 'v1'

/**
 * Agent 自动运行调度器
 * - 负责按 AgentConfig.schedule.checkInterval 触发 Planner/Executor
 * - V1: 通过 AutomationJob 队列运行旧版 rule-based agent
 * - V2: 直接运行新版 LLM-powered optimization pipeline
 * - 通过幂等 key 避免同一时间窗重复入队
 */
export const initAgentAutoRunCron = () => {
  // Every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      const now = dayjs()
      const agents: any[] = await AgentConfig.find({
        status: 'active',
        mode: 'auto',
      }).lean()

      if (!agents.length) return

      for (const agent of agents) {
        const checkIntervalMin = Math.max(5, Number(agent.schedule?.checkInterval || 30))
        const lastRunAt = agent.runtime?.lastRunAt ? dayjs(agent.runtime.lastRunAt) : null
        if (lastRunAt && now.diff(lastRunAt, 'minute') < checkIntervalMin) {
          continue
        }

        // Active hours 护栏（使用服务器时区；如需严格时区可后续接入 dayjs-timezone）
        const hour = now.hour()
        const start = Number(agent.schedule?.activeHours?.start ?? 0)
        const end = Number(agent.schedule?.activeHours?.end ?? 24)
        if (!(hour >= start && hour < end)) {
          continue
        }

        // 以 5 分钟 bucket 做幂等，避免重复入队
        const bucket = now.startOf('minute').minute(Math.floor(now.minute() / 5) * 5)
        const idempotencyKey = `agent:${agent._id.toString()}:${bucket.format('YYYYMMDDHHmm')}`

        if (AGENT_VERSION === 'v2') {
          // V2: Run LLM-powered optimization pipeline directly
          logger.info(`[AgentAutoRunCron] Running V2 pipeline for agent: ${agent.name}`)
          runOptimizationPipeline({
            agentConfig: {
              id: agent._id.toString(),
              name: agent.name,
              description: agent.description,
              organizationId: agent.organizationId?.toString(),
              role: 'orchestrator',
              mode: agent.mode || 'auto',
              status: agent.status || 'active',
              permissions: {
                canPublishAds: agent.permissions?.canPublishAds ?? false,
                canToggleStatus: agent.permissions?.canToggleStatus ?? true,
                canAdjustBudget: agent.permissions?.canAdjustBudget ?? true,
                canAdjustBid: agent.permissions?.canAdjustBid ?? false,
                canPause: agent.permissions?.canPause ?? true,
                canResume: agent.permissions?.canResume ?? true,
                canCreateCampaigns: agent.permissions?.canPublishAds ?? false,
                canModifyTargeting: agent.permissions?.canPublishAds ?? false,
                canModifyCreatives: agent.permissions?.canPublishAds ?? false,
              },
              scope: {
                adAccountIds: agent.scope?.adAccountIds || agent.accountIds || [],
                fbTokenIds: (agent.scope?.fbTokenIds || []).map((id: any) => id.toString()),
                tiktokTokenIds: (agent.scope?.tiktokTokenIds || []).map((id: any) => id.toString()),
                facebookAppIds: (agent.scope?.facebookAppIds || []).map((id: any) => id.toString()),
              },
              objectives: {
                targetRoas: agent.objectives?.targetRoas,
                maxCpa: agent.objectives?.maxCpa,
                dailyBudgetLimit: agent.objectives?.dailyBudgetLimit,
                monthlyBudgetLimit: agent.objectives?.monthlyBudgetLimit,
              },
              maxIterations: 25,
              temperature: 0.2,
            },
            organizationId: agent.organizationId?.toString(),
          }).then((result) => {
            logger.info(`[AgentAutoRunCron] V2 pipeline completed for ${agent.name}: ${result.overallStatus}`)
            // Update lastRunAt
            AgentConfig.updateOne(
              { _id: agent._id },
              { $set: { 'runtime.lastRunAt': new Date() } }
            ).catch(() => {})
          }).catch((err) => {
            logger.error(`[AgentAutoRunCron] V2 pipeline failed for ${agent.name}:`, err.message)
          })
        } else {
          // V1: Legacy queue-based agent
          await createAutomationJob({
            type: 'RUN_AGENT_AS_JOBS',
            payload: { agentId: agent._id.toString() },
            agentId: agent._id.toString(),
            organizationId: agent.organizationId,
            createdBy: agent.createdBy,
            idempotencyKey,
            priority: 10,
          })
        }
      }
    } catch (e: any) {
      logger.error('[AgentAutoRunCron] Unhandled error:', e?.message || e)
    }
  })

  logger.info(`[AgentAutoRunCron] Initialized (every 5 minutes, version: ${AGENT_VERSION})`)
}

