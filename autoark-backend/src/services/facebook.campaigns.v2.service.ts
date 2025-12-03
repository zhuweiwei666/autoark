import Account from '../models/Account'
import { accountSyncQueue, adFetchQueue, insightsQueue } from '../queue/facebook.queue'
import logger from '../utils/logger'

// 检查队列是否可用
const isQueueAvailable = (): boolean => {
  return accountSyncQueue !== null && adFetchQueue !== null && insightsQueue !== null
}

/**
 * 新版本的广告系列同步服务
 * 使用 BullMQ 队列 + 并发 Worker 实现高性能抓取
 */
export const syncCampaignsFromAdAccountsV2 = async () => {
  if (!isQueueAvailable()) {
    throw new Error('Queue system not available. Please configure REDIS_URL environment variable.')
  }

  const startTime = Date.now()
  
  try {
    // 1. 获取所有有效的广告账户
    const accounts = await Account.find({ status: 'active' })
    logger.info(`[Sync V2] Starting campaign sync for ${accounts.length} active ad accounts`)

    if (accounts.length === 0) {
      logger.warn('[Sync V2] No active accounts found')
      return { syncedAccounts: 0, jobsQueued: 0 }
    }

    // 2. 为每个账户推送同步任务到队列
    const jobs = []
    for (const account of accounts) {
      if (!account.token) {
        logger.warn(`[Sync V2] Account ${account.accountId} has no token, skipping`)
        continue
      }

      const job = await accountSyncQueue!.add(
        'sync-account',
        {
          accountId: account.accountId,
          token: account.token,
        },
        {
          priority: 1,
          jobId: `account-sync-${account.accountId}`, // 避免重复任务
        }
      )
      jobs.push(job)
    }

    logger.info(`[Sync V2] Queued ${jobs.length} account sync jobs. Duration: ${Date.now() - startTime}ms`)
    return { syncedAccounts: accounts.length, jobsQueued: jobs.length }
  } catch (error: any) {
    logger.error('[Sync V2] Failed to queue account sync jobs:', error)
    throw error
  }
}

/**
 * 获取队列状态
 */
export const getQueueStatus = async () => {
  if (!isQueueAvailable()) {
    return {
      accountSync: { waiting: 0, active: 0, completed: 0, failed: 0, error: 'Queue system not available' },
      adFetch: { waiting: 0, active: 0, completed: 0, failed: 0, error: 'Queue system not available' },
      insights: { waiting: 0, active: 0, completed: 0, failed: 0, error: 'Queue system not available' },
    }
  }

  const [accountSyncWaiting, accountSyncActive, accountSyncCompleted, accountSyncFailed] = await Promise.all([
    accountSyncQueue!.getWaitingCount(),
    accountSyncQueue!.getActiveCount(),
    accountSyncQueue!.getCompletedCount(),
    accountSyncQueue!.getFailedCount(),
  ])

  const [adFetchWaiting, adFetchActive, adFetchCompleted, adFetchFailed] = await Promise.all([
    adFetchQueue!.getWaitingCount(),
    adFetchQueue!.getActiveCount(),
    adFetchQueue!.getCompletedCount(),
    adFetchQueue!.getFailedCount(),
  ])

  const [insightsWaiting, insightsActive, insightsCompleted, insightsFailed] = await Promise.all([
    insightsQueue!.getWaitingCount(),
    insightsQueue!.getActiveCount(),
    insightsQueue!.getCompletedCount(),
    insightsQueue!.getFailedCount(),
  ])

  return {
    accountSync: {
      waiting: accountSyncWaiting,
      active: accountSyncActive,
      completed: accountSyncCompleted,
      failed: accountSyncFailed,
    },
    adFetch: {
      waiting: adFetchWaiting,
      active: adFetchActive,
      completed: adFetchCompleted,
      failed: adFetchFailed,
    },
    insights: {
      waiting: insightsWaiting,
      active: insightsActive,
      completed: insightsCompleted,
      failed: insightsFailed,
    },
  }
}

