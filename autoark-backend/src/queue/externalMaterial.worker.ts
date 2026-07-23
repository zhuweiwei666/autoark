import { randomUUID } from 'crypto'
import { Job, Worker } from 'bullmq'
import type Redis from 'ioredis'
import { getRedisClient } from '../config/redis'
import {
  fetchGuangdadaAds,
  GuangdadaApiError,
  GUANGDADA_LIMITS,
} from '../integration/guangdada/client'
import { normalizeGuangdadaAds } from '../integration/guangdada/normalize'
import type { NormalizedGuangdadaAsset } from '../integration/guangdada/types'
import ExternalMaterialSyncRun, {
  ExternalMaterialErrorCategory,
  ExternalMaterialSyncCounters,
} from '../models/ExternalMaterialSyncRun'
import ExternalMaterialSyncState, {
  ExternalMaterialProvider,
} from '../models/ExternalMaterialSyncState'
import { ingestExternalMaterial } from '../services/externalMaterialIngestion.service'
import logger from '../utils/logger'
import {
  EXTERNAL_MATERIAL_QUEUE_NAME,
  ExternalMaterialSyncRequest,
  MAX_EXTERNAL_MATERIAL_DEFERS,
  clampExternalMaterialSyncRequest,
  ensureContinuationScheduled,
  externalMaterialContinuationJobId,
} from './externalMaterial.queue'

const LOCK_TTL_DEFAULT_MS = 120_000
const LOCK_TTL_MIN_MS = 30_000
const LOCK_TTL_MAX_MS = 15 * 60_000
const LOCK_RENEW_MIN_MS = 5_000
const LOCK_RENEW_MAX_MS = 60_000
const FETCH_ATTEMPTS = 3
const INGESTION_ATTEMPTS = 3
const PROGRESS_BATCH_SIZE = 25
const RATE_LIMIT_MIN_MS = 60_000
const RATE_LIMIT_MAX_MS = GUANGDADA_LIMITS.retryAfterMs
const MAX_ERROR_SAMPLES = 5
const MAX_CONTINUATION_JOB_ID_LENGTH = 200
const MAX_CONTINUATION_GENERATION = 1_000_000
const MAX_BULL_ATTEMPT = 100
const CLAIM_LEASE_TTL_DEFAULT_MS = 120_000
const CLAIM_LEASE_TTL_MIN_MS = 30_000
const CLAIM_LEASE_TTL_MAX_MS = 15 * 60_000
const RESTORE_ATTEMPTS_DEFAULT = 2
const RESTORE_ATTEMPTS_MAX = 3
const RESTORE_TIMEOUT_DEFAULT_MS = 2_000
const RESTORE_TIMEOUT_MAX_MS = 10_000

class ContinuationSchedulingError extends Error {
  constructor(originalError: unknown) {
    super(
      originalError instanceof Error
        ? originalError.message
        : 'external_material_continuation_schedule_failed',
    )
    this.name = 'ContinuationSchedulingError'
  }
}

const RENEW_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0
`.trim()

const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`.trim()

type RedisLockClient = Pick<Redis, 'set' | 'eval'>

interface SyncRunRecord {
  provider?: ExternalMaterialProvider
  counters?: Partial<ExternalMaterialSyncCounters>
  cursor?: string | null
  deferCount?: number
  status?: string
  continuationPending?: boolean
  continuationGeneration?: number
  continuationJobId?: string | null
  continuationDueAt?: Date | null
  resumeRequired?: boolean
  continuationClaimJobId?: string | null
  continuationClaimDeferCount?: number | null
  continuationClaimToken?: string | null
  continuationClaimGeneration?: number | null
  continuationClaimExpiresAt?: Date | null
}

interface SyncStateRecord {
  paused?: boolean
  recurringEnabled?: boolean
  backfillCursor?: string | null
}

export interface ExternalMaterialRunFence {
  token: string
  generation: number
}

const continuationFenceFilter = (
  id: string,
  fence: ExternalMaterialRunFence,
) => ({
  _id: id,
  status: 'running' as const,
  continuationClaimToken: fence.token,
  continuationClaimGeneration: fence.generation,
})

interface RunStore {
  get(id: string): Promise<SyncRunRecord | null>
  findRunningConflict(
    provider: ExternalMaterialProvider,
    runId: string,
  ): Promise<unknown>
  update(
    id: string,
    update: Record<string, unknown>,
    fence?: ExternalMaterialRunFence,
  ): Promise<unknown>
  claimContinuation(
    id: string,
    provider: ExternalMaterialProvider,
    deferCount: number,
    generation: number,
    jobId: string,
    claimToken: string,
    startedAt: Date,
    expiresAt: Date,
  ): Promise<SyncRunRecord | null>
  restoreContinuation(
    id: string,
    fence: ExternalMaterialRunFence,
  ): Promise<unknown>
  renewContinuationLease(
    id: string,
    fence: ExternalMaterialRunFence,
    expiresAt: Date,
  ): Promise<unknown>
  checkpoint(
    id: string,
    expectedCursor: string | null,
    update: Record<string, unknown>,
    fence?: ExternalMaterialRunFence,
  ): Promise<unknown>
  failExhausted(id: string, completedAt: Date): Promise<unknown>
  failClaimedContinuation(
    id: string,
    fence: ExternalMaterialRunFence,
    completedAt: Date,
  ): Promise<unknown>
}

interface StateStore {
  get(provider: ExternalMaterialProvider): Promise<SyncStateRecord | null>
  update(
    provider: ExternalMaterialProvider,
    update: Record<string, unknown>,
  ): Promise<unknown>
}

