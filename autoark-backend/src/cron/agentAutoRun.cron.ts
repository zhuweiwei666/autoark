import cron from 'node-cron'
import dayjs from 'dayjs'
import logger from '../utils/logger'
import { AgentConfig } from '../domain/agent/agent.model'
import { createAutomationJob } from '../services/automationJob.service'

/**
 * Agent 自动运行调度器
 * - 负责按 AgentConfig.schedule.checkInterval 触发 Planner/Executor（runAgentAsJobs）
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
    } catch (e: any) {
      logger.error('[AgentAutoRunCron] Unhandled error:', e?.message || e)
    }
  })

  logger.info('[AgentAutoRunCron] Initialized (every 5 minutes)')
}

