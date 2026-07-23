import Account from '../models/Account'
import { accountQueue, campaignQueue, adQueue, materialQueue } from '../queue/facebook.queue'
import logger from '../utils/logger'
import { normalizeForStorage } from '../utils/accountId'
import {
  FACEBOOK_SYNC_DISABLED_MESSAGE,
  getFacebookSyncAccountBatchLimit,
  isFacebookSyncEnabled,
} from '../config/facebookSync'

// 检查队列是否可用
const isQueueAvailable = (): boolean => {
  return accountQueue !== null && campaignQueue !== null && adQueue !== null && materialQueue !== null
}

/**
 * 调度器：扫描账户并推送到队列
 */
export const syncCampaignsFromAdAccountsV2 = async (options?: {
  accountIds?: string[]
  limit?: number
  preventOverlap?: boolean
}) => {
  if (!isFacebookSyncEnabled()) {
    throw new Error(FACEBOOK_SYNC_DISABLED_MESSAGE)
  }

  if (!isQueueAvailable()) {
    throw new Error('Queue system not available. Please configure REDIS_URL environment variable.')
  }

  const startTime = Date.now()
  // 将 jobId 按“时间桶”去重，避免 cron/手动多次触发导致队列堆积
  const intervalMinutes = Math.max(1, parseInt(process.env.CRON_SYNC_INTERVAL || '10', 10) || 10)
  const slot = Math.floor(Date.now() / (intervalMinutes * 60 * 1000))
  
  try {
    const pipelineQueues = [
      { name: 'facebook.account.sync', queue: accountQueue! },
      { name: 'facebook.campaign.sync', queue: campaignQueue! },
      { name: 'facebook.ad.sync', queue: adQueue! },
      { name: 'facebook.material.sync', queue: materialQueue! },
    ]
    const readiness = await Promise.all(pipelineQueues.map(async ({ name, queue }) => ({
      name,
      isPaused: await queue.isPaused(),
      workers: await queue.getWorkersCount(),
    })))
    const pausedQueue = readiness.find((queue) => queue.isPaused)
    if (pausedQueue) {
      throw new Error(`${pausedQueue.name} queue is paused; refusing to enqueue account jobs`)
    }
    const queueWithoutWorkers = readiness.find((queue) => queue.workers < 1)
    if (queueWithoutWorkers) {
      throw new Error(`No live ${queueWithoutWorkers.name} workers; refusing to enqueue account jobs`)
    }

    if (options?.preventOverlap) {
      const pendingJobs: Record<string, number> = {}
      for (const { name, queue } of pipelineQueues) {
        const counts = await queue.getJobCounts('active', 'waiting', 'prioritized', 'delayed')
        const queueName = name.split('.')[1]
        pendingJobs[queueName] = (
          (counts.active || 0)
          + (counts.waiting || 0)
          + (counts.prioritized || 0)
          + (counts.delayed || 0)
        )
      }
      const totalPending = Object.values(pendingJobs).reduce((sum, count) => sum + count, 0)
      if (totalPending > 0) {
        logger.info(`[Scheduler] Skipping overlapping full sync: ${totalPending} pipeline jobs still pending`)
        return {
          syncedAccounts: 0,
          jobsQueued: 0,
          jobsSkippedPending: 0,
          skippedPipelineBusy: true,
          pendingJobs: {
            account: pendingJobs.account || 0,
            campaign: pendingJobs.campaign || 0,
            ad: pendingJobs.ad || 0,
            material: pendingJobs.material || 0,
            total: totalPending,
          },
        }
      }
    }

    const pendingAccountJobs = await accountQueue!.getJobs(
      ['active', 'waiting', 'prioritized', 'delayed'],
      0,
      9999,
    )
    const pendingAccountIds = new Set(
      pendingAccountJobs
        .map((job) => normalizeForStorage(job.data?.accountId))
        .filter(Boolean),
    )

    // 1. 获取所有有效的广告账户
    let accounts = await Account.find({ status: 'active' })
    if (options?.accountIds?.length) {
      const requested = new Set(options.accountIds.map(normalizeForStorage).filter(Boolean))
      accounts = accounts.filter((account) => requested.has(normalizeForStorage(account.accountId)))
    }
    accounts = accounts.sort((left, right) => (
      normalizeForStorage(left.accountId).localeCompare(normalizeForStorage(right.accountId))
    ))
    const totalActiveAccounts = accounts.length
    const requestedLimit = options?.limit ?? (
      options?.accountIds?.length
        ? options.accountIds.length
        : getFacebookSyncAccountBatchLimit()
    )
    const batchLimit = Math.min(100, Math.max(1, Math.floor(Number(requestedLimit) || 1)))
    if (accounts.length > batchLimit) {
      if (options?.accountIds?.length) {
        accounts = accounts.slice(0, batchLimit)
      } else {
        const offset = (slot * batchLimit) % accounts.length
        accounts = Array.from(
          { length: batchLimit },
          (_, index) => accounts[(offset + index) % accounts.length],
        )
      }
    }
    logger.info(
      `[Scheduler] Starting bounded sync for ${accounts.length}/${totalActiveAccounts} active ad accounts`,
    )

    if (accounts.length === 0) {
      logger.warn('[Scheduler] No active accounts found')
      return { syncedAccounts: 0, jobsQueued: 0 }
    }

    // 2. 为每个账户推送同步任务到 accountQueue
    const jobs = []
    let jobsSkippedPending = 0
    for (const account of accounts) {
      if (!account.token) {
        logger.warn(`[Scheduler] Account ${account.accountId} has no token, skipping`)
        continue
      }

      if (pendingAccountIds.has(normalizeForStorage(account.accountId))) {
        jobsSkippedPending += 1
        continue
      }

      // 推送到 accountQueue
      try {
        const job = await accountQueue!.add(
          'sync-account',
          {
            accountId: account.accountId,
            token: account.token,
            organizationId: account.organizationId?.toString(),
          },
          {
            priority: 1,
            // 同一账户在同一时间桶内只允许一个任务
            jobId: `account-sync-${account.accountId}-${slot}`,
          }
        )
        jobs.push(job)
      } catch (error: any) {
        // BullMQ: Duplicate jobId -> ignore to keep cron idempotent
        const msg = error?.message || String(error)
        if (msg.includes('Job') && msg.includes('already exists')) {
          logger.debug?.(`[Scheduler] Duplicate job ignored: account=${account.accountId}, slot=${slot}`)
          continue
        }
        throw error
      }
    }

    logger.info(`[Scheduler] Queued ${jobs.length} account sync jobs in ${Date.now() - startTime}ms`)
    return {
      syncedAccounts: accounts.length,
      jobsQueued: jobs.length,
      jobsSkippedPending,
      totalActiveAccounts,
      batchLimit,
    }
  } catch (error: any) {
    logger.error('[Scheduler] Failed to queue account sync jobs:', error)
    throw error
  }
}