interface WorkerDependencies {
  featureEnabled: boolean
  apiKeyPresent: boolean
  redis: RedisLockClient
  runs: RunStore
  states: StateStore
  fetchAds: typeof fetchGuangdadaAds
  normalizeAds: typeof normalizeGuangdadaAds
  ingest: typeof ingestExternalMaterial
  enqueueContinuation: typeof ensureContinuationScheduled
  sleep: (milliseconds: number) => Promise<void>
  setInterval: typeof setInterval
  clearInterval: typeof clearInterval
  now: () => Date
  lockTtlMs?: number
  lockRenewIntervalMs?: number
  claimLeaseTtlMs?: number
  restoreAttempts?: number
  restoreTimeoutMs?: number
}

interface ExternalMaterialJobData {
  runId: string
  provider: ExternalMaterialProvider
  request: ExternalMaterialSyncRequest
  continuation?: true
  deferCount?: number
  generation?: number
}

interface ExternalMaterialProcessResult {
  status: 'completed' | 'failed' | 'deferred' | 'disabled' | 'stale'
  counters: ExternalMaterialSyncCounters
  retryable?: boolean
  retryAfterMs?: number
  cursor?: string | null
}

const emptyCounters = (): ExternalMaterialSyncCounters => ({
  discovered: 0,
  considered: 0,
  alreadySeen: 0,
  downloaded: 0,
  contentReused: 0,
  newlyCreated: 0,
  invalid: 0,
  failed: 0,
  deferred: 0,
})

const mergeCounters = (
  committed: ExternalMaterialSyncCounters,
  batch: ExternalMaterialSyncCounters,
): ExternalMaterialSyncCounters => ({
  discovered: committed.discovered + batch.discovered,
  considered: committed.considered + batch.considered,
  alreadySeen: committed.alreadySeen + batch.alreadySeen,
  downloaded: committed.downloaded + batch.downloaded,
  contentReused: committed.contentReused + batch.contentReused,
  newlyCreated: committed.newlyCreated + batch.newlyCreated,
  invalid: committed.invalid + batch.invalid,
  failed: committed.failed + batch.failed,
  deferred: committed.deferred + batch.deferred,
})

const lockKey = (
  provider: ExternalMaterialProvider,
  trustedTestKeyPrefix?: string,
): string => {
  const productionKey = `external-material:sync-lock:${provider}`
  if (trustedTestKeyPrefix === undefined) return productionKey
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(trustedTestKeyPrefix)) {
    throw new Error('invalid_external_material_lock_prefix')
  }
  return `${trustedTestKeyPrefix}:${productionKey}`
}

const clampInteger = (
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)))
}

const lockTtl = (value?: number): number =>
  clampInteger(value, LOCK_TTL_DEFAULT_MS, LOCK_TTL_MIN_MS, LOCK_TTL_MAX_MS)

const lockRenewInterval = (value: number | undefined, ttl: number): number =>
  clampInteger(
    value,
    Math.min(30_000, Math.floor(ttl / 3)),
    LOCK_RENEW_MIN_MS,
    Math.min(
      LOCK_RENEW_MAX_MS,
      Math.max(LOCK_RENEW_MIN_MS, Math.floor(ttl / 3)),
    ),
  )

const claimLeaseTtl = (value?: number): number =>
  clampInteger(
    value,
    CLAIM_LEASE_TTL_DEFAULT_MS,
    CLAIM_LEASE_TTL_MIN_MS,
    CLAIM_LEASE_TTL_MAX_MS,
  )

export const acquireExternalMaterialLock = async (
  redis: RedisLockClient,
  provider: ExternalMaterialProvider,
  requestedTtlMs?: number,
  trustedTestKeyPrefix?: string,
): Promise<string | null> => {
  const owner = randomUUID()
  const result = await redis.set(
    lockKey(provider, trustedTestKeyPrefix),
    owner,
    'PX',
    lockTtl(requestedTtlMs),
    'NX',
  )
  return result === 'OK' ? owner : null
}

export const renewExternalMaterialLock = async (
  redis: RedisLockClient,
  provider: ExternalMaterialProvider,
  owner: string,
  requestedTtlMs?: number,
  trustedTestKeyPrefix?: string,
): Promise<boolean> => {
  const result = await redis.eval(
    RENEW_SCRIPT,
    1,
    lockKey(provider, trustedTestKeyPrefix),
    owner,
    String(lockTtl(requestedTtlMs)),
  )
  return result === 1
}

export const releaseExternalMaterialLock = async (
  redis: RedisLockClient,
  provider: ExternalMaterialProvider,
  owner: string,
  trustedTestKeyPrefix?: string,
): Promise<boolean> => {
  const result = await redis.eval(
    RELEASE_SCRIPT,
    1,
    lockKey(provider, trustedTestKeyPrefix),
    owner,
  )
  return result === 1
}

export const claimExternalMaterialContinuation = (
  id: string,
  provider: ExternalMaterialProvider,
  deferCount: number,
  generation: number,
  jobId: string,
  claimToken: string,
  startedAt: Date,
  expiresAt: Date,
) =>
  ExternalMaterialSyncRun.findOneAndUpdate(
    {
      _id: id,
      provider,
      deferCount,
      continuationGeneration: generation,
      $or: [
        {
          status: 'deferred',
          continuationPending: true,
          continuationJobId: jobId,
        },
        {
          status: 'running',
          continuationPending: false,
          continuationClaimJobId: jobId,
          continuationClaimDeferCount: deferCount,
          continuationClaimGeneration: generation,
          continuationClaimExpiresAt: { $lte: startedAt },
        },
      ],
    },
    {
      $set: {
        status: 'running',
        continuationPending: false,
        continuationClaimJobId: jobId,
        continuationClaimDeferCount: deferCount,
        continuationClaimToken: claimToken,
        continuationClaimGeneration: generation,
        continuationClaimExpiresAt: expiresAt,
        startedAt,
        deferredUntil: null,
        retryAfterMs: null,
      },
    },
    { new: true, runValidators: true },
  )

