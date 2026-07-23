import { randomUUID } from 'crypto'
import { Queue } from 'bullmq'
import type Redis from 'ioredis'
import { getRedisClient } from '../config/redis'
import { GUANGDADA_LIMITS } from '../integration/guangdada/client'
import ExternalMaterialSyncRun, {
  ExternalMaterialSyncMode,
  ExternalMaterialSyncCounters,
  IExternalMaterialSyncRun,
} from '../models/ExternalMaterialSyncRun'
import type { ExternalMaterialProvider } from '../models/ExternalMaterialSyncState'
import logger from '../utils/logger'

export const EXTERNAL_MATERIAL_QUEUE_NAME = 'external-material.sync'
export const MAX_EXTERNAL_MATERIAL_DEFERS = 3
const RATE_LIMIT_MIN_MS = 60_000
const RATE_LIMIT_MAX_MS = 60 * 60 * 1000

export const SYNC_DEFAULTS = Object.freeze({
  scheduled: Object.freeze({ recentDays: 3, limit: 500 }),
  backfill: Object.freeze({ recentDays: 30, limit: 2000 }),
  canary10: Object.freeze({ recentDays: 3, limit: 10 }),
  canary100: Object.freeze({ recentDays: 3, limit: 100 }),
})

const MODES = Object.keys(SYNC_DEFAULTS) as ExternalMaterialSyncMode[]
const REQUEST_KEYS = new Set(['mode', 'dryRun', 'recentDays', 'limit'])

export interface ExternalMaterialSyncRequest {
  provider: ExternalMaterialProvider
  mode: ExternalMaterialSyncMode
  dryRun: boolean
  recentDays: number
  limit: number
}

type QueueLike = Pick<Queue, 'add' | 'getJobs'> & Partial<Pick<Queue, 'getJob'>>

interface RunStore {
  findActive(provider: ExternalMaterialProvider): Promise<unknown>
  create(
    input: Record<string, unknown>,
  ): Promise<{ _id: unknown; status?: string }>
  update(id: string, update: Record<string, unknown>): Promise<unknown>
}

export interface ExternalMaterialEnqueueDependencies {
  queue?: QueueLike | null
  runs?: RunStore
  featureEnabled?: boolean
  apiKeyPresent?: boolean
}

export interface ExternalMaterialEnqueueResult {
  enqueued: boolean
  status: 'queued' | 'duplicate' | 'disabled' | 'unavailable'
  runId?: string
  request: ExternalMaterialSyncRequest
}

export interface ExternalMaterialContinuationInput {
  runId: string
  provider: ExternalMaterialProvider
  request: ExternalMaterialSyncRequest
  retryAfterMs?: number
  deferCount: number
  generation?: number
  jobId?: string
  dueAt?: Date
}

export interface ExternalMaterialContinuationDependencies {
  queue?: Pick<Queue, 'add' | 'getJob'> | null
  now?: () => Date
}

export interface ExternalMaterialContinuationIntent {
  runId: string
  provider: ExternalMaterialProvider
  request: ExternalMaterialSyncRequest
  deferCount: number
  generation: number
  jobId: string
  dueAt: Date
}

interface PendingContinuationRecord {
  _id?: unknown
  provider?: unknown
  mode?: unknown
  dryRun?: unknown
  request?: {
    recentDays?: unknown
    limit?: unknown
  }
  status?: unknown
  deferCount?: unknown
  continuationPending?: unknown
  continuationGeneration?: unknown
  continuationJobId?: unknown
  continuationDueAt?: unknown
}

interface ContinuationIntentStore {
  findPending(
    provider: ExternalMaterialProvider,
    resumeOnly: boolean,
  ): Promise<PendingContinuationRecord[]>
}

export interface ExternalMaterialContinuationReconcileDependencies extends ExternalMaterialContinuationDependencies {
  runs?: ContinuationIntentStore
  ensure?: typeof ensureContinuationScheduled
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

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const boundedInteger = (
  value: unknown,
  fallback: number,
  maximum: number,
): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(1, Math.trunc(value)))
}

const validMode = (value: unknown): value is ExternalMaterialSyncMode =>
  typeof value === 'string' && MODES.includes(value as ExternalMaterialSyncMode)

