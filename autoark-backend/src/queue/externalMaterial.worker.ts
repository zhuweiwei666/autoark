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
  clampExternalMaterialSyncRequest,
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
  counters?: Partial<ExternalMaterialSyncCounters>
}

interface SyncStateRecord {
  paused?: boolean
  recurringEnabled?: boolean
  backfillCursor?: string | null
}

interface RunStore {
  get(id: string): Promise<SyncRunRecord | null>
  findRunningConflict(
    provider: ExternalMaterialProvider,
    runId: string,
  ): Promise<unknown>
  update(id: string, update: Record<string, unknown>): Promise<unknown>
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
  sleep: (milliseconds: number) => Promise<void>
  setInterval: typeof setInterval
  clearInterval: typeof clearInterval
  now: () => Date
  lockTtlMs?: number
  lockRenewIntervalMs?: number
}

interface ExternalMaterialJobData {
  runId: string
  provider: ExternalMaterialProvider
  request: ExternalMaterialSyncRequest
}

interface ExternalMaterialProcessResult {
  status: 'completed' | 'failed' | 'deferred' | 'disabled'
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

const lockKey = (provider: ExternalMaterialProvider): string =>
  `external-material:sync-lock:${provider}`

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

export const acquireExternalMaterialLock = async (
  redis: RedisLockClient,
  provider: ExternalMaterialProvider,
  requestedTtlMs?: number,
): Promise<string | null> => {
  const owner = randomUUID()
  const result = await redis.set(
    lockKey(provider),
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
): Promise<boolean> => {
  const result = await redis.eval(
    RENEW_SCRIPT,
    1,
    lockKey(provider),
    owner,
    String(lockTtl(requestedTtlMs)),
  )
  return result === 1
}

export const releaseExternalMaterialLock = async (
  redis: RedisLockClient,
  provider: ExternalMaterialProvider,
  owner: string,
): Promise<boolean> => {
  const result = await redis.eval(RELEASE_SCRIPT, 1, lockKey(provider), owner)
  return result === 1
}

const defaultRunStore: RunStore = {
  get: (id) => ExternalMaterialSyncRun.findById(id).lean(),
  findRunningConflict: (provider, runId) =>
    ExternalMaterialSyncRun.findOne({
      provider,
      status: 'running',
      _id: { $ne: runId },
    }).lean(),
  update: (id, update) =>
    ExternalMaterialSyncRun.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true },
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
    }
  }
  throw new Error('external_material_fetch_exhausted')
}

const finishRun = async (
  dependencies: WorkerDependencies,
  runId: string,
  status: 'completed' | 'failed' | 'deferred' | 'disabled',
  counters: ExternalMaterialSyncCounters,
  errorSamples: Array<{ category: ExternalMaterialErrorCategory }>,
  extra: Record<string, unknown> = {},
) => {
  await dependencies.runs.update(runId, {
    status,
    counters,
    errorSamples,
    completedAt: dependencies.now(),
    ...extra,
  })
  return { status, counters, ...extra }
}

