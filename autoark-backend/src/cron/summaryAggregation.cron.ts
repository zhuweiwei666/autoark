import cron from 'node-cron'
import dayjs from 'dayjs'
import logger from '../utils/logger'
import { refreshAllSummaries } from '../services/summaryAggregation.service'

let isRefreshing = false

/**
 * 初始化汇总数据定时刷新任务
 * 每 10 分钟刷新一次当天的汇总数据
 */
export function initSummaryAggregationCron() {
  // 每 10 分钟执行一次
  cron.schedule('*/10 * * * *', async () => {
    if (isRefreshing) {
      logger.info('[SummaryCron] Previous refresh still running, skipping...')
      return
    }
    
    isRefreshing = true
    const date = dayjs().format('YYYY-MM-DD')
    
    logger.info(`[SummaryCron] Starting scheduled summary refresh for ${date}`)
    
    try {
      const result = await refreshAllSummaries(date)
      logger.info(`[SummaryCron] Scheduled refresh completed in ${result.duration}ms`)
    } catch (error) {
      logger.error('[SummaryCron] Scheduled refresh failed:', error)
    } finally {
      isRefreshing = false
    }
  })
  
  logger.info('[SummaryCron] Summary aggregation cron initialized (runs every 10 minutes)')
  
  // 启动时立即执行一次
  setTimeout(async () => {
    if (!isRefreshing) {
      isRefreshing = true
      const date = dayjs().format('YYYY-MM-DD')
      logger.info(`[SummaryCron] Initial summary refresh for ${date}`)
      try {
        await refreshAllSummaries(date)
      } catch (error) {
        logger.error('[SummaryCron] Initial refresh failed:', error)
      } finally {
        isRefreshing = false
      }
    }
  }, 5000) // 启动后 5 秒执行
}