export const clampExternalMaterialSyncRequest = (
  input: Partial<ExternalMaterialSyncRequest> | Record<string, unknown> = {},
): ExternalMaterialSyncRequest => {
  const mode = validMode(input.mode) ? input.mode : 'scheduled'
  const defaults = SYNC_DEFAULTS[mode]
  return {
    provider: 'guangdada',
    mode,
    dryRun: input.dryRun === true,
    recentDays: boundedInteger(
      input.recentDays,
      defaults.recentDays,
      Math.min(defaults.recentDays, GUANGDADA_LIMITS.recentDays),
    ),
    limit: boundedInteger(input.limit, defaults.limit, defaults.limit),
  }
}

export const parseExternalMaterialSyncRequest = (
  body: unknown,
): ExternalMaterialSyncRequest => {
  if (!isPlainObject(body)) throw new Error('invalid_sync_request')
  if (Object.keys(body).some((key) => !REQUEST_KEYS.has(key))) {
    throw new Error('invalid_sync_request')
  }
  if (body.mode !== undefined && !validMode(body.mode)) {
    throw new Error('invalid_sync_request')
  }
  if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') {
    throw new Error('invalid_sync_request')
  }
  for (const field of ['recentDays', 'limit'] as const) {
    const value = body[field]
    if (
      value !== undefined &&
      (typeof value !== 'number' ||
        !Number.isFinite(value) ||
        !Number.isInteger(value))
    ) {
      throw new Error('invalid_sync_request')
    }
  }
  return clampExternalMaterialSyncRequest(body)
}

export const deterministicExternalMaterialJobId = (
  provider: ExternalMaterialProvider,
  mode: ExternalMaterialSyncMode,
): string =>
  mode === 'scheduled'
    ? `external-material-${provider}-scheduled`
    : `external-material-${provider}-${mode}-${randomUUID()}`

export const externalMaterialContinuationJobId = (
  provider: ExternalMaterialProvider,
  runId: string,
  generation: number,
): string => {
  const safeRunId = runId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 96)
  if (!safeRunId) throw new Error('invalid_external_material_run_id')
  const boundedGeneration = boundedInteger(generation, 1, 1_000_000)
  return `external-material-${provider}-continuation-${safeRunId}-${boundedGeneration}`
}

const defaultRunStore: RunStore = {
  findActive: (provider) =>
    ExternalMaterialSyncRun.findOne({
      provider,
      $or: [
        { status: { $in: ['queued', 'running'] } },
        { status: 'deferred', continuationPending: true },
      ],
    }).lean(),
  create: (input) =>
    ExternalMaterialSyncRun.create(
      input,
    ) as unknown as Promise<IExternalMaterialSyncRun>,
  update: (id, update) => ExternalMaterialSyncRun.findByIdAndUpdate(id, update),
}

const envEnabled = (): boolean =>
  process.env.EXTERNAL_MATERIAL_SYNC_ENABLED === 'true'

const envHasApiKey = (): boolean =>
  Boolean(process.env.GUANGDADA_API_KEY?.trim())

const isScheduledOverlap = (
  job: { data?: unknown },
  provider: ExternalMaterialProvider,
): boolean => {
  const data = isPlainObject(job.data) ? job.data : {}
  const queuedRequest = isPlainObject(data.request) ? data.request : {}
  return data.provider === provider && queuedRequest.mode === 'scheduled'
}

const duplicateKey = (error: unknown): boolean =>
  Boolean(error) &&
  typeof error === 'object' &&
  (error as { code?: unknown }).code === 11000

export let externalMaterialQueue: Queue | null = null

export const initExternalMaterialQueue = async (
  redis: Redis | null = getRedisClient(),
): Promise<boolean> => {
  if (externalMaterialQueue) return true
  if (!redis) {
    logger.warn(
      '[ExternalMaterialQueue] Queue not initialized (Redis not configured)',
    )
    return false
  }

  await redis.ping()
  const connection = redis.duplicate()
  connection.options.maxRetriesPerRequest = null
  externalMaterialQueue = new Queue(EXTERNAL_MATERIAL_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { count: 100, age: 86_400 },
      removeOnFail: { count: 200, age: 7 * 86_400 },
    },
  })
  externalMaterialQueue.on('error', () => {
    logger.error('[ExternalMaterialQueue] Queue error')
  })
  logger.info('[ExternalMaterialQueue] Queue initialized')
  return true
}

