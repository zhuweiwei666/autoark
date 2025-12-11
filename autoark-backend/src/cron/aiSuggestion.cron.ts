import cron from 'node-cron'
import logger from '../utils/logger'
import { aiSuggestionService } from '../services/aiSuggestion.service'

/**
 * 🤖 AI 建议定时任务
 * 
 * - 每小时生成新的优化建议
 * - 每天清理过期建议
 */

export function initAiSuggestionCron() {
  // 每小时整点生成建议
  cron.schedule('0 * * * *', async () => {
    logger.info('[AiSuggestionCron] Generating suggestions...')
    try {
      const suggestions = await aiSuggestionService.generateSuggestions()
      logger.info(`[AiSuggestionCron] Generated ${suggestions.length} suggestions`)
    } catch (error: any) {
      logger.error('[AiSuggestionCron] Generate failed:', error.message)
    }
  })
  
  // 每天凌晨 2 点清理过期建议
  cron.schedule('0 2 * * *', async () => {
    logger.info('[AiSuggestionCron] Cleaning up expired suggestions...')
    try {
      const count = await aiSuggestionService.cleanupExpired()
      logger.info(`[AiSuggestionCron] Cleaned up ${count} expired suggestions`)
    } catch (error: any) {
      logger.error('[AiSuggestionCron] Cleanup failed:', error.message)
    }
  }, {
    timezone: 'Asia/Shanghai'
  })
  
  logger.info('[AiSuggestionCron] AI suggestion cron initialized (hourly generation, daily cleanup)')
}

export default { initAiSuggestionCron }
