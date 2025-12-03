import Account from '../models/Account'
import { accountQueue, campaignQueue, adQueue } from '../queue/facebook.queue'
import logger from '../utils/logger'

// 检查队列是否可用
const isQueueAvailable = (): boolean => {
  return accountQueue !== null && campaignQueue !== null && adQueue !== null
}

/**
 * 调度器：扫描账户并推送到队列
 */
export const syncCampaignsFromAdAccountsV2 = async () => {
  if (!isQueueAvailable()) {
    throw new Error('Queue system not available. Please configure REDIS_URL environment variable.')
  }

  const startTime = Date.now()
  
  try {
    // 1. 获取所有有效的广告账户
    const accounts = await Account.find({ status: 'active' })
    logger.info(`[Scheduler] Starting sync for ${accounts.length} active ad accounts`)

    if (accounts.length === 0) {
      logger.warn('[Scheduler] No active accounts found')
      return { syncedAccounts: 0, jobsQueued: 0 }
    }

    // 2. 为每个账户推送同步任务到 accountQueue
    const jobs = []
    for (const account of accounts) {
      if (!account.token) {
        logger.warn(`[Scheduler] Account ${account.accountId} has no token, skipping`)
        continue
      }

      // 推送到 accountQueue
      const job = await accountQueue!.add(
        'sync-account',
        {
          accountId: account.accountId,
          token: account.token,
        },
        {
          priority: 1,
          jobId: `account-sync-${account.accountId}-${Date.now()}`, // 每次运行生成新 jobId
        }
      )
      jobs.push(job)
    }

    logger.info(`[Scheduler] Queued ${jobs.length} account sync jobs in ${Date.now() - startTime}ms`)
    return { syncedAccounts: accounts.length, jobsQueued: jobs.length }
  } catch (error: any) {
    logger.error('[Scheduler] Failed to queue account sync jobs:', error)
    throw error
  }
}

// 兼容旧接口
export const addAccountSyncJob = async (accountId: string, token: string) => {
  if (accountQueue) {
    await accountQueue.add('sync-account', { accountId, token })
    return true
  }
  return false
}

// 获取队列状态
export const getQueueStatus = async () => {
  if (!isQueueAvailable()) {
    return {
      available: false,
      queues: {}
    }
  }

  const [accountCounts, campaignCounts, adCounts] = await Promise.all([
    accountQueue!.getJobCounts(),
    campaignQueue!.getJobCounts(),
    adQueue!.getJobCounts(),
  ])

  return {
    available: true,
    queues: {
      account: accountCounts,
      campaign: campaignCounts,
      ad: adCounts,
    }
  }
}