export const closeExternalMaterialQueue = async (): Promise<void> => {
  const queue = externalMaterialQueue
  externalMaterialQueue = null
  if (queue) await queue.close()
}

export const ensureContinuationScheduled = async (
  intent: ExternalMaterialContinuationIntent,
  dependencies: ExternalMaterialContinuationDependencies = {},
) => {
  const queue =
    dependencies.queue === undefined
      ? externalMaterialQueue
      : dependencies.queue
  if (!queue) throw new Error('external_material_queue_unavailable')
  if (
    !Number.isInteger(intent.deferCount) ||
    intent.deferCount < 0 ||
    intent.deferCount > MAX_EXTERNAL_MATERIAL_DEFERS ||
    !Number.isInteger(intent.generation) ||
    intent.generation < 1 ||
    intent.generation > 1_000_000 ||
    intent.jobId !==
      externalMaterialContinuationJobId(
        intent.provider,
        intent.runId,
        intent.generation,
      ) ||
    !(intent.dueAt instanceof Date) ||
    !Number.isFinite(intent.dueAt.getTime())
  ) {
    throw new Error('invalid_external_material_continuation_intent')
  }

  const existing = await queue.getJob(intent.jobId)
  if (existing) {
    const state = await existing.getState()
    if (state === 'waiting' || state === 'delayed' || state === 'active') {
      return existing
    }
    if (state === 'completed' || state === 'failed') {
      await existing.remove()
    } else {
      return existing
    }
  }

  const now = dependencies.now?.() ?? new Date()
  const delay = Math.max(0, intent.dueAt.getTime() - now.getTime())
  return queue.add(
    'sync',
    {
      runId: intent.runId,
      provider: intent.provider,
      request: clampExternalMaterialSyncRequest(intent.request),
      continuation: true,
      deferCount: intent.deferCount,
      generation: intent.generation,
    },
    {
      jobId: intent.jobId,
      delay,
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
    },
  )
}

const defaultContinuationIntentStore: ContinuationIntentStore = {
  findPending: (provider, resumeOnly) =>
    ExternalMaterialSyncRun.find({
      provider,
      status: 'deferred',
      continuationPending: true,
      ...(resumeOnly ? { resumeRequired: true } : {}),
    }).lean() as unknown as Promise<PendingContinuationRecord[]>,
}

export const reconcileExternalMaterialContinuations = async (
  input: {
    provider: ExternalMaterialProvider
    resumeOnly?: boolean
  },
  dependencies: ExternalMaterialContinuationReconcileDependencies = {},
): Promise<number> => {
  const runs = dependencies.runs ?? defaultContinuationIntentStore
  const ensure = dependencies.ensure ?? ensureContinuationScheduled
  const pending = await runs.findPending(
    input.provider,
    input.resumeOnly === true,
  )
  let reconciled = 0
  for (const run of pending) {
    const runId = String(run._id ?? '')
    const generation = Number(run.continuationGeneration)
    const deferCount = Number(run.deferCount)
    const jobId = run.continuationJobId
    const dueAt = run.continuationDueAt
    if (
      run.status !== 'deferred' ||
      run.continuationPending !== true ||
      !Number.isInteger(generation) ||
      generation < 1 ||
      generation > 1_000_000 ||
      !Number.isInteger(deferCount) ||
      deferCount < 0 ||
      deferCount > MAX_EXTERNAL_MATERIAL_DEFERS ||
      typeof jobId !== 'string' ||
      !(dueAt instanceof Date) ||
      !Number.isFinite(dueAt.getTime()) ||
      jobId !==
        externalMaterialContinuationJobId(input.provider, runId, generation)
    ) {
      continue
    }
    await ensure(
      {
        runId,
        provider: input.provider,
        request: clampExternalMaterialSyncRequest({
          provider: input.provider,
          mode: run.mode,
          dryRun: run.dryRun,
          recentDays: run.request?.recentDays,
          limit: run.request?.limit,
        }),
        deferCount,
        generation,
        jobId,
        dueAt,
      },
      dependencies,
    )
    reconciled += 1
  }
  return reconciled
}