// 兼容旧接口
export const addAccountSyncJob = async (accountId: string, token: string) => {
  if (!isFacebookSyncEnabled()) {
    return false
  }
  if (accountQueue) {
    await accountQueue.add('sync-account', { accountId, token })
    return true
  }
  return false
}

const RECOVERY_CONFIRMATION = 'RECOVER_FACEBOOK_ACCOUNT_QUEUE'
const RECOVERY_STATES = ['prioritized', 'waiting', 'delayed', 'failed'] as const
const RETRY_CONFIRMATION = 'RETRY_FACEBOOK_QUEUE_FAILURES'
const RETRYABLE_QUEUE_NAMES = ['account', 'campaign', 'ad', 'material'] as const

type RetryableFacebookQueueName = typeof RETRYABLE_QUEUE_NAMES[number]

export const recoverFacebookAccountQueue = async (options?: {
  dryRun?: boolean
  confirmation?: string
  maxJobs?: number
}) => {
  if (!accountQueue) throw new Error('Queue system not available')

  const dryRun = options?.dryRun !== false
  if (!dryRun && !isFacebookSyncEnabled()) {
    throw new Error(FACEBOOK_SYNC_DISABLED_MESSAGE)
  }
  if (!dryRun && options?.confirmation !== RECOVERY_CONFIRMATION) {
    throw new Error(`Queue recovery requires confirmation: ${RECOVERY_CONFIRMATION}`)
  }

  const requestedMax = Number(options?.maxJobs || 10000)
  const maxJobs = Math.min(10000, Math.max(1, Number.isFinite(requestedMax) ? Math.floor(requestedMax) : 10000))
  const jobsByState: Record<string, any[]> = {}
  let remaining = maxJobs

  for (const state of RECOVERY_STATES) {
    if (remaining <= 0) {
      jobsByState[state] = []
      continue
    }
    const jobs = await accountQueue.getJobs(state, 0, remaining - 1, true)
    jobsByState[state] = jobs
    remaining -= jobs.length
  }

  const candidates = RECOVERY_STATES.reduce((sum, state) => sum + jobsByState[state].length, 0)
  let removed = 0

  if (!dryRun) {
    const jobs = RECOVERY_STATES.flatMap((state) => jobsByState[state])
    for (let start = 0; start < jobs.length; start += 50) {
      const batch = jobs.slice(start, start + 50)
      await Promise.all(batch.map(async (job) => {
        await job.remove()
        removed += 1
      }))
    }
    await Promise.all([
      accountQueue.resume(),
      campaignQueue!.resume(),
      adQueue!.resume(),
      materialQueue!.resume(),
    ])
  }

  return {
    dryRun,
    maxJobs,
    candidates,
    byState: Object.fromEntries(
      RECOVERY_STATES.map((state) => [state, jobsByState[state].length]),
    ),
    removed,
    resumed: !dryRun,
    resumedQueues: dryRun ? [] : [
      'facebook.account.sync',
      'facebook.campaign.sync',
      'facebook.ad.sync',
      'facebook.material.sync',
    ],
    truncated: candidates >= maxJobs,
  }
}

