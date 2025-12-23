import cron from 'node-cron'
import { SCHEDULES } from './schedule'
// Hourly Metrics 已废弃，由 V2 Queue-based Sync 统一处理
// import fetchFacebookMetrics from './fetchFacebookMetrics'
import { runRulesDaily } from '../rules'
import { runAiOptimizerDaily } from '../ai'
import { initMaterialMetricsCron } from './materialMetrics.cron'
import { initAggregationCron } from './aggregation.cron'
import { initRuleCron } from './rule.cron'
import { initMaterialAutoTestCron } from './materialAutoTest.cron'
import { initAiSuggestionCron } from './aiSuggestion.cron'
import { initAccountSyncCron } from './accountSync.cron'
import { initFacebookUserAssetsCron } from './facebookUserAssets.cron'
import { initAgentAutoRunCron } from './agentAutoRun.cron'
import logger from '../utils/logger'

const initCronJobs = () => {
  // [DEPRECATED] Facebook Data Sync (Hourly) - 已由 V2 Queue-based Sync 替代
  // cron.schedule(SCHEDULES.FETCH_FB_HOURLY, () => {
  //   fetchFacebookMetrics().catch((err) =>
  //     logger.error('Unhandled error in Facebook fetch cron', err),
  //   )
  // })

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

  // 📊 统一预聚合 (Every 10 minutes) - 前端页面和 AI 共用的数据源
  initAggregationCron()

  // 🤖 自动化规则引擎 (Hourly + Daily)
  initRuleCron()

  // 🧪 素材自动测试 (Every 10 minutes)
  initMaterialAutoTestCron()

  // 🤖 AI 优化建议 (Hourly)
  initAiSuggestionCron()

  // 📊 账户同步 (Hourly + Startup)
  initAccountSyncCron()

  // 👤 Facebook 用户资产缓存同步（Every 6 hours）
  initFacebookUserAssetsCron()

  // 🧠 Agent 自动运行（Planner/Executor jobs）
  initAgentAutoRunCron()

  logger.info('Cron jobs initialized')
}

export default initCronJobs
