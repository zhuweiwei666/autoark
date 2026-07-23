const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])

const boundedInteger = (
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)))
}

export const FACEBOOK_SYNC_DISABLED_MESSAGE =
  'Facebook sync is disabled by FACEBOOK_SYNC_ENABLED'

export const FACEBOOK_INSIGHTS_DATE_PRESETS = [
  'today',
  'yesterday',
  'last_7d',
] as const

export type FacebookWorkerKind = 'account' | 'campaign' | 'ad' | 'material'

const WORKER_DEFAULTS: Record<FacebookWorkerKind, number> = {
  account: 2,
  campaign: 4,
  ad: 4,
  material: 1,
}

const WORKER_MAXIMUMS: Record<FacebookWorkerKind, number> = {
  account: 5,
  campaign: 10,
  ad: 10,
  material: 2,
}

const WORKER_ENV_KEYS: Record<FacebookWorkerKind, string> = {
  account: 'FACEBOOK_ACCOUNT_SYNC_CONCURRENCY',
  campaign: 'FACEBOOK_CAMPAIGN_SYNC_CONCURRENCY',
  ad: 'FACEBOOK_AD_SYNC_CONCURRENCY',
  material: 'FACEBOOK_MATERIAL_SYNC_CONCURRENCY',
}

export const isFacebookSyncEnabled = (): boolean => {
  const configured = process.env.FACEBOOK_SYNC_ENABLED?.trim().toLowerCase()
  if (!configured) {
    return process.env.NODE_ENV !== 'production'
  }
  return TRUE_VALUES.has(configured)
}

export const getFacebookSyncAccountBatchLimit = (): number => {
  return boundedInteger(
    process.env.FACEBOOK_SYNC_ACCOUNT_BATCH_LIMIT,
    25,
    1,
    100,
  )
}

export const getFacebookWorkerConcurrency = (
  worker: FacebookWorkerKind,
): number => {
  return boundedInteger(
    process.env[WORKER_ENV_KEYS[worker]],
    WORKER_DEFAULTS[worker],
    1,
    WORKER_MAXIMUMS[worker],
  )
}

export const getFacebookQueueRateLimitPerMinute = (): number => {
  return boundedInteger(
    process.env.FACEBOOK_QUEUE_RATE_LIMIT_PER_MINUTE,
    30,
    1,
    80,
  )
}
