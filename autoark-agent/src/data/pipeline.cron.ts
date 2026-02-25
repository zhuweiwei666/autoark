import cron from 'node-cron'
import { log } from '../platform/logger'
import { think } from '../agent/brain'
import { runEvolution } from '../agent/evolution'
import { runAudit } from '../agent/auditor'
import { dailySummary, weeklyEvolution, decayKnowledge, manageSkillLifecycle } from '../agent/librarian'

export function initPipelineCron() {
  // Brain cycle: 每 30 分钟
  cron.schedule('*/30 * * * *', async () => {
    try {
      await think('cron')
    } catch (err: any) {
      log.error('[BrainCron] Failed:', err.message)
    }
  })

  // 启动 2 分钟后跑一次 Brain
  setTimeout(async () => {
    try {
      log.info('[BrainCron] Initial run...')
      await think('cron')
    } catch (err: any) {
      log.error('[BrainCron] Initial run failed:', err.message)
    }
  }, 120000)

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
      const summary = await dailySummary()
      try {
        const { notifyFeishuDailyReport } = await import('../platform/feishu/feishu.service')
        await notifyFeishuDailyReport(summary)
      } catch { /* feishu optional */ }
    } catch (err: any) {
      log.error('[LibrarianCron] Daily summary failed:', err.message)
    }
  })

  // Librarian 每周进化 + 旧版 Evolution: 每周一 UTC 1:00 (北京 9:00)
  cron.schedule('0 1 * * 1', async () => {
    try {
      log.info('[EvolutionCron] Running weekly evolution...')
      await weeklyEvolution()
      await runEvolution()
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

  log.info('[Cron] Initialized: brain(30min), auditor(2h), librarian-daily(22:00 CST), evolution(weekly Mon 9:00 CST)')
}