export const retryFacebookQueueFailures = async (options: {
  queue: RetryableFacebookQueueName
  dryRun?: boolean
  confirmation?: string
  maxJobs?: number
}) => {
  const queueName = options?.queue
  if (!RETRYABLE_QUEUE_NAMES.includes(queueName)) {
    throw new Error(`Unsupported Facebook queue: ${String(queueName || '')}`)
  }

  const queues = {
    account: accountQueue,
    campaign: campaignQueue,
    ad: adQueue,
    material: materialQueue,
  }
  const queue = queues[queueName]
  if (!queue) throw new Error('Queue system not available')

  const dryRun = options?.dryRun !== false
  if (!dryRun && !isFacebookSyncEnabled()) {
    throw new Error(FACEBOOK_SYNC_DISABLED_MESSAGE)
  }
  if (!dryRun && options?.confirmation !== RETRY_CONFIRMATION) {
    throw new Error(`Queue retry requires confirmation: ${RETRY_CONFIRMATION}`)
  }

  const requestedMax = Number(options?.maxJobs || 1000)
  const maxJobs = Math.min(10000, Math.max(1, Number.isFinite(requestedMax) ? Math.floor(requestedMax) : 1000))
  const jobs = await queue.getJobs('failed', 0, maxJobs - 1, true)
  let retried = 0

  if (!dryRun) {
    for (let start = 0; start < jobs.length; start += 50) {
      const batch = jobs.slice(start, start + 50)
      await Promise.all(batch.map(async (job) => {
        await job.retry('failed')
        retried += 1
      }))
    }
  }

  return {
    queue: queueName,
    dryRun,
    maxJobs,
    candidates: jobs.length,
    retried,
    truncated: jobs.length >= maxJobs,
  }
}

const getDetailedQueueStatus = async (queue: NonNullable<typeof accountQueue>) => {
  const [counts, workers, isPaused, failedJobs] = await Promise.all([
    queue.getJobCounts(),
    queue.getWorkersCount(),
    queue.isPaused(),
    queue.getJobs('failed', 0, 4, false),
  ])

  return {
    ...counts,
    workers,
    isPaused,
    failedSamples: failedJobs.map((job: any) => ({
      id: job.id,
      name: job.name,
      attemptsMade: job.attemptsMade,
      failedReason: String(job.failedReason || '').slice(0, 500),
      timestamp: job.timestamp,
      finishedOn: job.finishedOn,
    })),
  }
}

// 获取队列状态
export const getQueueStatus = async () => {
  if (!isQueueAvailable()) {
    return {
      available: false,
      queues: {}
    }
  }

  const [accountStatus, campaignStatus, adStatus, materialStatus] = await Promise.all([
    getDetailedQueueStatus(accountQueue!),
    getDetailedQueueStatus(campaignQueue!),
    getDetailedQueueStatus(adQueue!),
    getDetailedQueueStatus(materialQueue!),
  ])

  return {
    available: true,
    queues: {
      account: accountStatus,
      campaign: campaignStatus,
      ad: adStatus,
      material: materialStatus,
    }
  }
}