export const processExternalMaterialSyncJob = async (
  job: Pick<Job<ExternalMaterialJobData>, 'data' | 'updateProgress'>,
  suppliedDependencies?: WorkerDependencies,
): Promise<ExternalMaterialProcessResult> => {
  const dependencies = suppliedDependencies ?? defaultDependencies()
  const { runId, provider } = job.data
  const request = clampExternalMaterialSyncRequest(job.data.request)
  const run = await dependencies.runs.get(runId)
  if (!run) throw new Error('external_material_run_not_found')
  const currentCounters: ExternalMaterialSyncCounters = {
    ...emptyCounters(),
    ...(run.counters || {}),
  }
  const errorSamples: Array<{ category: ExternalMaterialErrorCategory }> = []

  if (!dependencies.featureEnabled || !dependencies.apiKeyPresent) {
    appendError(errorSamples, 'configuration')
    return finishRun(
      dependencies,
      runId,
      'disabled',
      currentCounters,
      errorSamples,
    )
  }

  const state = await dependencies.states.get(provider)
  if (state?.paused) {
    currentCounters.deferred += 1
    appendError(errorSamples, 'paused')
    return finishRun(
      dependencies,
      runId,
      'deferred',
      currentCounters,
      errorSamples,
    )
  }

  if (await dependencies.runs.findRunningConflict(provider, runId)) {
    currentCounters.deferred += 1
    appendError(errorSamples, 'active_run')
    return finishRun(
      dependencies,
      runId,
      'deferred',
      currentCounters,
      errorSamples,
    )
  }

  const ttl = lockTtl(dependencies.lockTtlMs)
  const owner = await acquireExternalMaterialLock(
    dependencies.redis,
    provider,
    ttl,
  )
  if (!owner) {
    currentCounters.deferred += 1
    appendError(errorSamples, 'lock_busy')
    return finishRun(
      dependencies,
      runId,
      'deferred',
      currentCounters,
      errorSamples,
    )
  }

  const controller = new AbortController()
  let lockLost = false
  let renewalInFlight = false
  const heartbeat = async (): Promise<boolean> => {
    if (lockLost) return false
    try {
      const owned = await renewExternalMaterialLock(
        dependencies.redis,
        provider,
        owner,
        ttl,
      )
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

  try {
    await dependencies.runs.update(runId, {
      status: 'running',
      startedAt: dependencies.now(),
      counters: currentCounters,
      errorSamples,
    })

    let cursor =
      request.mode === 'backfill'
        ? String(pageFromCursor(state?.backfillCursor))
        : null
    let page = cursor ? pageFromCursor(cursor) : 1
    let batchIndex = 0
    let processedCount = 0

    while (currentCounters.discovered < request.limit) {
      if (batchIndex > 0 && !(await heartbeat())) {
        appendError(errorSamples, 'lock_lost')
        return finishRun(
          dependencies,
          runId,
          'failed',
          currentCounters,
          errorSamples,
          { retryable: true },
        )
      }

      const remaining = request.limit - currentCounters.discovered
      const batchLimit = Math.min(remaining, GUANGDADA_LIMITS.totalItems)
      let fetched: Awaited<ReturnType<typeof fetchGuangdadaAds>>
      try {
        fetched = await fetchWithRetries(
          request,
          page,
          batchLimit,
          dependencies,
          controller.signal,
        )
      } catch (error) {
        if (lockLost) {
          appendError(errorSamples, 'lock_lost')
          return finishRun(
            dependencies,
            runId,
            'failed',
            currentCounters,
            errorSamples,
            { retryable: true },
          )
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
            'failed',
            currentCounters,
            errorSamples,
          )
        }
        if (
          error instanceof GuangdadaApiError &&
          error.category === 'rate_limit'
        ) {
          currentCounters.deferred += 1
          const retryAfterMs = providerRetryAfter(error)
          return finishRun(
            dependencies,
            runId,
            'deferred',
            currentCounters,
            errorSamples,
            { retryAfterMs },
          )
        }
        return finishRun(
          dependencies,
          runId,
          'failed',
          currentCounters,
          errorSamples,
          {
            retryable: error instanceof GuangdadaApiError && error.retryable,
          },
        )
      }

      if (lockLost) {
        appendError(errorSamples, 'lock_lost')
        return finishRun(
          dependencies,
          runId,
          'failed',
          currentCounters,
          errorSamples,
          { retryable: true },
        )
      }

      const discoveredInBatch = Math.min(
        batchLimit,
        Array.isArray(fetched.data) ? fetched.data.length : 0,
      )
      currentCounters.discovered += discoveredInBatch
      const remainingConsideration = Math.max(
        0,
        request.limit - currentCounters.considered,
      )
      const assets = rankAssets(
        dependencies.normalizeAds(fetched.data),
        remainingConsideration,
      )
      currentCounters.considered += assets.length

      if (!request.dryRun) {
        for (let index = 0; index < assets.length; index += 1) {
          if (!(await heartbeat())) {
            appendError(errorSamples, 'lock_lost')
            return finishRun(
              dependencies,
              runId,
              'failed',
              currentCounters,
              errorSamples,
              { retryable: true },
            )
          }

          let outcome:
            | Awaited<ReturnType<typeof ingestExternalMaterial>>
            | undefined
          for (let attempt = 0; attempt < INGESTION_ATTEMPTS; attempt += 1) {
            if (attempt > 0 && !(await heartbeat())) {
              appendError(errorSamples, 'lock_lost')
              return finishRun(
                dependencies,
                runId,
                'failed',
                currentCounters,
                errorSamples,
                { retryable: true },
              )
            }
            outcome = await dependencies.ingest(assets[index])
            if (
              outcome.kind !== 'failed' ||
              !outcome.retryable ||
              attempt === INGESTION_ATTEMPTS - 1
            ) {
              break
            }
            await dependencies.sleep(Math.min(2000, 250 * 2 ** attempt))
          }

          if (!outcome) {
            outcome = {
              kind: 'failed',
              retryable: true,
              category: 'unexpected_ingestion_failure',
            }
          }
          if (outcome.kind === 'alreadySeen') {
            currentCounters.alreadySeen += 1
          } else {
            currentCounters.downloaded += 1
            if (outcome.kind === 'contentReused') {
              currentCounters.contentReused += 1
            } else if (outcome.kind === 'created') {
              currentCounters.newlyCreated += 1
            } else if (outcome.kind === 'invalid') {
              currentCounters.invalid += 1
            } else {
              currentCounters.failed += 1
              appendError(errorSamples, 'ingestion_retry_exhausted')
            }
          }

          processedCount += 1
          if (
            processedCount % PROGRESS_BATCH_SIZE === 0 ||
            index === assets.length - 1
          ) {
            await dependencies.runs.update(runId, {
              counters: currentCounters,
              errorSamples,
            })
            await job.updateProgress({
              considered: currentCounters.considered,
              processed: processedCount,
            })
          }
        }
      }

      const nextCursor =
        request.mode === 'backfill'
          ? nextBackfillCursor(fetched.pagination as Record<string, unknown>)
          : null
      if (request.mode === 'backfill') {
        cursor = nextCursor
        await dependencies.states.update(provider, {
          backfillCursor: cursor,
        })
        await dependencies.runs.update(runId, {
          cursor,
          counters: currentCounters,
          errorSamples,
        })
      }

      batchIndex += 1
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

    return finishRun(
      dependencies,
      runId,
      'completed',
      currentCounters,
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
  externalMaterialWorker.on('failed', () => {
    logger.error('[ExternalMaterialWorker] Job failed')
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
