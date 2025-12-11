import cron from 'node-cron'
import { SCHEDULES } from './schedule'
import fetchFacebookMetrics from './fetchFacebookMetrics'
import { runRulesDaily } from '../rules'
import { runAiOptimizerDaily } from '../ai'
import { initMaterialMetricsCron } from './materialMetrics.cron'
import { initSummaryAggregationCron } from './summaryAggregation.cron'
import { initAggregationCron } from './aggregation.cron'
import { initRuleCron } from './rule.cron'
import { initMaterialAutoTestCron } from './materialAutoTest.cron'
import { initAiSuggestionCron } from './aiSuggestion.cron'
import { initAccountSyncCron } from './accountSync.cron'
import logger from '../utils/logger'

const initCronJobs = () => {
  // Facebook Data Sync (Hourly)
  cron.schedule(SCHEDULES.FETCH_FB_HOURLY, () => {
    fetchFacebookMetrics().catch((err) =>
      logger.error('Unhandled error in Facebook fetch cron', err),
    )
  })

  // Rule Engine (Daily at 1 AM)
  cron.schedule('0 1 * * *', () => {
    runRulesDaily().catch((err) =>
      logger.error('Unhandled error in Rule Engine cron', err),
    )
  })

  // AI Optimizer (Daily at 3 AM)
  cron.schedule('0 3 * * *', () => {
    runAiOptimizerDaily().catch((err) =>
      logger.error('Unhandled error in AI Optimizer cron', err),
    )
  })

  // Material Metrics Aggregation (Daily at 4 AM)
  initMaterialMetricsCron()

  // Summary Aggregation (Every 10 minutes) - 加速前端页面加载
  initSummaryAggregationCron()

  // 统一预聚合 (Every 10 minutes) - 前端和 AI 共用的数据源
  initAggregationCron()

  // 🤖 自动化规则引擎 (Hourly + Daily)
  initRuleCron()

  // 🧪 素材自动测试 (Every 10 minutes)
  initMaterialAutoTestCron()

  // 🤖 AI 优化建议 (Hourly)
  initAiSuggestionCron()

  // 📊 账户同步 (Hourly + Startup)
  initAccountSyncCron()

  logger.info('Cron jobs initialized')
}

export default initCronJobs