export const enqueueExternalMaterialContinuation = async (
  input: ExternalMaterialContinuationInput,
  dependencies: ExternalMaterialContinuationDependencies = {},
) => {
  if (
    !Number.isInteger(input.deferCount) ||
    input.deferCount < 1 ||
    input.deferCount > MAX_EXTERNAL_MATERIAL_DEFERS
  ) {
    throw new Error('external_material_defer_limit')
  }

  const request = clampExternalMaterialSyncRequest(input.request)
  const retryAfterMs = Math.max(
    RATE_LIMIT_MIN_MS,
    boundedInteger(input.retryAfterMs, RATE_LIMIT_MIN_MS, RATE_LIMIT_MAX_MS),
  )
  const generation = input.generation ?? input.deferCount
  const now = dependencies.now?.() ?? new Date()
  return ensureContinuationScheduled(
    {
      runId: input.runId,
      provider: input.provider,
      request,
      deferCount: input.deferCount,
      generation,
      jobId:
        input.jobId ??
        externalMaterialContinuationJobId(
          input.provider,
          input.runId,
          generation,
        ),
      dueAt: input.dueAt ?? new Date(now.getTime() + retryAfterMs),
    },
    { ...dependencies, now: () => now },
  )
}

export const enqueueExternalMaterialSync = async (
  input: Partial<ExternalMaterialSyncRequest> | Record<string, unknown>,
  dependencies: ExternalMaterialEnqueueDependencies = {},
): Promise<ExternalMaterialEnqueueResult> => {
  const bounded = clampExternalMaterialSyncRequest(input)
  const queue =
    dependencies.queue === undefined
      ? externalMaterialQueue
      : dependencies.queue
  const runs = dependencies.runs ?? defaultRunStore
  const featureEnabled = dependencies.featureEnabled ?? envEnabled()
  const apiKeyPresent = dependencies.apiKeyPresent ?? envHasApiKey()

  if (!featureEnabled || !apiKeyPresent) {
    const run = await runs.create({
      provider: bounded.provider,
      mode: bounded.mode,
      dryRun: bounded.dryRun,
      request: {
        recentDays: bounded.recentDays,
        limit: bounded.limit,
      },
      status: 'disabled',
      continuationPending: false,
      completedAt: new Date(),
      counters: emptyCounters(),
      errorSamples: [{ category: 'configuration' }],
    })
    return {
      enqueued: false,
      status: 'disabled',
      runId: String(run._id),
      request: bounded,
    }
  }

  if (!queue) {
    return {
      enqueued: false,
      status: 'unavailable',
      request: bounded,
    }
  }

  if (bounded.mode === 'scheduled') {
    const existingJobs = await queue.getJobs(['waiting', 'active', 'delayed'])
    if (
      existingJobs.some((queuedJob) =>
        isScheduledOverlap(queuedJob, bounded.provider),
      )
    ) {
      return {
        enqueued: false,
        status: 'duplicate',
        request: bounded,
      }
    }
  }

  if (await runs.findActive(bounded.provider)) {
    return {
      enqueued: false,
      status: 'duplicate',
      request: bounded,
    }
  }

  const jobId = deterministicExternalMaterialJobId(
    bounded.provider,
    bounded.mode,
  )
  if (bounded.mode === 'scheduled' && queue.getJob) {
    const oldJob = await queue.getJob(jobId)
    if (oldJob) {
      const oldState = await oldJob.getState()
      if (oldState === 'completed' || oldState === 'failed') {
        await oldJob.remove()
      } else {
        return {
          enqueued: false,
          status: 'duplicate',
          request: bounded,
        }
      }
    }
  }

  let run: { _id: unknown; status?: string }
  try {
    run = await runs.create({
      provider: bounded.provider,
      mode: bounded.mode,
      dryRun: bounded.dryRun,
      request: {
        recentDays: bounded.recentDays,
        limit: bounded.limit,
      },
      status: 'queued',
      continuationPending: false,
      counters: emptyCounters(),
      errorSamples: [],
    })
  } catch (error) {
    if (duplicateKey(error)) {
      return {
        enqueued: false,
        status: 'duplicate',
        request: bounded,
      }
    }
    throw error
  }

  const runId = String(run._id)
  try {
    await queue.add(
      'sync',
      {
        runId,
        provider: bounded.provider,
        request: bounded,
      },
      {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
      },
    )
  } catch {
    await runs.update(runId, {
      status: 'failed',
      continuationPending: false,
      completedAt: new Date(),
      errorSamples: [{ category: 'queue' }],
    })
    throw new Error('external_material_enqueue_failed')
  }

  return {
    enqueued: true,
    status: 'queued',
    runId,
    request: bounded,
  }
}