export const renewExternalMaterialContinuationLease = (
  id: string,
  fence: ExternalMaterialRunFence,
  expiresAt: Date,
) =>
  ExternalMaterialSyncRun.findOneAndUpdate(
    continuationFenceFilter(id, fence),
    { $set: { continuationClaimExpiresAt: expiresAt } },
    { new: true, runValidators: true },
  )

export const checkpointExternalMaterialRunWithFence = (
  id: string,
  expectedCursor: string | null,
  fence: ExternalMaterialRunFence,
  update: Record<string, unknown>,
) =>
  ExternalMaterialSyncRun.findOneAndUpdate(
    {
      ...continuationFenceFilter(id, fence),
      ...(expectedCursor === null
        ? { $or: [{ cursor: null }, { cursor: { $exists: false } }] }
        : { cursor: expectedCursor }),
    },
    { $set: update },
    { new: true, runValidators: true },
  )

export const updateExternalMaterialRunWithFence = (
  id: string,
  fence: ExternalMaterialRunFence,
  update: Record<string, unknown>,
) =>
  ExternalMaterialSyncRun.findOneAndUpdate(
    continuationFenceFilter(id, fence),
    { $set: update },
    { new: true, runValidators: true },
  )

const defaultRunStore: RunStore = {
  get: (id) => ExternalMaterialSyncRun.findById(id).lean(),
  findRunningConflict: (provider, runId) =>
    ExternalMaterialSyncRun.findOne({
      provider,
      status: 'running',
      _id: { $ne: runId },
    }).lean(),
  update: (id, update, fence) =>
    fence
      ? updateExternalMaterialRunWithFence(id, fence, update)
      : ExternalMaterialSyncRun.findByIdAndUpdate(
          id,
          { $set: update },
          { new: true, runValidators: true },
        ),
  claimContinuation: (
    id,
    provider,
    deferCount,
    generation,
    jobId,
    claimToken,
    startedAt,
    expiresAt,
  ) =>
    claimExternalMaterialContinuation(
      id,
      provider,
      deferCount,
      generation,
      jobId,
      claimToken,
      startedAt,
      expiresAt,
    ),
  restoreContinuation: (id, fence) =>
    ExternalMaterialSyncRun.findOneAndUpdate(
      continuationFenceFilter(id, fence),
      {
        $set: {
          status: 'deferred',
          continuationPending: true,
          continuationClaimJobId: null,
          continuationClaimDeferCount: null,
          continuationClaimToken: null,
          continuationClaimGeneration: null,
          continuationClaimExpiresAt: null,
          startedAt: null,
        },
      },
      { new: true, runValidators: true },
    ),
  renewContinuationLease: (id, fence, expiresAt) =>
    renewExternalMaterialContinuationLease(id, fence, expiresAt),
  checkpoint: (id, expectedCursor, update, fence) =>
    fence
      ? checkpointExternalMaterialRunWithFence(
          id,
          expectedCursor,
          fence,
          update,
        )
      : ExternalMaterialSyncRun.findOneAndUpdate(
          {
            _id: id,
            status: 'running',
            ...(expectedCursor === null
              ? { $or: [{ cursor: null }, { cursor: { $exists: false } }] }
              : { cursor: expectedCursor }),
          },
          { $set: update },
          { new: true, runValidators: true },
        ),
  failExhausted: (id, completedAt) =>
    ExternalMaterialSyncRun.findOneAndUpdate(
      {
        _id: id,
        $or: [
          { status: { $in: ['queued', 'running'] } },
          { status: 'deferred', continuationPending: { $ne: true } },
        ],
      },
      {
        $set: {
          status: 'failed',
          completedAt,
          deferredUntil: null,
          retryAfterMs: null,
          continuationPending: false,
          continuationJobId: null,
          continuationDueAt: null,
          resumeRequired: false,
          continuationClaimJobId: null,
          continuationClaimDeferCount: null,
          continuationClaimToken: null,
          continuationClaimGeneration: null,
          continuationClaimExpiresAt: null,
        },
        $push: {
          errorSamples: {
            $each: [{ category: 'unexpected', at: completedAt }],
            $slice: -MAX_ERROR_SAMPLES,
          },
        },
      },
      { new: true, runValidators: true },
    ),
  failClaimedContinuation: (id, fence, completedAt) =>
    ExternalMaterialSyncRun.findOneAndUpdate(
      continuationFenceFilter(id, fence),
      {
        $set: {
          status: 'failed',
          completedAt,
          deferredUntil: null,
          retryAfterMs: null,
          continuationPending: false,
          continuationJobId: null,
          continuationDueAt: null,
          resumeRequired: false,
          continuationClaimJobId: null,
          continuationClaimDeferCount: null,
          continuationClaimToken: null,
          continuationClaimGeneration: null,
          continuationClaimExpiresAt: null,
        },
        $push: {
          errorSamples: {
            $each: [{ category: 'unexpected', at: completedAt }],
            $slice: -MAX_ERROR_SAMPLES,
          },
        },
      },
      { new: true, runValidators: true },
    ),
}

