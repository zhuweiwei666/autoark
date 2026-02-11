import cron from 'node-cron'
import { log } from '../platform/logger'
import { runPipeline } from '../agent/pipeline'

export function initPipelineCron() {
  // 每小时整点运行
  cron.schedule('0 * * * *', async () => {
    try {
      log.info('[PipelineCron] Triggered')
      await runPipeline('cron')
    } catch (err: any) {
      log.error('[PipelineCron] Failed:', err.message)
    }
  })

  // 启动 2 分钟后跑一次
  setTimeout(async () => {
    try {
      log.info('[PipelineCron] Initial run...')
      await runPipeline('cron')
    } catch (err: any) {
      log.error('[PipelineCron] Initial run failed:', err.message)
    }
  }, 120000)

  log.info('[PipelineCron] Initialized (every hour)')
}
