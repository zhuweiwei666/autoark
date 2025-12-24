import cron from 'node-cron'
import { initAggregationCron } from './aggregation.cron'
import { initAccountSyncCron } from './accountSync.cron'
import { initFacebookUserAssetsCron } from './facebookUserAssets.cron'
import { initAgentAutoRunCron } from './agentAutoRun.cron'
import { initTiktokSyncCron } from './tiktokSync.cron'
import logger from '../utils/logger'

const initCronJobs = () => {
  // 📊 统一预聚合 (Every 10 minutes) - 前端页面和 AI 共用的数据源
  initAggregationCron()

  // 📊 账户同步 (Hourly + Startup)
  initAccountSyncCron()

  // 👤 Facebook 用户资产缓存同步（Every 6 hours）
  initFacebookUserAssetsCron()

  // 🧠 Agent 自动运行（Planner/Executor jobs）
  initAgentAutoRunCron()

  // 📊 TikTok 资产同步 (Hourly + Startup)
  initTiktokSyncCron()

  logger.info('Cron jobs initialized')
}

export default initCronJobs
