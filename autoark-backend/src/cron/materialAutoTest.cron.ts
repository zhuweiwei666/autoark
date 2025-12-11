import cron from 'node-cron'
import logger from '../utils/logger'
import { materialAutoTestService } from '../services/materialAutoTest.service'

/**
 * 🧪 素材自动测试定时任务
 * 每 10 分钟检查一次新上传的素材
 */

export function initMaterialAutoTestCron() {
  // 每 10 分钟执行一次
  cron.schedule('*/10 * * * *', async () => {
    logger.info('[MaterialAutoTestCron] Checking new materials...')
    try {
      await materialAutoTestService.checkNewMaterials()
      logger.info('[MaterialAutoTestCron] Check completed')
    } catch (error: any) {
      logger.error('[MaterialAutoTestCron] Check failed:', error.message)
    }
  })
  
  logger.info('[MaterialAutoTestCron] Material auto test cron initialized (runs every 10 minutes)')
}

export default { initMaterialAutoTestCron }