const defaultStateStore: StateStore = {
  get: (provider) => ExternalMaterialSyncState.findOne({ provider }).lean(),
  update: (provider, update) =>
    ExternalMaterialSyncState.findOneAndUpdate(
      { provider },
      {
        $set: update,
        $setOnInsert: { provider },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ),
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

let workerRedis: Redis | null = null

const defaultDependencies = (): WorkerDependencies => {
  const redis = workerRedis ?? getRedisClient()
  if (!redis) throw new Error('external_material_redis_unavailable')
  return {
    featureEnabled: process.env.EXTERNAL_MATERIAL_SYNC_ENABLED === 'true',
    apiKeyPresent: Boolean(process.env.GUANGDADA_API_KEY?.trim()),
    redis,
    runs: defaultRunStore,
    states: defaultStateStore,
    fetchAds: fetchGuangdadaAds,
    normalizeAds: normalizeGuangdadaAds,
    ingest: ingestExternalMaterial,
    enqueueContinuation: ensureContinuationScheduled,
    sleep: wait,
    setInterval,
    clearInterval,
    now: () => new Date(),
  }
}

const safeCategory = (error: unknown): ExternalMaterialErrorCategory => {
  if (error instanceof GuangdadaApiError) {
    const allowed: ExternalMaterialErrorCategory[] = [
      'configuration',
      'authentication',
      'rate_limit',
      'server',
      'request',
      'network',
      'timeout',
      'cancelled',
      'response',
    ]
    if (allowed.includes(error.category as ExternalMaterialErrorCategory)) {
      return error.category as ExternalMaterialErrorCategory
    }
  }
  return 'unexpected'
}

const appendError = (
  samples: Array<{ category: ExternalMaterialErrorCategory }>,
  category: ExternalMaterialErrorCategory,
) => {
  if (samples.length < MAX_ERROR_SAMPLES) samples.push({ category })
}

const pageFromCursor = (cursor: unknown): number => {
  if (typeof cursor !== 'string' || !/^\d{1,3}$/.test(cursor)) return 1
  return clampInteger(cursor, 1, 1, GUANGDADA_LIMITS.totalPages)
}

const nextBackfillCursor = (
  pagination: Record<string, unknown>,
): string | null => {
  const hasMore = pagination.has_more ?? pagination.hasMore
  if (hasMore !== true) return null
  const page =
    pagination.page ?? pagination.current_page ?? pagination.currentPage
  const current = clampInteger(page, 1, 1, GUANGDADA_LIMITS.totalPages)
  if (current >= GUANGDADA_LIMITS.totalPages) return null
  return String(current + 1)
}

const rankAssets = (
  assets: NormalizedGuangdadaAsset[],
  limit: number,
): NormalizedGuangdadaAsset[] =>
  assets
    .slice()
    .sort(
      (left, right) =>
        (right.estimatedValue ?? Number.NEGATIVE_INFINITY) -
          (left.estimatedValue ?? Number.NEGATIVE_INFINITY) ||
        (right.heat ?? Number.NEGATIVE_INFINITY) -
          (left.heat ?? Number.NEGATIVE_INFINITY),
    )
    .slice(0, limit)

const providerRetryAfter = (error: GuangdadaApiError): number =>
  clampInteger(
    error.retryAfterMs,
    RATE_LIMIT_MIN_MS,
    RATE_LIMIT_MIN_MS,
    RATE_LIMIT_MAX_MS,
  )

const fetchWithRetries = async (
  request: ExternalMaterialSyncRequest,
  page: number,
  batchLimit: number,
  dependencies: WorkerDependencies,
  signal: AbortSignal,
  ensureOwned: () => Promise<boolean>,
) => {
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt += 1) {
    try {
      return await dependencies.fetchAds({
        page,
        pageSize: Math.min(100, batchLimit),
        recentDays: request.recentDays,
        sortBy: 'estimated_value',
        maxItems: batchLimit,
        maxPages: Math.min(
          GUANGDADA_LIMITS.totalPages,
          Math.ceil(batchLimit / Math.min(100, batchLimit)),
        ),
        signal,
      })
    } catch (error) {
      if (
        !(error instanceof GuangdadaApiError) ||
        !error.retryable ||
        error.category === 'rate_limit' ||
        attempt === FETCH_ATTEMPTS - 1
      ) {
        throw error
      }
      await dependencies.sleep(Math.min(30_000, 1000 * 2 ** attempt))
      if (!(await ensureOwned())) {
        throw new Error('external_material_lock_lost')
      }
    }
  }
  throw new Error('external_material_fetch_exhausted')
}

const finishRun = async (
  dependencies: WorkerDependencies,
  runId: string,
  fence: ExternalMaterialRunFence | undefined,
  status: 'completed' | 'failed' | 'deferred' | 'disabled',
  counters: ExternalMaterialSyncCounters,
  errorSamples: Array<{ category: ExternalMaterialErrorCategory }>,
  extra: Record<string, unknown> = {},
) => {
  const update = {
    status,
    counters,
    errorSamples,
    continuationPending: false,
    continuationJobId: null,
    continuationDueAt: null,
    resumeRequired: false,
    continuationClaimJobId: null,
    continuationClaimDeferCount: null,
    continuationClaimToken: null,
    continuationClaimGeneration: null,
    continuationClaimExpiresAt: null,
    completedAt: dependencies.now(),
    ...extra,
  }
  const updated = fence
    ? await dependencies.runs.update(runId, update, fence)
    : await dependencies.runs.update(runId, update)
  if (!updated && fence) return { status: 'stale' as const, counters }
  return { status, counters, ...extra }
}

const deferForOperatorPause = async (
  dependencies: WorkerDependencies,
  runId: string,
  provider: ExternalMaterialProvider,
  run: SyncRunRecord,
  fence: ExternalMaterialRunFence | undefined,
  counters: ExternalMaterialSyncCounters,
  errorSamples: Array<{ category: ExternalMaterialErrorCategory }>,
  cursor: string | null,
) => {
  appendError(errorSamples, 'paused')
  const generation =
    clampInteger(
      run.continuationGeneration,
      0,
      0,
      MAX_CONTINUATION_GENERATION - 1,
    ) + 1
  const dueAt = dependencies.now()
  const update = {
    status: 'deferred',
    counters,
    cursor,
    errorSamples,
    deferredUntil: null,
    retryAfterMs: null,
    deferCount: clampInteger(
      run.deferCount,
      0,
      0,
      MAX_EXTERNAL_MATERIAL_DEFERS,
    ),
    continuationPending: true,
    continuationGeneration: generation,
    continuationJobId: externalMaterialContinuationJobId(
      provider,
      runId,
      generation,
    ),
    continuationDueAt: dueAt,
    resumeRequired: true,
    continuationClaimJobId: null,
    continuationClaimDeferCount: null,
    continuationClaimToken: null,
    continuationClaimGeneration: null,
    continuationClaimExpiresAt: null,
    completedAt: null,
  }
  const updated = fence
    ? await dependencies.runs.update(runId, update, fence)
    : await dependencies.runs.update(runId, update)
  return {
    status: updated || !fence ? ('deferred' as const) : ('stale' as const),
    counters,
  }
}

const processClaimedExternalMaterialSyncRun = async (
  job: Pick<Job<ExternalMaterialJobData>, 'data' | 'updateProgress'>,
  dependencies: WorkerDependencies,
  run: SyncRunRecord,
  request: ExternalMaterialSyncRequest,
  isContinuation: boolean,
  fence?: ExternalMaterialRunFence,
): Promise<ExternalMaterialProcessResult> => {
  const { runId, provider } = job.data
  let committedCounters: ExternalMaterialSyncCounters = {
    ...emptyCounters(),
    ...(run.counters || {}),
  }
  const errorSamples: Array<{ category: ExternalMaterialErrorCategory }> = []

  if (!dependencies.featureEnabled || !dependencies.apiKeyPresent) {
    appendError(errorSamples, 'configuration')
    return finishRun(
      dependencies,
      runId,
      fence,
      'disabled',
      committedCounters,
      errorSamples,
    )
  }

  const state = await dependencies.states.get(provider)
  if (state?.paused) {
    return deferForOperatorPause(
      dependencies,
      runId,
      provider,
      run,
      fence,
      committedCounters,
      errorSamples,
      typeof run.cursor === 'string' ? run.cursor : null,
    )
  }

  if (await dependencies.runs.findRunningConflict(provider, runId)) {
    committedCounters.deferred += 1
    appendError(errorSamples, 'active_run')
    return finishRun(
      dependencies,
      runId,
      fence,
      'deferred',
      committedCounters,
      errorSamples,
    )
  }

  const ttl = lockTtl(dependencies.lockTtlMs)
  const leaseTtl = claimLeaseTtl(dependencies.claimLeaseTtlMs)
  const owner = await acquireExternalMaterialLock(
    dependencies.redis,
    provider,
    ttl,
  )
  if (!owner) {
    committedCounters.deferred += 1
    appendError(errorSamples, 'lock_busy')
    return finishRun(
      dependencies,
      runId,
      fence,
      'deferred',
      committedCounters,
      errorSamples,
    )
  }

  const controller = new AbortController()
  let lockLost = false
  let renewalInFlight = false
  const heartbeat = async (): Promise<boolean> => {
    if (lockLost) return false
    try {
      let owned = await renewExternalMaterialLock(
        dependencies.redis,
        provider,
        owner,
        ttl,
      )
      if (owned && fence) {
        owned = Boolean(
          await dependencies.runs.renewContinuationLease(
            runId,
            fence,
            new Date(dependencies.now().getTime() + leaseTtl),
          ),
        )
      }
      if (!owned) {
        lockLost = true
        controller.abort()
      }
      return owned
    } catch {
      lockLost = true
      controller.abort()
      return false
    }
  }
  const timer = dependencies.setInterval(
    () => {
      if (renewalInFlight || lockLost) return
      renewalInFlight = true
      void heartbeat().finally(() => {
        renewalInFlight = false
      })
    },
    lockRenewInterval(dependencies.lockRenewIntervalMs, ttl),
  )
  const finishLockLost = () =>
    finishRun(
      dependencies,
      runId,
      fence,
      'failed',
      committedCounters,
      [{ category: 'lock_lost' }],
      { retryable: true },
    )

  try {
    if (!isContinuation) {
      await dependencies.runs.update(runId, {
        status: 'running',
        startedAt: dependencies.now(),
        counters: committedCounters,
        errorSamples,
        continuationPending: false,
        continuationJobId: null,
        continuationDueAt: null,
        resumeRequired: false,
        continuationClaimJobId: null,
        continuationClaimDeferCount: null,
        continuationClaimToken: null,
        continuationClaimGeneration: null,
        continuationClaimExpiresAt: null,
        deferredUntil: null,
        retryAfterMs: null,
      })
    }

    let persistedCursor =
      request.mode === 'backfill' && typeof run.cursor === 'string'
        ? run.cursor
        : null
    let cursor =
      request.mode === 'backfill'
        ? String(pageFromCursor(persistedCursor ?? state?.backfillCursor))
        : null
    let page = cursor ? pageFromCursor(cursor) : 1
    let processedCount =
      committedCounters.alreadySeen + committedCounters.downloaded
    const pauseIfRequested = async () => {
      const latestState = await dependencies.states.get(provider)
      return latestState?.paused
        ? deferForOperatorPause(
            dependencies,
            runId,
            provider,
            run,
            fence,
            committedCounters,
            errorSamples,
            persistedCursor,
          )
        : null
    }

    if (
      request.mode === 'backfill' &&
      !request.dryRun &&
      persistedCursor &&
      state?.backfillCursor !== persistedCursor
    ) {
      if (!(await heartbeat())) return finishLockLost()
      await dependencies.states.update(provider, {
        backfillCursor: persistedCursor,
      })
      if (lockLost) return finishLockLost()
    }

    while (committedCounters.discovered < request.limit) {
      if (lockLost) return finishLockLost()
      const remaining = request.limit - committedCounters.discovered
      const batchLimit = Math.min(remaining, GUANGDADA_LIMITS.totalItems)
      let fetched: Awaited<ReturnType<typeof fetchGuangdadaAds>>
      try {
        fetched = await fetchWithRetries(
          request,
          page,
          batchLimit,
          dependencies,
          controller.signal,
          heartbeat,
        )
      } catch (error) {
        if (lockLost) {
          return finishLockLost()
        }
        const category = safeCategory(error)
        appendError(errorSamples, category)
        if (
          error instanceof GuangdadaApiError &&
          error.shouldPauseAuthentication &&
          error.category === 'authentication'
        ) {
          await dependencies.states.update(provider, {
            paused: true,
            pauseReason: 'provider_authentication',
            recurringEnabled: false,
          })
          return finishRun(
            dependencies,
            runId,
            fence,
            'failed',
            committedCounters,
            errorSamples,
          )
        }
        if (
          error instanceof GuangdadaApiError &&
          error.category === 'rate_limit'
        ) {
          if (!(await heartbeat())) return finishLockLost()
          const deferCount =
            clampInteger(run.deferCount, 0, 0, MAX_EXTERNAL_MATERIAL_DEFERS) + 1
          if (deferCount > MAX_EXTERNAL_MATERIAL_DEFERS) {
            return finishRun(
              dependencies,
              runId,
              fence,
              'failed',
              committedCounters,
              errorSamples,
              {
                deferredUntil: null,
                retryAfterMs: null,
              },
            )
          }
          committedCounters.deferred += 1
          const retryAfterMs = providerRetryAfter(error)
          const deferredUntil = new Date(
            dependencies.now().getTime() + retryAfterMs,
          )
          const generation =
            clampInteger(
              run.continuationGeneration,
              0,
              0,
              MAX_CONTINUATION_GENERATION - 1,
            ) + 1
          const continuationJobId = externalMaterialContinuationJobId(
            provider,
            runId,
            generation,
          )
          const deferredUpdate = {
            status: 'deferred',
            counters: committedCounters,
            errorSamples,
            deferredUntil,
            retryAfterMs,
            deferCount,
            continuationPending: true,
            continuationGeneration: generation,
            continuationJobId,
            continuationDueAt: deferredUntil,
            resumeRequired: false,
            continuationClaimJobId: null,
            continuationClaimDeferCount: null,
            continuationClaimToken: null,
            continuationClaimGeneration: null,
            continuationClaimExpiresAt: null,
          }
          const deferred = fence
            ? await dependencies.runs.update(runId, deferredUpdate, fence)
            : await dependencies.runs.update(runId, deferredUpdate)
          if (!deferred && fence) {
            return { status: 'stale', counters: committedCounters }
          }
          try {
            await dependencies.enqueueContinuation({
              runId,
              provider,
              request,
              deferCount,
              generation,
              jobId: continuationJobId,
              dueAt: deferredUntil,
            })
          } catch (error) {
            throw new ContinuationSchedulingError(error)
          }
          return {
            status: 'deferred',
            counters: committedCounters,
            retryAfterMs,
          }
        }
        return finishRun(
          dependencies,
          runId,
          fence,
          'failed',
          committedCounters,
          errorSamples,
          {
            retryable: error instanceof GuangdadaApiError && error.retryable,
          },
        )
      }

      if (lockLost) return finishLockLost()
      const pauseAfterFetch = await pauseIfRequested()
      if (pauseAfterFetch) return pauseAfterFetch
      const discoveredInBatch = Math.min(
        batchLimit,
        Array.isArray(fetched.data) ? fetched.data.length : 0,
      )
      const batchCounters = emptyCounters()
      batchCounters.discovered = discoveredInBatch
      const remainingConsideration = Math.max(
        0,
        request.limit - committedCounters.considered,
      )
      const assets = rankAssets(
        dependencies.normalizeAds(fetched.data),
        remainingConsideration,
      )
      batchCounters.considered = assets.length

      if (!request.dryRun) {
        for (let index = 0; index < assets.length; index += 1) {
          if (!(await heartbeat())) {
            return finishLockLost()
          }
          const pauseBeforeItem = await pauseIfRequested()
          if (pauseBeforeItem) return pauseBeforeItem

          let outcome:
            | Awaited<ReturnType<typeof ingestExternalMaterial>>
            | undefined
          for (let attempt = 0; attempt < INGESTION_ATTEMPTS; attempt += 1) {
            outcome = await dependencies.ingest(assets[index])
            if (!(await heartbeat())) {
              return finishLockLost()
            }
            if (
              outcome.kind !== 'failed' ||
              !outcome.retryable ||
              attempt === INGESTION_ATTEMPTS - 1
            ) {
              break
            }
            await dependencies.sleep(Math.min(2000, 250 * 2 ** attempt))
            if (!(await heartbeat())) {
              return finishLockLost()
            }
          }

          const pauseAfterIngest = await pauseIfRequested()
          if (pauseAfterIngest) return pauseAfterIngest
          if (!outcome) {
            outcome = {
              kind: 'failed',
              retryable: true,
              category: 'unexpected_ingestion_failure',
            }
          }
          if (outcome.kind === 'alreadySeen') {
            batchCounters.alreadySeen += 1
          } else {
            batchCounters.downloaded += 1
            if (outcome.kind === 'contentReused') {
              batchCounters.contentReused += 1
            } else if (outcome.kind === 'created') {
              batchCounters.newlyCreated += 1
            } else if (outcome.kind === 'invalid') {
              batchCounters.invalid += 1
            } else {
              batchCounters.failed += 1
              appendError(errorSamples, 'ingestion_retry_exhausted')
            }
          }

          processedCount += 1
          if (
            processedCount % PROGRESS_BATCH_SIZE === 0 ||
            index === assets.length - 1
          ) {
            await job.updateProgress({
              considered:
                committedCounters.considered + batchCounters.considered,
              processed: processedCount,
            })
          }
        }
      }

      const pauseBeforeCommit = await pauseIfRequested()
      if (pauseBeforeCommit) return pauseBeforeCommit
      const nextCursor =
        request.mode === 'backfill'
          ? nextBackfillCursor(fetched.pagination as Record<string, unknown>)
          : null
      if (!(await heartbeat())) return finishLockLost()
      const checkpointCounters = mergeCounters(committedCounters, batchCounters)
      const checkpointUpdate = {
        cursor: nextCursor,
        counters: checkpointCounters,
        errorSamples,
      }
      const checkpointed = fence
        ? await dependencies.runs.checkpoint(
            runId,
            persistedCursor,
            checkpointUpdate,
            fence,
          )
        : await dependencies.runs.checkpoint(
            runId,
            persistedCursor,
            checkpointUpdate,
          )
      if (!checkpointed) {
        throw new Error('external_material_checkpoint_conflict')
      }
      committedCounters = checkpointCounters
      persistedCursor = nextCursor

      if (request.mode === 'backfill' && !request.dryRun) {
        cursor = nextCursor
        if (!(await heartbeat())) return finishLockLost()
        await dependencies.states.update(provider, {
          backfillCursor: cursor,
        })
        if (lockLost) return finishLockLost()
      } else if (request.mode === 'backfill') {
        cursor = nextCursor
      }

      if (
        request.mode !== 'backfill' ||
        discoveredInBatch === 0 ||
        !nextCursor ||
        pageFromCursor(nextCursor) <= page
      ) {
        break
      }
      page = pageFromCursor(nextCursor)
    }

    if (!(await heartbeat())) return finishLockLost()
    return finishRun(
      dependencies,
      runId,
      fence,
      'completed',
      committedCounters,
      errorSamples,
      request.mode === 'backfill' ? { cursor } : {},
    )
  } finally {
    dependencies.clearInterval(timer)
    await releaseExternalMaterialLock(
      dependencies.redis,
      provider,
      owner,
    ).catch(() => false)
  }
}

const safeContinuationJobId = (value: unknown): string | null =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= MAX_CONTINUATION_JOB_ID_LENGTH &&
  /^[A-Za-z0-9_-]+$/.test(value)
    ? value
    : null

const safeClaimAttempt = (value: unknown): number | null =>
  Number.isInteger(value) &&
  Number(value) >= 0 &&
  Number(value) <= MAX_BULL_ATTEMPT
    ? Number(value)
    : null

const safeContinuationGeneration = (value: unknown): number | null =>
  Number.isInteger(value) &&
  Number(value) >= 1 &&
  Number(value) <= MAX_CONTINUATION_GENERATION
    ? Number(value)
    : null

const pendingContinuationIntent = (
  runId: string,
  provider: ExternalMaterialProvider,
  request: ExternalMaterialSyncRequest,
  run: SyncRunRecord,
) => {
  const deferCount = Number(run.deferCount)
  const generation = safeContinuationGeneration(run.continuationGeneration)
  const jobId = safeContinuationJobId(run.continuationJobId)
  const dueAt = run.continuationDueAt
  if (
    run.status !== 'deferred' ||
    run.continuationPending !== true ||
    !Number.isInteger(deferCount) ||
    deferCount < 0 ||
    deferCount > MAX_EXTERNAL_MATERIAL_DEFERS ||
    generation === null ||
    jobId === null ||
    !(dueAt instanceof Date) ||
    !Number.isFinite(dueAt.getTime()) ||
    jobId !== externalMaterialContinuationJobId(provider, runId, generation)
  ) {
    return null
  }
  return {
    runId,
    provider,
    request,
    deferCount,
    generation,
    jobId,
    dueAt,
  }
}

const configuredJobAttempts = (
  job: Pick<Job<ExternalMaterialJobData>, 'opts'>,
): number => {
  const configuredAttempts = Number(job.opts.attempts ?? 1)
  return Number.isFinite(configuredAttempts) && configuredAttempts > 0
    ? Math.trunc(configuredAttempts)
    : 1
}

const withPersistenceTimeout = async <T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('external_material_persistence_timeout')),
          timeoutMs,
        )
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

