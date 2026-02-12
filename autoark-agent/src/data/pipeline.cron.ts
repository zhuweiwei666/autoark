import cron from 'node-cron'
import { log } from '../platform/logger'
import { think } from '../agent/brain'
import { runEvolution } from '../agent/evolution'

export function initPipelineCron() {
  // 每 10 分钟感知+判断（轻量级，只在有事件时才触发完整决策）
  cron.schedule('*/10 * * * *', async () => {
    try {
      await think('cron')
    } catch (err: any) {
      log.error('[BrainCron] Failed:', err.message)
    }
  })

  // 启动 2 分钟后跑一次
  setTimeout(async () => {
    try {
      log.info('[BrainCron] Initial run...')
      await think('cron')
    } catch (err: any) {
      log.error('[BrainCron] Initial run failed:', err.message)
    }
  }, 120000)

  // 每周一早 9 点运行进化分析
  cron.schedule('0 9 * * 1', async () => {
    try {
      log.info('[EvolutionCron] Running weekly evolution...')
      await runEvolution()
    } catch (err: any) {
      log.error('[EvolutionCron] Failed:', err.message)
    }
  })

  log.info('[BrainCron] Initialized (brain: 10min, evolution: weekly)')
}
