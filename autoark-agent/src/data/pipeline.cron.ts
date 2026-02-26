import cron from 'node-cron'
import { log } from '../platform/logger'
import { runAutoPilot } from '../agent/auto-pilot'
import { runAudit } from '../agent/auditor'
import { dailySummary, weeklyEvolution, decayKnowledge, manageSkillLifecycle } from '../agent/librarian'

export function initPipelineCron() {
  // 5-Agent 协作循环（唯一主链路），每 10 分钟
  cron.schedule('*/10 * * * *', async () => {
    log.info('[Cron] AutoPilot cycle triggered')
    try {
      const result = await runAutoPilot()
      log.info(`[Cron] AutoPilot cycle done: ${result.campaigns} campaigns, ${result.actions.length} actions`)
    } catch (err: any) {
      log.error('[AutoPilot] Cron failed:', err.message, err.stack?.substring(0, 200))
    }
  })

  // Auditor: 每 2 小时独立审查
  cron.schedule('5 */2 * * *', async () => {
    try {
      log.info('[AuditorCron] Running audit...')
      const result = await runAudit()
      if (result.findings?.length > 0) {
        const { processAuditFindings } = await import('../agent/librarian')
        await processAuditFindings(result.findings)
      }
    } catch (err: any) {
      log.error('[AuditorCron] Failed:', err.message)
    }
  })

  // Librarian 每日总结: 每天 UTC 14:00 (北京时间 22:00)
  cron.schedule('0 14 * * *', async () => {
    try {
      log.info('[LibrarianCron] Running daily summary...')
      await dailySummary()
    } catch (err: any) {
      log.error('[LibrarianCron] Daily summary failed:', err.message)
    }
  })

  // Librarian 每周进化: 每周一 UTC 1:00 (北京 9:00)
  cron.schedule('0 1 * * 1', async () => {
    try {
      log.info('[EvolutionCron] Running weekly evolution...')
      await weeklyEvolution()
      await manageSkillLifecycle()
    } catch (err: any) {
      log.error('[EvolutionCron] Failed:', err.message)
    }
  })

  // Librarian 知识衰减: 每天 UTC 3:00
  cron.schedule('0 3 * * *', async () => {
    try {
      await decayKnowledge()
    } catch (err: any) {
      log.error('[LibrarianCron] Knowledge decay failed:', err.message)
    }
  })

  log.info('[Cron] Initialized: auto-pilot(10min), auditor(2h), librarian-daily(22:00 CST), evolution(weekly Mon 9:00 CST)')
}