const persistBeforeRethrow = async (
  dependencies: WorkerDependencies,
  operation: () => Promise<unknown>,
): Promise<boolean> => {
  const attempts = clampInteger(
    dependencies.restoreAttempts,
    RESTORE_ATTEMPTS_DEFAULT,
    1,
    RESTORE_ATTEMPTS_MAX,
  )
  const timeoutMs = clampInteger(
    dependencies.restoreTimeoutMs,
    RESTORE_TIMEOUT_DEFAULT_MS,
    1,
    RESTORE_TIMEOUT_MAX_MS,
  )
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await withPersistenceTimeout(operation(), timeoutMs)
      return true
    } catch {
      if (attempt < attempts - 1) {
        await dependencies
          .sleep(Math.min(250, 50 * 2 ** attempt))
          .catch(() => undefined)
      }
    }
  }
  return false
}

export const processExternalMaterialSyncJob = async (
  job: Pick<
    Job<ExternalMaterialJobData>,
    'data' | 'id' | 'attemptsMade' | 'opts' | 'updateProgress'
  >,
  suppliedDependencies?: WorkerDependencies,
): Promise<ExternalMaterialProcessResult> => {
  const dependencies = suppliedDependencies ?? defaultDependencies()
  const { runId, provider } = job.data
  const request = clampExternalMaterialSyncRequest(job.data.request)
  const isContinuation = job.data.continuation === true
  const continuationDeferCount = job.data.deferCount
  const continuationGeneration = safeContinuationGeneration(job.data.generation)
  const continuationJobId = safeContinuationJobId(job.id)
  let run: SyncRunRecord | null
  let fence: ExternalMaterialRunFence | undefined

  if (isContinuation) {
    if (
      !Number.isInteger(continuationDeferCount) ||
      continuationDeferCount === undefined ||
      continuationDeferCount < 0 ||
      continuationDeferCount > MAX_EXTERNAL_MATERIAL_DEFERS ||
      continuationGeneration === null ||
      continuationJobId === null ||
      safeClaimAttempt(job.attemptsMade) === null
    ) {
      return { status: 'stale', counters: emptyCounters() }
    }
    const startedAt = dependencies.now()
    const claimToken = randomUUID()
    fence = { token: claimToken, generation: continuationGeneration }
    run = await dependencies.runs.claimContinuation(
      runId,
      provider,
      continuationDeferCount,
      continuationGeneration,
      continuationJobId,
      claimToken,
      startedAt,
      new Date(
        startedAt.getTime() + claimLeaseTtl(dependencies.claimLeaseTtlMs),
      ),
    )
    if (!run) {
      return { status: 'stale', counters: emptyCounters() }
    }
  } else {
    run = await dependencies.runs.get(runId)
    if (!run) throw new Error('external_material_run_not_found')
    if (run.continuationPending === true) {
      const intent = pendingContinuationIntent(runId, provider, request, run)
      if (!intent) {
        return { status: 'stale', counters: emptyCounters() }
      }
      if (dependencies.featureEnabled && dependencies.apiKeyPresent) {
        await dependencies.enqueueContinuation(intent)
      }
      return {
        status: 'deferred',
        counters: {
          ...emptyCounters(),
          ...(run.counters || {}),
        },
      }
    }
  }

  try {
    return await processClaimedExternalMaterialSyncRun(
      job,
      dependencies,
      run,
      request,
      isContinuation,
      fence,
    )
  } catch (error) {
    if (error instanceof ContinuationSchedulingError) {
      throw error
    }
    const currentAttempt = safeClaimAttempt(job.attemptsMade) ?? 0
    const isFinalAttempt = currentAttempt + 1 >= configuredJobAttempts(job)
    if (isFinalAttempt) {
      if (
        isContinuation &&
        continuationDeferCount !== undefined &&
        continuationJobId !== null &&
        fence
      ) {
        await persistBeforeRethrow(dependencies, () =>
          dependencies.runs.failClaimedContinuation(
            runId,
            fence,
            dependencies.now(),
          ),
        )
      } else {
        await persistBeforeRethrow(dependencies, () =>
          dependencies.runs.failExhausted(runId, dependencies.now()),
        )
      }
    } else if (
      isContinuation &&
      continuationDeferCount !== undefined &&
      continuationJobId !== null &&
      fence
    ) {
      await persistBeforeRethrow(dependencies, () =>
        dependencies.runs.restoreContinuation(runId, fence),
      )
    }
    throw error
  }
}

export const handleExternalMaterialWorkerFailure = async (
  job: Pick<
    Job<ExternalMaterialJobData>,
    'data' | 'id' | 'attemptsMade' | 'opts'
  > | null,
  error: unknown,
  suppliedDependencies?: Pick<WorkerDependencies, 'runs' | 'now'>,
): Promise<void> => {
  if (!job?.data?.runId) return
  if (job.data.continuation === true) return
  if (error instanceof ContinuationSchedulingError) return
  const dependencies = suppliedDependencies ?? defaultDependencies()
  const attempts = configuredJobAttempts(job)
  if (job.attemptsMade < attempts) return
  await dependencies.runs.failExhausted(job.data.runId, dependencies.now())
}

export let externalMaterialWorker: Worker | null = null

export const initExternalMaterialWorker = async (
  redis: Redis | null = getRedisClient(),
): Promise<boolean> => {
  if (externalMaterialWorker) return true
  if (!redis) {
    logger.warn(
      '[ExternalMaterialWorker] Worker not initialized (Redis not configured)',
    )
    return false
  }
  await redis.ping()
  workerRedis = redis
  const connection = redis.duplicate()
  connection.options.maxRetriesPerRequest = null
  externalMaterialWorker = new Worker(
    EXTERNAL_MATERIAL_QUEUE_NAME,
    (job: Job<ExternalMaterialJobData>) => processExternalMaterialSyncJob(job),
    {
      connection,
      concurrency: 1,
      limiter: { max: 1, duration: 1000 },
    },
  )
  externalMaterialWorker.on('failed', (job, error) => {
    void handleExternalMaterialWorkerFailure(job, error).catch(() => {
      logger.error(
        '[ExternalMaterialWorker] Terminal failure persistence failed',
      )
    })
  })
  externalMaterialWorker.on('error', () => {
    logger.error('[ExternalMaterialWorker] Worker error')
  })
  logger.info('[ExternalMaterialWorker] Worker initialized')
  return true
}

export const closeExternalMaterialWorker = async (): Promise<void> => {
  const worker = externalMaterialWorker
  externalMaterialWorker = null
  workerRedis = null
  if (worker) await worker.close()
}
