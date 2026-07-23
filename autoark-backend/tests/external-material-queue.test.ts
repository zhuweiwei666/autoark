/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'crypto'

const mockSchedule = jest.fn()
const mockQueueConstructor = jest.fn()
const mockWorkerConstructor = jest.fn()

jest.mock('node-cron', () => ({
  __esModule: true,
  default: { schedule: mockSchedule },
}))

jest.mock('bullmq', () => ({
  Queue: function Queue(...args: unknown[]) {
    mockQueueConstructor(...args)
  },
  Worker: function Worker(...args: unknown[]) {
    mockWorkerConstructor(...args)
  },
}))

import {
  GuangdadaApiError,
  GUANGDADA_LIMITS,
} from '../src/integration/guangdada/client'
import ExternalMaterialSyncRun from '../src/models/ExternalMaterialSyncRun'
import ExternalMaterialSyncState from '../src/models/ExternalMaterialSyncState'
import {
  SYNC_DEFAULTS,
  clampExternalMaterialSyncRequest,
  deterministicExternalMaterialJobId,
  enqueueExternalMaterialContinuation,
  enqueueExternalMaterialSync,
  ensureContinuationScheduled,
  externalMaterialContinuationJobId,
  failExpiredExternalMaterialClaim,
  parseExternalMaterialSyncRequest,
  recoverExpiredExternalMaterialClaims,
  reconcileExternalMaterialContinuations,
} from '../src/queue/externalMaterial.queue'
import {
  acquireExternalMaterialLock,
  checkpointExternalMaterialRunWithFence,
  claimExternalMaterialDelivery,
  closeExternalMaterialWorkerInstance,
  handleExternalMaterialWorkerFailure,
  processExternalMaterialSyncJob,
  releaseExternalMaterialLock,
  renewExternalMaterialExecutionLease,
  renewExternalMaterialLock,
  updateExternalMaterialRunWithFence,
} from '../src/queue/externalMaterial.worker'
import {
  EXTERNAL_MATERIAL_CRON_EXPRESSION,
  initExternalMaterialCron,
  runExternalMaterialCronTick,
} from '../src/cron/externalMaterial.cron'

const request = {
  provider: 'guangdada' as const,
  mode: 'scheduled' as const,
  dryRun: false,
  recentDays: 3,
  limit: 10,
}

const counters = () => ({
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

const job = (overrides: Record<string, unknown> = {}) => ({
  id: 'safe-job',
  data: { runId: 'run-1', provider: 'guangdada', request },
  attemptsMade: 0,
  opts: { attempts: 3 },
  updateProgress: jest.fn(),
  ...overrides,
})

const workerDependencies = (overrides: Record<string, unknown> = {}) => {
  const run = {
    _id: 'run-1',
    provider: 'guangdada',
    mode: request.mode,
    dryRun: request.dryRun,
    request: { recentDays: request.recentDays, limit: request.limit },
    status: 'queued',
    counters: counters(),
    cursor: null,
    deferCount: 0,
    continuationPending: false,
    continuationGeneration: 0,
    continuationJobId: null,
    continuationDueAt: null,
    resumeRequired: false,
    executionClaimJobId: null,
    executionClaimAttempt: null,
    executionClaimDeferCount: null,
    executionClaimToken: null,
    executionClaimGeneration: null,
    executionClaimExpiresAt: null,
  }
  return {
    featureEnabled: true,
    apiKeyPresent: true,
    redis: {
      set: jest.fn().mockResolvedValue('OK'),
      eval: jest.fn().mockResolvedValue(1),
    },
    runs: {
      get: jest.fn().mockResolvedValue(run),
      claimDelivery: jest.fn(
        async (
          runId: string,
          provider: string,
          delivery: {
            jobId: string
            attempt: number
            generation: number
            deferCount: number | null
            continuation: boolean
          },
          claimToken: string,
          _startedAt: Date,
          expiresAt: Date,
        ) =>
          runId === String(run._id) &&
          provider === run.provider &&
          ((delivery.continuation &&
            run.status === 'deferred' &&
            run.continuationPending === true &&
            delivery.jobId === run.continuationJobId &&
            delivery.deferCount === run.deferCount &&
            delivery.generation === run.continuationGeneration) ||
            (!delivery.continuation && run.status === 'queued'))
            ? {
                ...run,
                status: 'running',
                continuationPending: false,
                executionClaimJobId: delivery.jobId,
                executionClaimAttempt: delivery.attempt,
                executionClaimDeferCount: delivery.deferCount,
                executionClaimToken: claimToken,
                executionClaimGeneration: delivery.generation,
                executionClaimExpiresAt: expiresAt,
              }
            : null,
      ),
      restoreDelivery: jest.fn().mockResolvedValue(run),
      findRunningConflict: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(run),
      checkpoint: jest.fn().mockResolvedValue(run),
      renewExecutionLease: jest.fn().mockResolvedValue(run),
      failTerminalBackup: jest.fn().mockResolvedValue(run),
      failClaimedDelivery: jest.fn().mockResolvedValue(run),
    },
    states: {
      get: jest.fn().mockResolvedValue({
        provider: 'guangdada',
        paused: false,
        recurringEnabled: true,
        backfillCursor: null,
      }),
      update: jest.fn().mockResolvedValue(undefined),
    },
    fetchAds: jest.fn().mockResolvedValue({ data: [], pagination: {} }),
    normalizeAds: jest.fn().mockReturnValue([]),
    ingest: jest.fn(),
    enqueueContinuation: jest.fn().mockResolvedValue({ id: 'delayed-job' }),
    sleep: jest.fn().mockResolvedValue(undefined),
    setInterval: jest.fn().mockReturnValue(1),
    clearInterval: jest.fn(),
    now: () => new Date('2026-07-23T00:00:00.000Z'),
    ...overrides,
  } as any
}

const continuationJob = (id: string, attemptsMade: number, deferCount = 2) =>
  job({
    id,
    attemptsMade,
    data: {
      runId: 'run-1',
      provider: 'guangdada',
      request,
      continuation: true,
      deferCount,
      generation: deferCount,
    },
  })

const statefulContinuationDependencies = (
  restoreMode: 'success' | 'reject' | 'timeout',
) => {
  let run: Record<string, any> = {
    _id: 'run-1',
    provider: 'guangdada',
    mode: request.mode,
    dryRun: false,
    request: { recentDays: 3, limit: 10 },
    status: 'deferred',
    counters: counters(),
    cursor: null,
    deferCount: 2,
    continuationPending: true,
    continuationGeneration: 2,
    continuationJobId: 'continuation-job',
    continuationDueAt: new Date('2026-07-23T00:00:00.000Z'),
    resumeRequired: false,
    executionClaimJobId: null,
    executionClaimAttempt: null,
    executionClaimDeferCount: null,
    executionClaimToken: null,
    executionClaimGeneration: null,
    executionClaimExpiresAt: null,
  }
  let currentNow = new Date('2026-07-23T00:00:00.000Z')
  let resolveLateRestore: (() => void) | undefined
  const owns = (fence: {
    token: string
    jobId: string
    attempt: number
    generation: number
    deferCount: number | null
  }) =>
    run.status === 'running' &&
    run.executionClaimToken === fence.token &&
    run.executionClaimJobId === fence.jobId &&
    run.executionClaimAttempt === fence.attempt &&
    run.executionClaimGeneration === fence.generation &&
    run.executionClaimDeferCount === fence.deferCount
  const deps = workerDependencies({
    restoreAttempts: 1,
    restoreTimeoutMs: 5,
    claimLeaseTtlMs: 30_000,
    now: () => currentNow,
  })

  deps.runs.claimDelivery.mockImplementation(
    async (
      runId: string,
      provider: string,
      delivery: {
        jobId: string
        attempt: number
        generation: number
        deferCount: number | null
        continuation: boolean
      },
      claimToken: string,
      startedAt: Date,
      expiresAt: Date,
    ) => {
      if (
        runId !== String(run._id) ||
        provider !== run.provider ||
        delivery.continuation !== true ||
        delivery.deferCount !== run.deferCount ||
        delivery.generation !== run.continuationGeneration ||
        typeof delivery.jobId !== 'string' ||
        typeof claimToken !== 'string'
      ) {
        return null
      }
      const deferredClaim =
        run.status === 'deferred' &&
        run.continuationPending === true &&
        run.continuationJobId === delivery.jobId
      const sameDelivery =
        run.status === 'running' &&
        run.continuationPending === false &&
        run.executionClaimJobId === delivery.jobId &&
        run.executionClaimDeferCount === delivery.deferCount &&
        run.executionClaimGeneration === delivery.generation
      const retryClaim =
        sameDelivery &&
        (run.executionClaimAttempt < delivery.attempt ||
          (run.executionClaimAttempt === delivery.attempt &&
            run.executionClaimExpiresAt instanceof Date &&
            run.executionClaimExpiresAt.getTime() <= startedAt.getTime()))
      if (!deferredClaim && !retryClaim) return null
      run = {
        ...run,
        status: 'running',
        continuationPending: false,
        executionClaimJobId: delivery.jobId,
        executionClaimAttempt: delivery.attempt,
        executionClaimDeferCount: delivery.deferCount,
        executionClaimToken: claimToken,
        executionClaimGeneration: delivery.generation,
        executionClaimExpiresAt: expiresAt,
      }
      return { ...run }
    },
  )
  deps.runs.restoreDelivery.mockImplementation(
    (runId: string, fence: Parameters<typeof owns>[0]) => {
      const applyRestore = () => {
        if (
          runId === String(run._id) &&
          run.continuationPending === false &&
          owns(fence)
        ) {
          run = {
            ...run,
            status: 'deferred',
            continuationPending: true,
            executionClaimJobId: null,
            executionClaimAttempt: null,
            executionClaimDeferCount: null,
            executionClaimToken: null,
            executionClaimGeneration: null,
            executionClaimExpiresAt: null,
          }
        }
        return { ...run }
      }
      if (restoreMode === 'success') {
        return Promise.resolve(applyRestore())
      }
      if (restoreMode === 'reject') {
        return Promise.reject(new Error('unsafe restore detail'))
      }
      return new Promise((resolve) => {
        resolveLateRestore = () => resolve(applyRestore())
      })
    },
  )
  deps.runs.update.mockImplementation(
    async (
      _runId: string,
      update: Record<string, unknown>,
      fence: Parameters<typeof owns>[0],
    ) => {
      if (!fence || !owns(fence)) return null
      run = { ...run, ...update }
      return { ...run }
    },
  )
  deps.runs.checkpoint.mockImplementation(
    async (
      _runId: string,
      _cursor: string | null,
      update: Record<string, unknown>,
      fence: Parameters<typeof owns>[0],
    ) => {
      if (!fence || !owns(fence)) return null
      run = { ...run, ...update }
      return { ...run }
    },
  )
  deps.runs.renewExecutionLease.mockImplementation(
    async (
      _runId: string,
      fence: Parameters<typeof owns>[0],
      expiresAt: Date,
    ) => {
      if (!owns(fence)) return null
      run = { ...run, executionClaimExpiresAt: expiresAt }
      return { ...run }
    },
  )
  deps.runs.failClaimedDelivery.mockImplementation(
    async (
      runId: string,
      fence: Parameters<typeof owns>[0],
      completedAt: Date,
    ) => {
      if (runId === String(run._id) && owns(fence)) {
        run = {
          ...run,
          status: 'failed',
          completedAt,
          continuationPending: false,
          executionClaimJobId: null,
          executionClaimAttempt: null,
          executionClaimDeferCount: null,
          executionClaimToken: null,
          executionClaimGeneration: null,
          executionClaimExpiresAt: null,
        }
      }
      return { ...run }
    },
  )

  return {
    deps,
    getRun: () => ({ ...run }),
    setNow: (value: Date) => {
      currentNow = value
    },
    releaseLateRestore: () => resolveLateRestore?.(),
  }
}

const statefulInitialDeliveryDependencies = () => {
  let run: Record<string, any> = {
    _id: 'run-1',
    provider: 'guangdada',
    mode: request.mode,
    dryRun: false,
    request: { recentDays: 3, limit: 10 },
    status: 'queued',
    counters: counters(),
    cursor: null,
    deferCount: 0,
    continuationPending: false,
    continuationGeneration: 0,
    continuationJobId: null,
    continuationDueAt: null,
    resumeRequired: false,
    executionClaimJobId: null,
    executionClaimAttempt: null,
    executionClaimDeferCount: null,
    executionClaimToken: null,
    executionClaimGeneration: null,
    executionClaimExpiresAt: null,
  }
  let currentNow = new Date('2026-07-23T00:00:00.000Z')
  const deps = workerDependencies({
    claimLeaseTtlMs: 30_000,
    now: () => currentNow,
  })
  const owns = (fence: {
    token: string
    jobId: string
    attempt: number
    generation: number
    deferCount: number | null
  }) =>
    run.status === 'running' &&
    run.executionClaimToken === fence.token &&
    run.executionClaimJobId === fence.jobId &&
    run.executionClaimAttempt === fence.attempt &&
    run.executionClaimGeneration === fence.generation &&
    run.executionClaimDeferCount === fence.deferCount

  deps.runs.get.mockImplementation(async () => ({ ...run }))
  deps.runs.claimDelivery = jest.fn(
    async (
      runId: string,
      provider: string,
      delivery: {
        jobId: string
        attempt: number
        generation: number
        deferCount: number | null
        continuation: boolean
      },
      claimToken: string,
      startedAt: Date,
      expiresAt: Date,
    ) => {
      if (
        runId !== String(run._id) ||
        provider !== run.provider ||
        delivery.continuation ||
        delivery.generation !== 0 ||
        delivery.deferCount !== null
      ) {
        return null
      }
      const firstClaim =
        run.status === 'queued' && run.continuationPending === false
      const sameDelivery =
        run.status === 'running' &&
        run.executionClaimJobId === delivery.jobId &&
        run.executionClaimGeneration === delivery.generation &&
        run.executionClaimDeferCount === delivery.deferCount
      const higherAttempt =
        sameDelivery && run.executionClaimAttempt < delivery.attempt
      const expiredStalledAttempt =
        sameDelivery &&
        run.executionClaimAttempt === delivery.attempt &&
        run.executionClaimExpiresAt instanceof Date &&
        run.executionClaimExpiresAt.getTime() <= startedAt.getTime()
      if (!firstClaim && !higherAttempt && !expiredStalledAttempt) return null
      run = {
        ...run,
        status: 'running',
        executionClaimJobId: delivery.jobId,
        executionClaimAttempt: delivery.attempt,
        executionClaimDeferCount: delivery.deferCount,
        executionClaimToken: claimToken,
        executionClaimGeneration: delivery.generation,
        executionClaimExpiresAt: expiresAt,
        startedAt,
      }
      return { ...run }
    },
  )
  deps.runs.update.mockImplementation(
    async (
      _runId: string,
      update: Record<string, unknown>,
      fence: Parameters<typeof owns>[0],
    ) => {
      if (!fence || !owns(fence)) return null
      run = { ...run, ...update }
      return { ...run }
    },
  )
  deps.runs.checkpoint.mockImplementation(
    async (
      _runId: string,
      expectedCursor: string | null,
      update: Record<string, unknown>,
      fence: Parameters<typeof owns>[0],
    ) => {
      if (!fence || !owns(fence) || (run.cursor ?? null) !== expectedCursor) {
        return null
      }
      run = { ...run, ...update }
      return { ...run }
    },
  )
  deps.runs.renewExecutionLease = jest.fn(
    async (
      _runId: string,
      fence: Parameters<typeof owns>[0],
      expiresAt: Date,
    ) => {
      if (!fence || !owns(fence)) return null
      run = { ...run, executionClaimExpiresAt: expiresAt }
      return { ...run }
    },
  )
  deps.runs.restoreDelivery = jest.fn(
    async (_runId: string, fence: Parameters<typeof owns>[0]) => {
      if (!fence || !owns(fence)) return null
      run = {
        ...run,
        status: 'queued',
        startedAt: null,
        executionClaimJobId: null,
        executionClaimAttempt: null,
        executionClaimDeferCount: null,
        executionClaimToken: null,
        executionClaimGeneration: null,
        executionClaimExpiresAt: null,
      }
      return { ...run }
    },
  )
  deps.runs.failClaimedDelivery = jest.fn(
    async (
      _runId: string,
      fence: Parameters<typeof owns>[0],
      completedAt: Date,
    ) => {
      if (!fence || !owns(fence)) return null
      run = {
        ...run,
        status: 'failed',
        completedAt,
        executionClaimJobId: null,
        executionClaimAttempt: null,
        executionClaimDeferCount: null,
        executionClaimToken: null,
        executionClaimGeneration: null,
        executionClaimExpiresAt: null,
      }
      return { ...run }
    },
  )

  return {
    deps,
    getRun: () => ({ ...run }),
    setNow: (value: Date) => {
      currentNow = value
    },
  }
}

describe('external material sync models and request bounds', () => {
  it('defines every bounded mode and clamps against both mode and client limits', () => {
    expect(SYNC_DEFAULTS).toEqual({
      scheduled: { recentDays: 3, limit: 500 },
      backfill: { recentDays: 30, limit: 2000 },
      canary10: { recentDays: 3, limit: 10 },
      canary100: { recentDays: 3, limit: 100 },
    })

    expect(
      clampExternalMaterialSyncRequest({
        mode: 'backfill',
        dryRun: true,
        recentDays: 9999,
        limit: 9999,
      }),
    ).toEqual({
      provider: 'guangdada',
      mode: 'backfill',
      dryRun: true,
      recentDays: Math.min(30, GUANGDADA_LIMITS.recentDays),
      limit: 2000,
    })
  })

  it('rejects unknown keys, non-plain bodies, and non-boolean dryRun values', () => {
    expect(() =>
      parseExternalMaterialSyncRequest({
        mode: 'canary10',
        dryRun: false,
        unexpected: true,
      }),
    ).toThrow('invalid_sync_request')
    expect(() =>
      parseExternalMaterialSyncRequest(
        Object.assign(Object.create({ injected: true }), { mode: 'canary10' }),
      ),
    ).toThrow('invalid_sync_request')
    expect(() =>
      parseExternalMaterialSyncRequest({
        mode: 'canary10',
        dryRun: 'false',
      }),
    ).toThrow('invalid_sync_request')
  })

  it('stores only bounded state and run fields with a unique provider guard', () => {
    const stateSchema = ExternalMaterialSyncState.schema
    expect(stateSchema.path('provider').options).toMatchObject({
      enum: ['guangdada'],
      required: true,
    })
    expect(
      stateSchema.path('pauseReason').options.maxlength,
    ).toBeLessThanOrEqual(160)
    expect(
      stateSchema.path('backfillCursor').options.maxlength,
    ).toBeLessThanOrEqual(512)
    expect(stateSchema.indexes()).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          { provider: 1 },
          expect.objectContaining({ unique: true }),
        ]),
      ]),
    )

    const runSchema = ExternalMaterialSyncRun.schema
    expect(runSchema.path('provider').options.enum).toEqual(['guangdada'])
    expect(runSchema.path('mode').options.enum).toEqual([
      'scheduled',
      'backfill',
      'canary10',
      'canary100',
    ])
    expect(runSchema.path('request.limit').options.max).toBe(2000)
    expect(runSchema.path('cursor').options.maxlength).toBeLessThanOrEqual(512)
    expect(runSchema.path('deferredUntil')).toBeDefined()
    expect(runSchema.path('retryAfterMs').options.max).toBeLessThanOrEqual(
      60 * 60 * 1000,
    )
    expect(runSchema.path('deferCount').options.max).toBeLessThanOrEqual(3)
    expect(runSchema.path('continuationPending').options).toMatchObject({
      type: Boolean,
      default: false,
      required: true,
    })
    expect(
      runSchema.path('executionClaimJobId').options.maxlength,
    ).toBeLessThanOrEqual(200)
    expect(runSchema.path('executionClaimDeferCount').options.max).toBe(3)
    expect(runSchema.path('executionClaimDeferCount').options.min).toBe(0)
    expect(runSchema.path('continuationGeneration').options).toMatchObject({
      type: Number,
      default: 0,
      required: true,
    })
    expect(runSchema.path('continuationGeneration').options.max).toBeLessThan(
      1_000_001,
    )
    expect(
      runSchema.path('continuationJobId').options.maxlength,
    ).toBeLessThanOrEqual(200)
    expect(runSchema.path('continuationDueAt')).toBeDefined()
    expect(runSchema.path('resumeRequired').options).toMatchObject({
      type: Boolean,
      default: false,
      required: true,
    })
    expect(
      runSchema.path('executionClaimToken').options.maxlength,
    ).toBeLessThanOrEqual(64)
    expect(runSchema.path('executionClaimAttempt').options).toMatchObject({
      min: 0,
      max: 100,
    })
    expect(runSchema.path('executionClaimGeneration').options.max).toBe(
      runSchema.path('continuationGeneration').options.max,
    )
    expect(runSchema.path('executionClaimExpiresAt')).toBeDefined()
    expect(runSchema.path('errorSamples.category')).toBeDefined()
    expect(runSchema.path('rawRecord')).toBeUndefined()
    expect(runSchema.path('mediaUrl')).toBeUndefined()
    expect(runSchema.path('apiKey')).toBeUndefined()
    expect(runSchema.indexes()).toEqual(
      expect.arrayContaining([
        [
          { provider: 1 },
          expect.objectContaining({
            unique: true,
            partialFilterExpression: {
              $or: [
                { status: { $in: ['queued', 'running'] } },
                { status: 'deferred', continuationPending: true },
              ],
            },
          }),
        ],
      ]),
    )

    const cast = ExternalMaterialSyncRun.castObject({
      provider: 'guangdada',
      mode: 'scheduled',
      dryRun: false,
      request: { recentDays: '3', limit: '500' },
      status: 'deferred',
      counters: counters(),
      deferredUntil: '2026-07-23T00:01:00.000Z',
      retryAfterMs: '60000',
      deferCount: '1',
      continuationPending: false,
      continuationGeneration: '2',
      continuationJobId: 'continuation-job',
      continuationDueAt: '2026-07-23T00:01:00.000Z',
      resumeRequired: false,
      executionClaimJobId: 'safe-job',
      executionClaimAttempt: '2',
      executionClaimDeferCount: '1',
      executionClaimToken: 'claim-token-1',
      executionClaimGeneration: '2',
      executionClaimExpiresAt: '2026-07-23T00:02:00.000Z',
      rawRecord: { secret: true },
      mediaUrl: 'https://secret.invalid/media',
    })
    expect(cast).toMatchObject({
      request: { recentDays: 3, limit: 500 },
      retryAfterMs: 60_000,
      deferCount: 1,
      continuationPending: false,
      continuationGeneration: 2,
      continuationJobId: 'continuation-job',
      resumeRequired: false,
      executionClaimJobId: 'safe-job',
      executionClaimAttempt: 2,
      executionClaimDeferCount: 1,
      executionClaimToken: 'claim-token-1',
      executionClaimGeneration: 2,
    })
    expect(cast).not.toHaveProperty('rawRecord')
    expect(cast).not.toHaveProperty('mediaUrl')
    expect(new ExternalMaterialSyncRun(cast).validateSync()).toBeUndefined()
  })

  it('validates a zero-defer pause claim as an integer-bounded Mongoose document', async () => {
    const claimedPause = new ExternalMaterialSyncRun({
      provider: 'guangdada',
      mode: 'backfill',
      dryRun: false,
      request: { recentDays: 30, limit: 2000 },
      status: 'running',
      counters: counters(),
      deferCount: 0,
      continuationPending: false,
      continuationGeneration: 1,
      executionClaimJobId: 'external-material-guangdada-continuation-run-1-1',
      executionClaimAttempt: 0,
      executionClaimDeferCount: 0,
      executionClaimToken: 'claim-token-1',
      executionClaimGeneration: 1,
      executionClaimExpiresAt: new Date('2026-07-23T00:02:00.000Z'),
    })

    await expect(claimedPause.validate()).resolves.toBeUndefined()
    claimedPause.executionClaimDeferCount = 0.5
    await expect(claimedPause.validate()).rejects.toThrow()
    claimedPause.executionClaimDeferCount = -1
    await expect(claimedPause.validate()).rejects.toThrow()
    claimedPause.executionClaimDeferCount = 0
    claimedPause.executionClaimAttempt = 0.5
    await expect(claimedPause.validate()).rejects.toThrow()
  })
})

describe('external material queue admission', () => {
  it('uses a deterministic scheduled job id', () => {
    expect(deterministicExternalMaterialJobId('guangdada', 'scheduled')).toBe(
      deterministicExternalMaterialJobId('guangdada', 'scheduled'),
    )
    expect(deterministicExternalMaterialJobId('guangdada', 'scheduled')).toBe(
      'external-material-guangdada-scheduled',
    )
  })

  it('enqueues a real delayed continuation with deterministic bounded data', async () => {
    const queue = {
      getJob: jest.fn().mockResolvedValue(null),
      add: jest.fn().mockResolvedValue({ id: 'delayed-job' }),
    }
    const continuationId = externalMaterialContinuationJobId(
      'guangdada',
      'run-1',
      1,
    )

    await enqueueExternalMaterialContinuation(
      {
        runId: 'run-1',
        provider: 'guangdada',
        request,
        retryAfterMs: Number.MAX_SAFE_INTEGER,
        deferCount: 1,
      },
      { queue } as any,
    )

    expect(continuationId).toBe(
      externalMaterialContinuationJobId('guangdada', 'run-1', 1),
    )
    expect(queue.add).toHaveBeenCalledWith(
      'sync',
      {
        runId: 'run-1',
        provider: 'guangdada',
        request,
        continuation: true,
        deferCount: 1,
        generation: 1,
      },
      expect.objectContaining({
        jobId: continuationId,
        delay: 60 * 60 * 1000,
        attempts: 3,
      }),
    )
  })

  it.each(['waiting', 'delayed', 'active'])(
    'reuses an existing %s continuation job',
    async (state) => {
      const existing = {
        getState: jest.fn().mockResolvedValue(state),
        remove: jest.fn(),
      }
      const queue = {
        getJob: jest.fn().mockResolvedValue(existing),
        add: jest.fn(),
      }
      const intent = {
        runId: 'run-1',
        provider: 'guangdada' as const,
        request,
        deferCount: 1,
        generation: 3,
        jobId: externalMaterialContinuationJobId('guangdada', 'run-1', 3),
        dueAt: new Date('2026-07-23T00:01:00.000Z'),
      }

      await expect(
        ensureContinuationScheduled(intent, {
          queue: queue as any,
          now: () => new Date('2026-07-23T00:00:00.000Z'),
        }),
      ).resolves.toBe(existing)
      expect(existing.remove).not.toHaveBeenCalled()
      expect(queue.add).not.toHaveBeenCalled()
    },
  )

  it.each(['completed', 'failed'])(
    'removes and re-adds a terminal %s continuation job',
    async (state) => {
      const old = {
        getState: jest.fn().mockResolvedValue(state),
        remove: jest.fn().mockResolvedValue(undefined),
      }
      const added = { id: 're-added' }
      const queue = {
        getJob: jest.fn().mockResolvedValue(old),
        add: jest.fn().mockResolvedValue(added),
      }
      const intent = {
        runId: 'run-1',
        provider: 'guangdada' as const,
        request,
        deferCount: 1,
        generation: 3,
        jobId: externalMaterialContinuationJobId('guangdada', 'run-1', 3),
        dueAt: new Date('2026-07-23T00:01:00.000Z'),
      }

      await expect(
        ensureContinuationScheduled(intent, {
          queue: queue as any,
          now: () => new Date('2026-07-23T00:00:00.000Z'),
        }),
      ).resolves.toBe(added)
      expect(old.remove).toHaveBeenCalledTimes(1)
      expect(queue.add).toHaveBeenCalledWith(
        'sync',
        expect.objectContaining({ generation: 3 }),
        expect.objectContaining({ jobId: intent.jobId, delay: 60_000 }),
      )
    },
  )

  it('reconciles every valid pending continuation intent idempotently', async () => {
    const ensure = jest.fn().mockResolvedValue({ id: 'scheduled' })
    const pending = {
      _id: 'run-1',
      provider: 'guangdada',
      mode: 'scheduled',
      dryRun: false,
      request: { recentDays: 3, limit: 10 },
      status: 'deferred',
      deferCount: 1,
      continuationPending: true,
      continuationGeneration: 4,
      continuationJobId: 'external-material-guangdada-continuation-run-1-4',
      continuationDueAt: new Date('2026-07-23T00:01:00.000Z'),
    }

    await expect(
      reconcileExternalMaterialContinuations({ provider: 'guangdada' }, {
        runs: {
          findPending: jest.fn().mockResolvedValue([pending]),
        },
        ensure,
      } as any),
    ).resolves.toBe(1)
    expect(ensure).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        generation: 4,
        jobId: pending.continuationJobId,
        dueAt: pending.continuationDueAt,
      }),
      expect.any(Object),
    )
  })

  const expiredClaim = {
    _id: 'run-expired',
    provider: 'guangdada' as const,
    status: 'running',
    continuationPending: false,
    executionClaimJobId:
      'external-material-guangdada-continuation-run-expired-2',
    executionClaimAttempt: 0,
    executionClaimDeferCount: 0,
    executionClaimToken: 'expired-token',
    executionClaimGeneration: 2,
    executionClaimExpiresAt: new Date('2026-07-23T00:01:00.000Z'),
  }

  it.each(['failed', 'completed', 'missing'])(
    'recovers an expired claim only when its BullMQ job is terminal or proven %s',
    async (state) => {
      const failExpiredClaim = jest
        .fn()
        .mockResolvedValue({ _id: 'run-expired', status: 'failed' })
      const runs = {
        findExpiredClaims: jest.fn().mockResolvedValue([expiredClaim]),
        failExpiredClaim,
      }
      const queue = {
        getJob: jest
          .fn()
          .mockResolvedValue(
            state === 'missing'
              ? null
              : { getState: jest.fn().mockResolvedValue(state) },
          ),
      }

      await expect(
        recoverExpiredExternalMaterialClaims(
          { provider: 'guangdada' },
          {
            runs,
            queue: queue as any,
            now: () => new Date('2026-07-23T00:02:00.000Z'),
          },
        ),
      ).resolves.toBe(1)
      expect(runs.findExpiredClaims).toHaveBeenCalledWith(
        'guangdada',
        new Date('2026-07-23T00:02:00.000Z'),
        50,
      )
      expect(failExpiredClaim).toHaveBeenCalledWith(
        expiredClaim,
        new Date('2026-07-23T00:02:00.000Z'),
      )
    },
  )

  it('recovers an expired terminal initial delivery with its complete execution fence', async () => {
    const initialClaim = {
      ...expiredClaim,
      executionClaimJobId: 'external-material-guangdada-canary10',
      executionClaimAttempt: 2,
      executionClaimDeferCount: null,
      executionClaimGeneration: 0,
    }
    const runs = {
      findExpiredClaims: jest.fn().mockResolvedValue([initialClaim]),
      failExpiredClaim: jest
        .fn()
        .mockResolvedValue({ _id: 'run-expired', status: 'failed' }),
    }

    await expect(
      recoverExpiredExternalMaterialClaims(
        { provider: 'guangdada' },
        {
          runs,
          queue: {
            getJob: jest.fn().mockResolvedValue({
              getState: jest.fn().mockResolvedValue('failed'),
            }),
          } as any,
          now: () => new Date('2026-07-23T00:02:00.000Z'),
        },
      ),
    ).resolves.toBe(1)
    expect(runs.failExpiredClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        executionClaimJobId: 'external-material-guangdada-canary10',
        executionClaimAttempt: 2,
        executionClaimDeferCount: null,
        executionClaimGeneration: 0,
        executionClaimToken: 'expired-token',
      }),
      new Date('2026-07-23T00:02:00.000Z'),
    )
  })

  it.each(['waiting', 'delayed', 'active'])(
    'retains an expired claim while its BullMQ job is %s',
    async (state) => {
      const runs = {
        findExpiredClaims: jest.fn().mockResolvedValue([expiredClaim]),
        failExpiredClaim: jest.fn(),
      }
      const queue = {
        getJob: jest.fn().mockResolvedValue({
          getState: jest.fn().mockResolvedValue(state),
        }),
      }

      await expect(
        recoverExpiredExternalMaterialClaims(
          { provider: 'guangdada' },
          {
            runs,
            queue: queue as any,
            now: () => new Date('2026-07-23T00:02:00.000Z'),
          },
        ),
      ).resolves.toBe(0)
      expect(runs.failExpiredClaim).not.toHaveBeenCalled()
    },
  )

  it('treats a successor token CAS miss as a zero-side-effect stale snapshot', async () => {
    const runs = {
      findExpiredClaims: jest.fn().mockResolvedValue([expiredClaim]),
      failExpiredClaim: jest.fn().mockResolvedValue(null),
    }
    const queue = {
      getJob: jest.fn().mockResolvedValue({
        getState: jest.fn().mockResolvedValue('failed'),
      }),
    }

    await expect(
      recoverExpiredExternalMaterialClaims(
        { provider: 'guangdada' },
        {
          runs,
          queue: queue as any,
          now: () => new Date('2026-07-23T00:02:00.000Z'),
        },
      ),
    ).resolves.toBe(0)
    expect(runs.failExpiredClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        executionClaimToken: 'expired-token',
        executionClaimGeneration: 2,
      }),
      expect.any(Date),
    )
  })

  it('CAS-fences expired-claim terminalization by token, generation, job, and expiry', async () => {
    const completedAt = new Date('2026-07-23T00:02:00.000Z')
    const findOneAndUpdate = jest
      .spyOn(ExternalMaterialSyncRun, 'findOneAndUpdate')
      .mockResolvedValue(null)

    try {
      await expect(
        failExpiredExternalMaterialClaim(expiredClaim, completedAt),
      ).resolves.toBeNull()
      expect(findOneAndUpdate.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          _id: 'run-expired',
          provider: 'guangdada',
          status: 'running',
          continuationPending: false,
          executionClaimJobId:
            'external-material-guangdada-continuation-run-expired-2',
          executionClaimAttempt: 0,
          executionClaimDeferCount: 0,
          executionClaimToken: 'expired-token',
          executionClaimGeneration: 2,
          executionClaimExpiresAt: {
            $eq: expiredClaim.executionClaimExpiresAt,
            $lte: completedAt,
          },
        }),
      )
      expect(findOneAndUpdate.mock.calls[0]?.[1]).toEqual({
        $set: expect.objectContaining({
          status: 'failed',
          completedAt,
          continuationPending: false,
          continuationJobId: null,
          executionClaimJobId: null,
          executionClaimAttempt: null,
          executionClaimDeferCount: null,
          executionClaimToken: null,
          executionClaimGeneration: null,
          executionClaimExpiresAt: null,
        }),
        $push: {
          errorSamples: {
            $each: [{ category: 'unexpected', at: completedAt }],
            $slice: -5,
          },
        },
      })
    } finally {
      findOneAndUpdate.mockRestore()
    }
  })

  it('retains expired claims when Mongo is unavailable and retries next time', async () => {
    const runs = {
      findExpiredClaims: jest
        .fn()
        .mockRejectedValueOnce(new Error('unsafe mongo details'))
        .mockResolvedValueOnce([expiredClaim]),
      failExpiredClaim: jest
        .fn()
        .mockResolvedValue({ _id: 'run-expired', status: 'failed' }),
    }
    const queue = {
      getJob: jest.fn().mockResolvedValue({
        getState: jest.fn().mockResolvedValue('failed'),
      }),
    }
    const dependencies = {
      runs,
      queue: queue as any,
      now: () => new Date('2026-07-23T00:02:00.000Z'),
    }

    await expect(
      recoverExpiredExternalMaterialClaims(
        { provider: 'guangdada' },
        dependencies,
      ),
    ).rejects.toThrow()
    expect(runs.failExpiredClaim).not.toHaveBeenCalled()
    await expect(
      recoverExpiredExternalMaterialClaims(
        { provider: 'guangdada' },
        dependencies,
      ),
    ).resolves.toBe(1)
    expect(runs.failExpiredClaim).toHaveBeenCalledTimes(1)
  })

  it('rejects a scheduled overlap before creating a run', async () => {
    const queue = {
      getJobs: jest
        .fn()
        .mockResolvedValue([
          { data: { provider: 'guangdada', request: { mode: 'scheduled' } } },
        ]),
      add: jest.fn(),
    }
    const runs = {
      findActive: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    }

    await expect(
      enqueueExternalMaterialSync(request, {
        queue,
        runs,
        featureEnabled: true,
        apiKeyPresent: true,
      } as any),
    ).resolves.toMatchObject({ enqueued: false, status: 'duplicate' })
    expect(queue.getJobs).toHaveBeenCalledWith(['waiting', 'active', 'delayed'])
    expect(runs.create).not.toHaveBeenCalled()
    expect(queue.add).not.toHaveBeenCalled()
  })

  it('treats a persisted deferred continuation run as an active overlap', async () => {
    const queue = {
      getJobs: jest.fn().mockResolvedValue([]),
      add: jest.fn(),
    }
    const runs = {
      findActive: jest.fn().mockResolvedValue({
        _id: 'run-1',
        status: 'deferred',
        continuationPending: true,
        deferredUntil: new Date('2026-07-23T00:01:00.000Z'),
      }),
      create: jest.fn(),
      update: jest.fn(),
    }

    await expect(
      enqueueExternalMaterialSync(request, {
        queue,
        runs,
        featureEnabled: true,
        apiKeyPresent: true,
      } as any),
    ).resolves.toMatchObject({ enqueued: false, status: 'duplicate' })
    expect(runs.findActive).toHaveBeenCalledWith('guangdada')
    expect(runs.create).not.toHaveBeenCalled()
    expect(queue.add).not.toHaveBeenCalled()
  })

  it.each(['canary10', 'scheduled'] as const)(
    'recovers expired claims before the %s enqueue active-run guard',
    async (mode) => {
      const queue = {
        getJobs: jest.fn().mockResolvedValue([]),
        getJob: jest.fn().mockResolvedValue(null),
        add: jest.fn().mockResolvedValue({ id: `${mode}-job` }),
      }
      const recoverExpiredClaims = jest.fn().mockResolvedValue(1)
      const runs = {
        findActive: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockResolvedValue({ _id: 'run-new', status: 'queued' }),
        update: jest.fn(),
      }

      await expect(
        enqueueExternalMaterialSync({ ...request, mode }, {
          queue,
          runs,
          featureEnabled: true,
          apiKeyPresent: true,
          recoverExpiredClaims,
        } as any),
      ).resolves.toMatchObject({ enqueued: true, runId: 'run-new' })
      expect(recoverExpiredClaims).toHaveBeenCalledWith('guangdada')
      expect(recoverExpiredClaims.mock.invocationCallOrder[0]).toBeLessThan(
        runs.findActive.mock.invocationCallOrder[0],
      )
    },
  )

  it('queries only queued, running, and continuation-backed deferred runs as active', async () => {
    const lean = jest.fn().mockResolvedValue({
      _id: 'run-pending',
      status: 'deferred',
      continuationPending: true,
    })
    const findOne = jest
      .spyOn(ExternalMaterialSyncRun, 'findOne')
      .mockReturnValue({ lean } as any)
    const queue = {
      getJobs: jest.fn().mockResolvedValue([]),
      add: jest.fn(),
    }

    try {
      await expect(
        enqueueExternalMaterialSync(request, {
          queue,
          featureEnabled: true,
          apiKeyPresent: true,
        }),
      ).resolves.toMatchObject({ enqueued: false, status: 'duplicate' })
      expect(findOne).toHaveBeenCalledWith({
        provider: 'guangdada',
        $or: [
          { status: { $in: ['queued', 'running'] } },
          { status: 'deferred', continuationPending: true },
        ],
      })
    } finally {
      findOne.mockRestore()
    }
  })

  it('enforces one active provider run and enqueues a bounded safe payload', async () => {
    const queue = {
      getJobs: jest.fn().mockResolvedValue([]),
      add: jest.fn().mockResolvedValue({ id: 'internal-job-id' }),
    }
    const runs = {
      findActive: jest.fn().mockResolvedValueOnce(null),
      create: jest.fn().mockResolvedValue({ _id: 'run-1', status: 'queued' }),
      update: jest.fn(),
    }

    const result = await enqueueExternalMaterialSync(
      {
        ...request,
        recentDays: 500,
        limit: 5000,
      },
      {
        queue,
        runs,
        featureEnabled: true,
        apiKeyPresent: true,
      } as any,
    )

    expect(result).toMatchObject({ enqueued: true, status: 'queued' })
    expect(runs.findActive).toHaveBeenCalledWith('guangdada')
    expect(runs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'guangdada',
        mode: 'scheduled',
        request: { recentDays: 3, limit: 500 },
      }),
    )
    expect(queue.add).toHaveBeenCalledWith(
      'sync',
      {
        runId: 'run-1',
        provider: 'guangdada',
        request: expect.objectContaining({ recentDays: 3, limit: 500 }),
      },
      expect.objectContaining({
        jobId: 'external-material-guangdada-scheduled',
        attempts: expect.any(Number),
      }),
    )
    expect(JSON.stringify(queue.add.mock.calls[0])).not.toContain(
      'internal-job-id',
    )
  })

  it('removes an old terminal scheduled job before reusing its deterministic id', async () => {
    const remove = jest.fn().mockResolvedValue(undefined)
    const queue = {
      getJobs: jest.fn().mockResolvedValue([]),
      getJob: jest.fn().mockResolvedValue({
        getState: jest.fn().mockResolvedValue('completed'),
        remove,
      }),
      add: jest.fn().mockResolvedValue({ id: 'internal-job-id' }),
    }
    const runs = {
      findActive: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ _id: 'run-2', status: 'queued' }),
      update: jest.fn(),
    }

    await enqueueExternalMaterialSync(request, {
      queue,
      runs,
      featureEnabled: true,
      apiKeyPresent: true,
    } as any)

    expect(queue.getJob).toHaveBeenCalledWith(
      'external-material-guangdada-scheduled',
    )
    expect(remove).toHaveBeenCalledTimes(1)
    expect(queue.add).toHaveBeenCalledTimes(1)
  })

  it('marks missing configuration disabled without creating a network job', async () => {
    const queue = { getJobs: jest.fn(), add: jest.fn() }
    const runs = {
      findActive: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ _id: 'run-disabled' }),
      update: jest.fn(),
    }

    const result = await enqueueExternalMaterialSync(request, {
      queue,
      runs,
      featureEnabled: true,
      apiKeyPresent: false,
    } as any)

    expect(result).toMatchObject({ enqueued: false, status: 'disabled' })
    expect(queue.getJobs).not.toHaveBeenCalled()
    expect(queue.add).not.toHaveBeenCalled()
    expect(runs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'disabled',
        errorSamples: [{ category: 'configuration' }],
      }),
    )
  })
})

describe('external material redis lock', () => {
  it('acquires with NX/PX and renews/releases only through owner-token Lua checks', async () => {
    const redis = {
      set: jest.fn().mockResolvedValue('OK'),
      eval: jest.fn().mockResolvedValue(1),
    }

    const owner = await acquireExternalMaterialLock(
      redis as any,
      'guangdada',
      45_000,
    )
    expect(owner).toMatch(/^[a-f0-9-]{16,}$/)
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('guangdada'),
      owner,
      'PX',
      45_000,
      'NX',
    )

    await expect(
      renewExternalMaterialLock(redis as any, 'guangdada', owner!, 45_000),
    ).resolves.toBe(true)
    await expect(
      releaseExternalMaterialLock(redis as any, 'guangdada', owner!),
    ).resolves.toBe(true)

    const [renewScript, renewKeyCount, renewKey, renewOwner] =
      redis.eval.mock.calls[0]
    const [releaseScript, releaseKeyCount, releaseKey, releaseOwner] =
      redis.eval.mock.calls[1]
    expect(renewScript).toContain('PEXPIRE')
    expect(renewScript).toContain('GET')
    expect(releaseScript).toContain('DEL')
    expect(releaseScript).toContain('GET')
    expect([renewKeyCount, releaseKeyCount]).toEqual([1, 1])
    expect(renewKey).toBe(releaseKey)
    expect([renewOwner, releaseOwner]).toEqual([owner, owner])
  })

  it('reports a lost or expired owner token without extending or deleting another lock', async () => {
    const redis = {
      eval: jest.fn().mockResolvedValue(0),
    }
    await expect(
      renewExternalMaterialLock(
        redis as any,
        'guangdada',
        'stale-owner',
        45_000,
      ),
    ).resolves.toBe(false)
    await expect(
      releaseExternalMaterialLock(redis as any, 'guangdada', 'stale-owner'),
    ).resolves.toBe(false)
  })

  it('scopes trusted integration lock operations to a cryptographically random test key', async () => {
    const testPrefix = `external-material-test-${randomUUID()}`
    const productionKey = 'external-material:sync-lock:guangdada'
    const redis = {
      set: jest.fn().mockResolvedValue('OK'),
      eval: jest.fn().mockResolvedValue(1),
    }

    const owner = await acquireExternalMaterialLock(
      redis,
      'guangdada',
      30_000,
      testPrefix,
    )
    await renewExternalMaterialLock(
      redis,
      'guangdada',
      owner,
      30_000,
      testPrefix,
    )
    await releaseExternalMaterialLock(redis, 'guangdada', owner, testPrefix)

    const acquiredKey = redis.set.mock.calls[0][0]
    const renewedKey = redis.eval.mock.calls[0][2]
    const releasedKey = redis.eval.mock.calls[1][2]
    expect(acquiredKey).toBe(
      `${testPrefix}:external-material:sync-lock:guangdada`,
    )
    expect([acquiredKey, renewedKey, releasedKey]).not.toContain(productionKey)
  })
})

describe('external material worker orchestration', () => {
  it('lets an expired stalled initial delivery be replaced and rejects every late owner write', async () => {
    const { deps, getRun, setNow } = statefulInitialDeliveryDependencies()
    let releaseOwnerA: (() => void) | undefined
    let markOwnerAStarted: (() => void) | undefined
    const ownerAStarted = new Promise<void>((resolve) => {
      markOwnerAStarted = resolve
    })
    deps.fetchAds
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            markOwnerAStarted?.()
            releaseOwnerA = () => resolve({ data: [], pagination: {} })
          }),
      )
      .mockResolvedValueOnce({ data: [], pagination: {} })
    const initialJob = job({ id: 'initial-job', attemptsMade: 0 })
    const ownerA = processExternalMaterialSyncJob(initialJob as any, deps)
    await ownerAStarted
    const ownerAFence = {
      token: getRun().executionClaimToken,
      jobId: 'initial-job',
      attempt: 0,
      generation: 0,
      deferCount: null,
    }

    try {
      setNow(new Date('2026-07-23T00:01:00.000Z'))
      await expect(
        processExternalMaterialSyncJob(initialJob as any, deps),
      ).resolves.toMatchObject({ status: 'completed' })
      expect(getRun()).toMatchObject({
        status: 'completed',
        executionClaimJobId: null,
        executionClaimAttempt: null,
        executionClaimToken: null,
        executionClaimGeneration: null,
        executionClaimExpiresAt: null,
      })
      const completed = getRun()

      await expect(
        deps.runs.checkpoint(
          'run-1',
          null,
          { cursor: 'late-checkpoint' },
          ownerAFence,
        ),
      ).resolves.toBeNull()
      await expect(
        deps.runs.update(
          'run-1',
          { status: 'completed', cursor: 'late-complete' },
          ownerAFence,
        ),
      ).resolves.toBeNull()
      await expect(
        deps.runs.update(
          'run-1',
          {
            status: 'failed',
            errorSamples: [{ category: 'lock_lost' }],
          },
          ownerAFence,
        ),
      ).resolves.toBeNull()
      expect(getRun()).toEqual(completed)
    } finally {
      releaseOwnerA?.()
      await expect(ownerA).resolves.toMatchObject({ status: 'stale' })
    }
  })

  it('rejects a same-attempt initial replacement while its execution lease is live', async () => {
    const { deps } = statefulInitialDeliveryDependencies()
    let releaseOwnerA: (() => void) | undefined
    let markOwnerAStarted: (() => void) | undefined
    const ownerAStarted = new Promise<void>((resolve) => {
      markOwnerAStarted = resolve
    })
    deps.fetchAds.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          markOwnerAStarted?.()
          releaseOwnerA = () => resolve({ data: [], pagination: {} })
        }),
    )
    const initialJob = job({ id: 'initial-job', attemptsMade: 0 })
    const ownerA = processExternalMaterialSyncJob(initialJob as any, deps)
    await ownerAStarted

    try {
      await expect(
        processExternalMaterialSyncJob(initialJob as any, deps),
      ).resolves.toMatchObject({ status: 'stale' })
      expect(deps.fetchAds).toHaveBeenCalledTimes(1)
    } finally {
      releaseOwnerA?.()
      await expect(ownerA).resolves.toMatchObject({ status: 'completed' })
    }
  })

  it('lets the same initial job reclaim ownership on a higher BullMQ attempt', async () => {
    const { deps, getRun } = statefulInitialDeliveryDependencies()
    let releaseOwnerA: (() => void) | undefined
    let markOwnerAStarted: (() => void) | undefined
    const ownerAStarted = new Promise<void>((resolve) => {
      markOwnerAStarted = resolve
    })
    deps.fetchAds
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            markOwnerAStarted?.()
            releaseOwnerA = () => resolve({ data: [], pagination: {} })
          }),
      )
      .mockResolvedValueOnce({ data: [], pagination: {} })
    const ownerA = processExternalMaterialSyncJob(
      job({ id: 'initial-job', attemptsMade: 0 }) as any,
      deps,
    )
    await ownerAStarted

    try {
      await expect(
        processExternalMaterialSyncJob(
          job({ id: 'initial-job', attemptsMade: 1 }) as any,
          deps,
        ),
      ).resolves.toMatchObject({ status: 'completed' })
      expect(getRun()).toMatchObject({ status: 'completed' })
    } finally {
      releaseOwnerA?.()
      await expect(ownerA).resolves.toMatchObject({ status: 'stale' })
    }
  })

  it('does not let a different initial job steal a live execution lease', async () => {
    const { deps } = statefulInitialDeliveryDependencies()
    let releaseOwnerA: (() => void) | undefined
    let markOwnerAStarted: (() => void) | undefined
    const ownerAStarted = new Promise<void>((resolve) => {
      markOwnerAStarted = resolve
    })
    deps.fetchAds.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          markOwnerAStarted?.()
          releaseOwnerA = () => resolve({ data: [], pagination: {} })
        }),
    )
    const ownerA = processExternalMaterialSyncJob(
      job({ id: 'initial-job', attemptsMade: 0 }) as any,
      deps,
    )
    await ownerAStarted

    try {
      await expect(
        processExternalMaterialSyncJob(
          job({ id: 'different-job', attemptsMade: 0 }) as any,
          deps,
        ),
      ).resolves.toMatchObject({ status: 'stale' })
      expect(deps.fetchAds).toHaveBeenCalledTimes(1)
    } finally {
      releaseOwnerA?.()
      await expect(ownerA).resolves.toMatchObject({ status: 'completed' })
    }
  })

  it('lets a higher initial BullMQ attempt reclaim after owned restore persistence fails', async () => {
    const coreError = new Error('unsafe initial attempt failure')
    const { deps, getRun } = statefulInitialDeliveryDependencies()
    deps.states.get.mockRejectedValueOnce(coreError)
    deps.runs.restoreDelivery.mockRejectedValue(
      new Error('mongo restore unavailable'),
    )

    await expect(
      processExternalMaterialSyncJob(
        job({ id: 'initial-job', attemptsMade: 0 }) as any,
        deps,
      ),
    ).rejects.toThrow(coreError)
    expect(getRun()).toMatchObject({
      status: 'running',
      executionClaimJobId: 'initial-job',
      executionClaimAttempt: 0,
      executionClaimToken: expect.any(String),
      executionClaimGeneration: 0,
    })

    await expect(
      processExternalMaterialSyncJob(
        job({ id: 'initial-job', attemptsMade: 1 }) as any,
        deps,
      ),
    ).resolves.toMatchObject({ status: 'completed' })
    expect(getRun()).toMatchObject({
      status: 'completed',
      executionClaimJobId: null,
      executionClaimAttempt: null,
      executionClaimToken: null,
    })
  })

  it('terminalizes a final initial attempt with its full ownership fence', async () => {
    const coreError = new Error('unsafe final initial failure')
    const { deps, getRun } = statefulInitialDeliveryDependencies()
    deps.states.get.mockRejectedValueOnce(coreError)

    await expect(
      processExternalMaterialSyncJob(
        job({ id: 'initial-job', attemptsMade: 2 }) as any,
        deps,
      ),
    ).rejects.toThrow(coreError)
    expect(deps.runs.restoreDelivery).not.toHaveBeenCalled()
    expect(deps.runs.failClaimedDelivery).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        token: expect.any(String),
        jobId: 'initial-job',
        attempt: 2,
        generation: 0,
        deferCount: null,
        continuation: false,
      }),
      new Date('2026-07-23T00:00:00.000Z'),
    )
    expect(getRun()).toMatchObject({
      status: 'failed',
      executionClaimJobId: null,
      executionClaimAttempt: null,
      executionClaimToken: null,
    })
  })

  it('atomically claims a pause continuation with deferCount zero', async () => {
    const claimed = new ExternalMaterialSyncRun({
      provider: 'guangdada',
      mode: 'backfill',
      dryRun: false,
      request: { recentDays: 30, limit: 2000 },
      status: 'running',
      counters: counters(),
      deferCount: 0,
      continuationPending: false,
      continuationGeneration: 1,
      executionClaimJobId: 'external-material-guangdada-continuation-run-1-1',
      executionClaimDeferCount: 0,
      executionClaimToken: 'claim-token-1',
      executionClaimGeneration: 1,
      executionClaimExpiresAt: new Date('2026-07-23T00:02:00.000Z'),
    })
    const findOneAndUpdate = jest
      .spyOn(ExternalMaterialSyncRun, 'findOneAndUpdate')
      .mockResolvedValue(claimed as any)

    try {
      await expect(
        claimExternalMaterialDelivery(
          'run-1',
          'guangdada',
          {
            jobId: 'external-material-guangdada-continuation-run-1-1',
            attempt: 0,
            generation: 1,
            deferCount: 0,
            continuation: true,
          },
          'claim-token-1',
          new Date('2026-07-23T00:00:00.000Z'),
          new Date('2026-07-23T00:02:00.000Z'),
        ),
      ).resolves.toBe(claimed)
      await expect(claimed.validate()).resolves.toBeUndefined()
      expect(findOneAndUpdate.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          $or: expect.arrayContaining([
            expect.objectContaining({
              deferCount: 0,
              continuationGeneration: 1,
            }),
          ]),
        }),
      )
      expect(findOneAndUpdate.mock.calls[0]?.[1]).toEqual({
        $set: expect.objectContaining({
          executionClaimDeferCount: 0,
          executionClaimGeneration: 1,
        }),
      })
    } finally {
      findOneAndUpdate.mockRestore()
    }
  })

  it('claims a continuation with one atomic guarded run transition', async () => {
    const claimed = {
      _id: 'run-1',
      provider: 'guangdada',
      status: 'running',
      continuationPending: false,
      deferCount: 2,
    }
    const findOneAndUpdate = jest
      .spyOn(ExternalMaterialSyncRun, 'findOneAndUpdate')
      .mockResolvedValue(claimed as any)
    const startedAt = new Date('2026-07-23T00:00:00.000Z')
    const expiresAt = new Date('2026-07-23T00:02:00.000Z')

    try {
      await expect(
        claimExternalMaterialDelivery(
          'run-1',
          'guangdada',
          {
            jobId: 'continuation-job',
            attempt: 0,
            generation: 2,
            deferCount: 2,
            continuation: true,
          },
          'claim-token-1',
          startedAt,
          expiresAt,
        ),
      ).resolves.toBe(claimed)
      expect(findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: 'run-1',
          provider: 'guangdada',
          $or: [
            {
              status: 'deferred',
              continuationPending: true,
              continuationJobId: 'continuation-job',
              deferCount: 2,
              continuationGeneration: 2,
            },
            {
              status: 'running',
              continuationPending: false,
              $or: [
                {
                  executionClaimJobId: 'continuation-job',
                  executionClaimAttempt: { $lt: 0 },
                  executionClaimDeferCount: 2,
                  executionClaimGeneration: 2,
                },
                {
                  executionClaimJobId: 'continuation-job',
                  executionClaimAttempt: 0,
                  executionClaimDeferCount: 2,
                  executionClaimGeneration: 2,
                  executionClaimExpiresAt: { $lte: startedAt },
                },
              ],
            },
          ],
        },
        {
          $set: {
            status: 'running',
            continuationPending: false,
            executionClaimJobId: 'continuation-job',
            executionClaimAttempt: 0,
            executionClaimDeferCount: 2,
            executionClaimToken: 'claim-token-1',
            executionClaimGeneration: 2,
            executionClaimExpiresAt: expiresAt,
            startedAt,
            deferredUntil: null,
            retryAfterMs: null,
          },
        },
        { new: true, runValidators: true },
      )
    } finally {
      findOneAndUpdate.mockRestore()
    }
  })

  it('reclaims a stalled delivery with unchanged attemptsMade only after lease expiry', async () => {
    const findOneAndUpdate = jest
      .spyOn(ExternalMaterialSyncRun, 'findOneAndUpdate')
      .mockResolvedValue(null)
    const beforeExpiry = new Date('2026-07-23T00:01:00.000Z')
    const afterExpiry = new Date('2026-07-23T00:03:00.000Z')

    try {
      await claimExternalMaterialDelivery(
        'run-1',
        'guangdada',
        {
          jobId: 'continuation-job',
          attempt: 0,
          generation: 2,
          deferCount: 2,
          continuation: true,
        },
        'replacement-token-before',
        beforeExpiry,
        new Date('2026-07-23T00:03:00.000Z'),
      )
      await claimExternalMaterialDelivery(
        'run-1',
        'guangdada',
        {
          jobId: 'continuation-job',
          attempt: 0,
          generation: 2,
          deferCount: 2,
          continuation: true,
        },
        'replacement-token-after',
        afterExpiry,
        new Date('2026-07-23T00:05:00.000Z'),
      )

      expect(findOneAndUpdate).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          $or: expect.arrayContaining([
            expect.objectContaining({
              $or: expect.arrayContaining([
                expect.objectContaining({
                  executionClaimJobId: 'continuation-job',
                  executionClaimAttempt: 0,
                  executionClaimGeneration: 2,
                  executionClaimExpiresAt: { $lte: beforeExpiry },
                }),
              ]),
            }),
          ]),
        }),
        expect.objectContaining({
          $set: expect.objectContaining({
            executionClaimToken: 'replacement-token-before',
          }),
        }),
        expect.any(Object),
      )
      expect(findOneAndUpdate).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          $or: expect.arrayContaining([
            expect.objectContaining({
              $or: expect.arrayContaining([
                expect.objectContaining({
                  executionClaimExpiresAt: { $lte: afterExpiry },
                }),
              ]),
            }),
          ]),
        }),
        expect.objectContaining({
          $set: expect.objectContaining({
            executionClaimToken: 'replacement-token-after',
          }),
        }),
        expect.any(Object),
      )
      expect(JSON.stringify(findOneAndUpdate.mock.calls)).not.toContain(
        'attemptsMade',
      )
    } finally {
      findOneAndUpdate.mockRestore()
    }
  })

  it('fences lease renewal, checkpoints, and terminal writes by the full delivery identity', async () => {
    const findOneAndUpdate = jest
      .spyOn(ExternalMaterialSyncRun, 'findOneAndUpdate')
      .mockResolvedValue(null)
    const fence = {
      token: 'old-token',
      jobId: 'continuation-job',
      attempt: 0,
      generation: 2,
      deferCount: 2,
      continuation: true,
    }
    const expiresAt = new Date('2026-07-23T00:02:00.000Z')

    try {
      await renewExternalMaterialExecutionLease('run-1', fence, expiresAt)
      await checkpointExternalMaterialRunWithFence('run-1', '7', fence, {
        cursor: '8',
        counters: counters(),
      })
      await updateExternalMaterialRunWithFence('run-1', fence, {
        status: 'completed',
      })

      for (const [filter] of findOneAndUpdate.mock.calls) {
        expect(filter).toMatchObject({
          _id: 'run-1',
          status: 'running',
          executionClaimToken: 'old-token',
          executionClaimJobId: 'continuation-job',
          executionClaimAttempt: 0,
          executionClaimDeferCount: 2,
          executionClaimGeneration: 2,
        })
      }
      expect(findOneAndUpdate).toHaveBeenNthCalledWith(
        1,
        expect.any(Object),
        {
          $set: { executionClaimExpiresAt: expiresAt },
        },
        { new: true, runValidators: true },
      )
      expect(findOneAndUpdate).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ cursor: '7' }),
        {
          $set: { cursor: '8', counters: counters() },
        },
        { new: true, runValidators: true },
      )
    } finally {
      findOneAndUpdate.mockRestore()
    }
  })

  it('uses the claim token as the fence for every continuation write and lease renewal', async () => {
    const deferredRun = {
      _id: 'run-1',
      provider: 'guangdada',
      status: 'deferred',
      counters: counters(),
      cursor: null,
      deferCount: 2,
      continuationPending: true,
      continuationGeneration: 2,
      continuationJobId: 'continuation-job',
    }
    const deps = workerDependencies()
    deps.runs.claimDelivery.mockResolvedValue({
      ...deferredRun,
      status: 'running',
      continuationPending: false,
    })

    await expect(
      processExternalMaterialSyncJob(
        continuationJob('continuation-job', 0) as any,
        deps,
      ),
    ).resolves.toMatchObject({ status: 'completed' })

    const claimCall = deps.runs.claimDelivery.mock.calls[0]
    expect(claimCall).toEqual([
      'run-1',
      'guangdada',
      {
        jobId: 'continuation-job',
        attempt: 0,
        generation: 2,
        deferCount: 2,
        continuation: true,
      },
      expect.stringMatching(/^[a-f0-9-]{16,}$/),
      new Date('2026-07-23T00:00:00.000Z'),
      new Date('2026-07-23T00:02:00.000Z'),
    ])
    const fence = {
      token: claimCall[3],
      jobId: 'continuation-job',
      attempt: 0,
      generation: 2,
      deferCount: 2,
      continuation: true,
    }
    expect(deps.runs.renewExecutionLease).toHaveBeenCalledWith(
      'run-1',
      fence,
      new Date('2026-07-23T00:02:00.000Z'),
    )
    expect(deps.runs.checkpoint).toHaveBeenCalledWith(
      'run-1',
      null,
      expect.objectContaining({ cursor: null }),
      fence,
    )
    expect(deps.runs.update).toHaveBeenLastCalledWith(
      'run-1',
      expect.objectContaining({ status: 'completed' }),
      fence,
    )
  })

  it('never fetches or ingests when the feature or key is unavailable', async () => {
    const deps = workerDependencies({ apiKeyPresent: false })

    await expect(
      processExternalMaterialSyncJob(job(), deps),
    ).resolves.toMatchObject({
      status: 'disabled',
    })
    expect(deps.fetchAds).not.toHaveBeenCalled()
    expect(deps.ingest).not.toHaveBeenCalled()
    expect(deps.runs.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'disabled',
        errorSamples: [{ category: 'configuration' }],
      }),
      expect.objectContaining({
        jobId: 'safe-job',
        attempt: 0,
        generation: 0,
      }),
    )
  })

  it('dry-run only fetches, normalizes, sorts, and counts without ingestion', async () => {
    const normalized = [
      {
        provider: 'guangdada',
        providerAssetKey: 'b',
        estimatedValue: 1,
        heat: 9,
      },
      {
        provider: 'guangdada',
        providerAssetKey: 'a',
        estimatedValue: 5,
        heat: 1,
      },
    ]
    const deps = workerDependencies({
      fetchAds: jest
        .fn()
        .mockResolvedValue({ data: [{ id: 1 }], pagination: {} }),
      normalizeAds: jest.fn().mockReturnValue(normalized),
    })

    const result = await processExternalMaterialSyncJob(
      job({
        data: {
          runId: 'run-1',
          provider: 'guangdada',
          request: { ...request, dryRun: true },
        },
      }),
      deps,
    )

    expect(result).toMatchObject({
      status: 'completed',
      counters: expect.objectContaining({
        discovered: 1,
        considered: 2,
        downloaded: 0,
      }),
    })
    expect(deps.ingest).not.toHaveBeenCalled()
    expect(deps.fetchAds).toHaveBeenCalledWith(
      expect.objectContaining({
        maxItems: 10,
        recentDays: 3,
        sortBy: 'estimated_value',
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('isolates candidates, retries retryable failures a bounded number, and updates counters', async () => {
    const assets = [
      { provider: 'guangdada', providerAssetKey: 'seen', estimatedValue: 9 },
      { provider: 'guangdada', providerAssetKey: 'created', estimatedValue: 8 },
      { provider: 'guangdada', providerAssetKey: 'bad', estimatedValue: 7 },
      { provider: 'guangdada', providerAssetKey: 'retry', estimatedValue: 6 },
    ]
    const retryable = {
      kind: 'failed',
      retryable: true,
      category: 'origin_mapping_failed',
      downloaded: false,
    }
    const ingest = jest
      .fn()
      .mockResolvedValueOnce({
        kind: 'alreadySeen',
        materialId: 'm1',
        downloaded: false,
      })
      .mockResolvedValueOnce({
        kind: 'created',
        materialId: 'm2',
        downloaded: true,
      })
      .mockResolvedValueOnce({
        kind: 'invalid',
        reason: 'invalid_candidate',
        downloaded: false,
      })
      .mockResolvedValueOnce(retryable)
      .mockResolvedValueOnce(retryable)
      .mockResolvedValueOnce(retryable)
    const deps = workerDependencies({
      fetchAds: jest
        .fn()
        .mockResolvedValue({ data: [{}, {}, {}, {}], pagination: {} }),
      normalizeAds: jest.fn().mockReturnValue(assets),
      ingest,
    })

    const result = await processExternalMaterialSyncJob(job(), deps)

    expect(ingest).toHaveBeenCalledTimes(6)
    expect(result).toMatchObject({
      status: 'completed',
      counters: {
        discovered: 4,
        considered: 4,
        alreadySeen: 1,
        downloaded: 1,
        contentReused: 0,
        newlyCreated: 1,
        invalid: 1,
        failed: 1,
        deferred: 0,
      },
    })
    expect(deps.runs.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        counters: expect.objectContaining({ failed: 1 }),
      }),
      expect.any(Object),
    )
  })

  it('counts a candidate download once when a later ingestion retry is pre-download reused', async () => {
    const asset = {
      provider: 'guangdada',
      providerAssetKey: 'retry-after-download',
      estimatedValue: 9,
    }
    const ingest = jest
      .fn()
      .mockResolvedValueOnce({
        kind: 'failed',
        retryable: true,
        category: 'origin_mapping_failed',
        downloaded: true,
      })
      .mockResolvedValueOnce({
        kind: 'alreadySeen',
        materialId: 'material-reused-on-retry',
        downloaded: false,
      })
    const deps = workerDependencies({
      fetchAds: jest
        .fn()
        .mockResolvedValue({ data: [{}], pagination: {} }),
      normalizeAds: jest.fn().mockReturnValue([asset]),
      ingest,
    })

    await expect(
      processExternalMaterialSyncJob(job(), deps),
    ).resolves.toMatchObject({
      status: 'completed',
      counters: expect.objectContaining({
        discovered: 1,
        considered: 1,
        alreadySeen: 1,
        downloaded: 1,
        failed: 0,
      }),
    })
    expect(ingest).toHaveBeenCalledTimes(2)
  })

  it('pauses recurring sync atomically on 401/403 without persisting provider error text', async () => {
    const deps = workerDependencies({
      fetchAds: jest.fn().mockRejectedValue(
        new GuangdadaApiError({
          message: 'secret-bearing unsafe message',
          category: 'authentication',
          status: 401,
          shouldPauseAuthentication: true,
        }),
      ),
    })

    const result = await processExternalMaterialSyncJob(job(), deps)

    expect(result).toMatchObject({ status: 'failed' })
    expect(deps.states.update).toHaveBeenCalledWith('guangdada', {
      paused: true,
      pauseReason: 'provider_authentication',
      recurringEnabled: false,
    })
    const persisted = JSON.stringify(deps.runs.update.mock.calls)
    expect(persisted).toContain('"category":"authentication"')
    expect(persisted).not.toContain('secret-bearing')
  })

  it('defers a 429 with a bounded persisted delayed continuation and does not spin', async () => {
    const deps = workerDependencies({
      fetchAds: jest.fn().mockRejectedValue(
        new GuangdadaApiError({
          message: 'unsafe rate response',
          category: 'rate_limit',
          status: 429,
          retryable: true,
          retryAfterMs: Number.MAX_SAFE_INTEGER,
        }),
      ),
    })

    const result = await processExternalMaterialSyncJob(job(), deps)

    expect(result).toMatchObject({
      status: 'deferred',
      retryAfterMs: expect.any(Number),
    })
    expect(result.retryAfterMs).toBeLessThanOrEqual(60 * 60 * 1000)
    expect(deps.fetchAds).toHaveBeenCalledTimes(1)
    expect(deps.sleep).not.toHaveBeenCalled()
    expect(deps.runs.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'deferred',
        deferredUntil: new Date('2026-07-23T01:00:00.000Z'),
        retryAfterMs: 60 * 60 * 1000,
        deferCount: 1,
        continuationPending: true,
        continuationGeneration: 1,
        continuationJobId: 'external-material-guangdada-continuation-run-1-1',
        continuationDueAt: new Date('2026-07-23T01:00:00.000Z'),
        resumeRequired: false,
      }),
      expect.any(Object),
    )
    expect(deps.enqueueContinuation).toHaveBeenCalledWith({
      runId: 'run-1',
      provider: 'guangdada',
      request,
      deferCount: 1,
      generation: 1,
      jobId: 'external-material-guangdada-continuation-run-1-1',
      dueAt: new Date('2026-07-23T01:00:00.000Z'),
    })
    expect(deps.runs.update.mock.invocationCallOrder[0]).toBeLessThan(
      deps.enqueueContinuation.mock.invocationCallOrder[0],
    )
    expect(JSON.stringify(deps.runs.update.mock.calls)).not.toContain(
      'completedAt',
    )
  })

  it('resumes a deferred continuation as running and clears its delay metadata', async () => {
    const deferredRun = {
      _id: 'run-1',
      provider: 'guangdada',
      mode: request.mode,
      dryRun: false,
      request: { recentDays: 3, limit: 10 },
      status: 'deferred',
      counters: counters(),
      cursor: null,
      deferCount: 1,
      continuationPending: true,
      deferredUntil: new Date('2026-07-23T00:00:00.000Z'),
      retryAfterMs: 60_000,
    }
    const deps = workerDependencies({
      runs: {
        get: jest.fn().mockResolvedValue(deferredRun),
        claimDelivery: jest.fn().mockResolvedValue({
          ...deferredRun,
          status: 'running',
          continuationPending: false,
        }),
        restoreDelivery: jest.fn().mockResolvedValue(deferredRun),
        findRunningConflict: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(deferredRun),
        checkpoint: jest.fn().mockResolvedValue(deferredRun),
        renewExecutionLease: jest.fn().mockResolvedValue(deferredRun),
        failTerminalBackup: jest.fn().mockResolvedValue(deferredRun),
        failClaimedDelivery: jest.fn().mockResolvedValue(deferredRun),
      },
    })

    await processExternalMaterialSyncJob(
      job({
        data: {
          runId: 'run-1',
          provider: 'guangdada',
          request,
          continuation: true,
          deferCount: 1,
          generation: 1,
        },
      }),
      deps,
    )

    expect(deps.runs.claimDelivery).toHaveBeenCalledWith(
      'run-1',
      'guangdada',
      {
        jobId: 'safe-job',
        attempt: 0,
        generation: 1,
        deferCount: 1,
        continuation: true,
      },
      expect.any(String),
      new Date('2026-07-23T00:00:00.000Z'),
      new Date('2026-07-23T00:02:00.000Z'),
    )
    expect(deps.runs.update.mock.calls).not.toEqual(
      expect.arrayContaining([
        [
          'run-1',
          expect.objectContaining({
            status: 'running',
          }),
        ],
      ]),
    )
  })

  const expectNoStaleContinuationSideEffects = (deps: any) => {
    expect(deps.runs.update).not.toHaveBeenCalled()
    expect(deps.states.get).not.toHaveBeenCalled()
    expect(deps.states.update).not.toHaveBeenCalled()
    expect(deps.redis.set).not.toHaveBeenCalled()
    expect(deps.redis.eval).not.toHaveBeenCalled()
    expect(deps.fetchAds).not.toHaveBeenCalled()
    expect(deps.normalizeAds).not.toHaveBeenCalled()
    expect(deps.ingest).not.toHaveBeenCalled()
    expect(deps.enqueueContinuation).not.toHaveBeenCalled()
  }

  it('reconciles a persisted 429 intent when queue scheduling failed', async () => {
    const queueError = new Error('queue temporarily unavailable')
    const original = workerDependencies({
      fetchAds: jest.fn().mockRejectedValue(
        new GuangdadaApiError({
          message: 'rate limited',
          category: 'rate_limit',
          status: 429,
          retryable: true,
          retryAfterMs: 60_000,
        }),
      ),
      enqueueContinuation: jest.fn().mockRejectedValue(queueError),
    })

    let schedulingError: unknown
    await processExternalMaterialSyncJob(
      job({ attemptsMade: 2 }),
      original,
    ).catch((error) => {
      schedulingError = error
    })
    expect(schedulingError).toEqual(
      expect.objectContaining({ message: queueError.message }),
    )
    await handleExternalMaterialWorkerFailure(
      job({ attemptsMade: 3 }) as any,
      schedulingError,
      original,
    )
    expect(original.runs.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'deferred',
        continuationPending: true,
        continuationGeneration: 1,
        continuationJobId: 'external-material-guangdada-continuation-run-1-1',
      }),
      expect.any(Object),
    )
    expect(original.enqueueContinuation).toHaveBeenCalledTimes(1)
    expect(original.runs.failTerminalBackup).not.toHaveBeenCalled()

    const persistedIntent = {
      _id: 'run-1',
      provider: 'guangdada',
      mode: request.mode,
      dryRun: false,
      request: { recentDays: 3, limit: 10 },
      status: 'deferred',
      counters: counters(),
      cursor: null,
      deferCount: 1,
      continuationPending: true,
      continuationGeneration: 1,
      continuationJobId: 'external-material-guangdada-continuation-run-1-1',
      continuationDueAt: new Date('2026-07-23T00:01:00.000Z'),
      resumeRequired: false,
    }
    const retry = workerDependencies({
      runs: {
        ...workerDependencies().runs,
        claimDelivery: jest.fn().mockResolvedValue(null),
        get: jest.fn().mockResolvedValue(persistedIntent),
        update: jest.fn(),
      },
    })

    await expect(
      processExternalMaterialSyncJob(job({ attemptsMade: 1 }), retry),
    ).resolves.toMatchObject({
      status: 'deferred',
    })
    expect(retry.enqueueContinuation).toHaveBeenCalledWith({
      runId: 'run-1',
      provider: 'guangdada',
      request,
      deferCount: 1,
      generation: 1,
      jobId: 'external-material-guangdada-continuation-run-1-1',
      dueAt: new Date('2026-07-23T00:01:00.000Z'),
    })
    expect(retry.runs.update).not.toHaveBeenCalled()
    expect(retry.states.get).not.toHaveBeenCalled()
    expect(retry.fetchAds).not.toHaveBeenCalled()
  })

  it('re-enqueues the current generation after an older continuation retry loses its claim', async () => {
    const currentIntent = {
      _id: 'run-1',
      provider: 'guangdada',
      mode: request.mode,
      dryRun: false,
      request: { recentDays: 3, limit: 10 },
      status: 'deferred',
      counters: { ...counters(), deferred: 2 },
      cursor: null,
      deferCount: 2,
      continuationPending: true,
      continuationGeneration: 2,
      continuationJobId:
        'external-material-guangdada-continuation-run-1-2',
      continuationDueAt: new Date('2026-07-23T00:02:00.000Z'),
      resumeRequired: false,
    }
    const deps = workerDependencies({
      runs: {
        ...workerDependencies().runs,
        claimDelivery: jest.fn().mockResolvedValue(null),
        get: jest.fn().mockResolvedValue(currentIntent),
      },
    })

    await expect(
      processExternalMaterialSyncJob(
        continuationJob(
          'external-material-guangdada-continuation-run-1-1',
          1,
          1,
        ),
        deps,
      ),
    ).resolves.toEqual({
      status: 'deferred',
      counters: currentIntent.counters,
    })
    expect(deps.runs.get).toHaveBeenCalledWith('run-1')
    expect(deps.enqueueContinuation).toHaveBeenCalledWith({
      runId: 'run-1',
      provider: 'guangdada',
      request,
      deferCount: 2,
      generation: 2,
      jobId: 'external-material-guangdada-continuation-run-1-2',
      dueAt: new Date('2026-07-23T00:02:00.000Z'),
    })
    expect(deps.runs.update).not.toHaveBeenCalled()
    expect(deps.fetchAds).not.toHaveBeenCalled()
  })

  it.each([
    ['feature disabled', { featureEnabled: false }],
    ['API key missing', { apiKeyPresent: false }],
  ])(
    'does not re-enqueue the current generation when %s',
    async (_case, gateOverride) => {
      const currentIntent = {
        _id: 'run-1',
        provider: 'guangdada',
        mode: request.mode,
        dryRun: false,
        request: { recentDays: 3, limit: 10 },
        status: 'deferred',
        counters: { ...counters(), deferred: 2 },
        cursor: null,
        deferCount: 2,
        continuationPending: true,
        continuationGeneration: 2,
        continuationJobId:
          'external-material-guangdada-continuation-run-1-2',
        continuationDueAt: new Date('2026-07-23T00:02:00.000Z'),
        resumeRequired: false,
      }
      const deps = workerDependencies({
        ...gateOverride,
        runs: {
          ...workerDependencies().runs,
          claimDelivery: jest.fn().mockResolvedValue(null),
          get: jest.fn().mockResolvedValue(currentIntent),
        },
      })

      await expect(
        processExternalMaterialSyncJob(
          continuationJob(
            'external-material-guangdada-continuation-run-1-1',
            1,
            1,
          ),
          deps,
        ),
      ).resolves.toEqual({
        status: 'deferred',
        counters: currentIntent.counters,
      })
      expect(deps.runs.get).toHaveBeenCalledWith('run-1')
      expect(deps.enqueueContinuation).not.toHaveBeenCalled()
      expect(deps.runs.update).not.toHaveBeenCalled()
      expect(deps.fetchAds).not.toHaveBeenCalled()
    },
  )

  it.each(['completed', 'failed'])(
    'ignores a continuation for a terminal %s run',
    async (status) => {
      const deps = workerDependencies()
      const terminalRun = {
        _id: 'run-1',
        provider: 'guangdada',
        status,
        continuationPending: false,
        deferCount: 1,
      }
      deps.runs.claimDelivery.mockImplementation(
        async (
          _runId: string,
          provider: string,
          delivery: { deferCount: number },
        ) =>
          terminalRun.status === 'deferred' &&
          terminalRun.continuationPending === true &&
          terminalRun.provider === provider &&
          terminalRun.deferCount === delivery.deferCount
            ? terminalRun
            : null,
      )
      deps.runs.get.mockResolvedValue(terminalRun)

      await expect(
        processExternalMaterialSyncJob(
          job({
            data: {
              runId: 'run-1',
              provider: 'guangdada',
              request,
              continuation: true,
              deferCount: 1,
              generation: 1,
            },
          }),
          deps,
        ),
      ).resolves.toMatchObject({
        status: 'stale',
        counters: counters(),
      })
      expect(deps.runs.claimDelivery).toHaveBeenCalledWith(
        'run-1',
        'guangdada',
        {
          jobId: 'safe-job',
          attempt: 0,
          generation: 1,
          deferCount: 1,
          continuation: true,
        },
        expect.any(String),
        new Date('2026-07-23T00:00:00.000Z'),
        new Date('2026-07-23T00:02:00.000Z'),
      )
      expectNoStaleContinuationSideEffects(deps)
    },
  )

  it('ignores an older defer count while atomically resuming the current count', async () => {
    const old = workerDependencies()
    old.runs.claimDelivery.mockResolvedValue(null)
    await expect(
      processExternalMaterialSyncJob(
        job({
          data: {
            runId: 'run-1',
            provider: 'guangdada',
            request,
            continuation: true,
            deferCount: 1,
            generation: 1,
          },
        }),
        old,
      ),
    ).resolves.toMatchObject({ status: 'stale' })
    expectNoStaleContinuationSideEffects(old)

    const currentRun = {
      _id: 'run-1',
      provider: 'guangdada',
      mode: request.mode,
      dryRun: false,
      request: { recentDays: 3, limit: 10 },
      status: 'running',
      counters: counters(),
      cursor: null,
      deferCount: 2,
      continuationPending: false,
    }
    const current = workerDependencies()
    current.runs.claimDelivery.mockResolvedValue(currentRun)
    await expect(
      processExternalMaterialSyncJob(
        job({
          data: {
            runId: 'run-1',
            provider: 'guangdada',
            request,
            continuation: true,
            deferCount: 2,
            generation: 2,
          },
        }),
        current,
      ),
    ).resolves.toMatchObject({ status: 'completed' })
    expect(current.runs.claimDelivery).toHaveBeenCalledWith(
      'run-1',
      'guangdada',
      {
        jobId: 'safe-job',
        attempt: 0,
        generation: 2,
        deferCount: 2,
        continuation: true,
      },
      expect.any(String),
      new Date('2026-07-23T00:00:00.000Z'),
      new Date('2026-07-23T00:02:00.000Z'),
    )
    expect(current.states.get).toHaveBeenCalledTimes(3)
    expect(current.fetchAds).toHaveBeenCalledTimes(1)
  })

  it('turns a paused sync into a recoverable same-run resume intent', async () => {
    const deps = workerDependencies({
      states: {
        get: jest.fn().mockResolvedValue({
          provider: 'guangdada',
          paused: true,
          recurringEnabled: false,
          backfillCursor: null,
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
    })

    await expect(
      processExternalMaterialSyncJob(job(), deps),
    ).resolves.toMatchObject({ status: 'deferred' })
    const resumeUpdate = deps.runs.update.mock.calls.at(-1)?.[1]
    expect(resumeUpdate).toEqual(
      expect.objectContaining({
        status: 'deferred',
        continuationPending: true,
        continuationGeneration: 1,
        continuationJobId: 'external-material-guangdada-continuation-run-1-1',
        continuationDueAt: new Date('2026-07-23T00:00:00.000Z'),
        resumeRequired: true,
        cursor: null,
        counters: counters(),
      }),
    )
    expect(resumeUpdate).toHaveProperty('completedAt', null)
    expect(deps.enqueueContinuation).not.toHaveBeenCalled()
  })

  it('turns a delayed continuation arriving paused into a newer resume intent', async () => {
    const deferredRun = {
      _id: 'run-1',
      provider: 'guangdada',
      mode: request.mode,
      dryRun: false,
      request: { recentDays: 3, limit: 10 },
      status: 'deferred',
      counters: counters(),
      cursor: null,
      deferCount: 1,
      continuationPending: true,
      continuationGeneration: 1,
      continuationJobId: 'external-material-guangdada-continuation-run-1-1',
      deferredUntil: new Date('2026-07-23T00:00:00.000Z'),
      retryAfterMs: 60_000,
    }
    const deps = workerDependencies({
      runs: {
        get: jest.fn().mockResolvedValue(deferredRun),
        claimDelivery: jest.fn().mockResolvedValue({
          ...deferredRun,
          status: 'running',
          continuationPending: false,
        }),
        restoreDelivery: jest.fn().mockResolvedValue(deferredRun),
        findRunningConflict: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(deferredRun),
        checkpoint: jest.fn().mockResolvedValue(deferredRun),
        failTerminalBackup: jest.fn().mockResolvedValue(deferredRun),
        failClaimedDelivery: jest.fn().mockResolvedValue(deferredRun),
      },
      states: {
        get: jest.fn(async () => ({
          provider: 'guangdada',
          paused: true,
          recurringEnabled: false,
          backfillCursor: null,
        })),
        update: jest.fn().mockResolvedValue(undefined),
      },
    })

    await expect(
      processExternalMaterialSyncJob(
        job({
          data: {
            runId: 'run-1',
            provider: 'guangdada',
            request,
            continuation: true,
            deferCount: 1,
            generation: 1,
          },
        }),
        deps,
      ),
    ).resolves.toMatchObject({ status: 'deferred' })
    const resumeUpdate = deps.runs.update.mock.calls.at(-1)?.[1]
    expect(resumeUpdate).toEqual(
      expect.objectContaining({
        status: 'deferred',
        continuationPending: true,
        continuationGeneration: 2,
        continuationJobId: 'external-material-guangdada-continuation-run-1-2',
        resumeRequired: true,
      }),
    )
    expect(resumeUpdate).toHaveProperty('completedAt', null)
    expect(deps.enqueueContinuation).not.toHaveBeenCalled()
  })

  it.each([
    ['after fetch', 2, 0],
    ['before an item', 3, 0],
    ['after ingestion', 4, 1],
    ['before batch commit', 5, 1],
  ])(
    're-reads pause state %s and preserves the same run checkpoint',
    async (_point, pauseRead, expectedIngestions) => {
      const stateGet = jest.fn()
      for (let index = 1; index < pauseRead; index += 1) {
        stateGet.mockResolvedValueOnce({
          provider: 'guangdada',
          paused: false,
          recurringEnabled: true,
          backfillCursor: null,
        })
      }
      stateGet.mockResolvedValueOnce({
        provider: 'guangdada',
        paused: true,
        recurringEnabled: false,
        backfillCursor: null,
      })
      const deps = workerDependencies({
        states: { get: stateGet, update: jest.fn() },
        fetchAds: jest
          .fn()
          .mockResolvedValue({ data: [{ id: 'one' }], pagination: {} }),
        normalizeAds: jest.fn().mockReturnValue([
          {
            provider: 'guangdada',
            providerAssetKey: 'one',
          },
        ]),
        ingest: jest
          .fn()
          .mockResolvedValue({ kind: 'created', materialId: 'material-1' }),
      })

      await expect(
        processExternalMaterialSyncJob(job(), deps),
      ).resolves.toMatchObject({ status: 'deferred' })

      expect(deps.states.get).toHaveBeenCalledTimes(pauseRead)
      expect(deps.ingest).toHaveBeenCalledTimes(expectedIngestions)
      expect(deps.runs.checkpoint).not.toHaveBeenCalled()
      expect(deps.runs.update).toHaveBeenLastCalledWith(
        'run-1',
        expect.objectContaining({
          status: 'deferred',
          cursor: null,
          counters: expect.objectContaining({
            discovered: 0,
            newlyCreated: 0,
            deferred: 0,
          }),
          continuationPending: true,
          resumeRequired: true,
        }),
        expect.any(Object),
      )
    },
  )

  it.each([
    ['defer limit is exhausted', { deferCount: 3 }, undefined],
    [
      'continuation enqueue fails',
      { deferCount: 0 },
      new Error('unsafe queue'),
    ],
  ])('fails safely when %s', async (_case, runPatch, enqueueError) => {
    const run = {
      _id: 'run-1',
      provider: 'guangdada',
      mode: request.mode,
      dryRun: false,
      request: { recentDays: 3, limit: 10 },
      status: 'running',
      counters: counters(),
      cursor: null,
      continuationPending: false,
      continuationGeneration: 0,
      ...runPatch,
    }
    const deps = workerDependencies({
      runs: {
        get: jest.fn().mockResolvedValue(run),
        claimDelivery: jest.fn().mockResolvedValue({
          ...run,
          status: 'running',
          executionClaimJobId: 'safe-job',
          executionClaimAttempt: 0,
          executionClaimDeferCount: null,
          executionClaimToken: 'claim-token',
          executionClaimGeneration: 0,
          executionClaimExpiresAt: new Date('2026-07-23T00:02:00.000Z'),
        }),
        restoreDelivery: jest.fn().mockResolvedValue(run),
        findRunningConflict: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(run),
        checkpoint: jest.fn().mockResolvedValue(run),
        renewExecutionLease: jest.fn().mockResolvedValue(run),
        failTerminalBackup: jest.fn().mockResolvedValue(run),
        failClaimedDelivery: jest.fn().mockResolvedValue(run),
      },
      fetchAds: jest.fn().mockRejectedValue(
        new GuangdadaApiError({
          message: 'unsafe rate response',
          category: 'rate_limit',
          status: 429,
          retryable: true,
          retryAfterMs: 60_000,
        }),
      ),
      enqueueContinuation: enqueueError
        ? jest.fn().mockRejectedValue(enqueueError)
        : jest.fn(),
    })

    const processing = processExternalMaterialSyncJob(job(), deps)
    if (enqueueError) {
      await expect(processing).rejects.toThrow(enqueueError)
    } else {
      await expect(processing).resolves.toMatchObject({ status: 'failed' })
    }
    expect(JSON.stringify(deps.runs.update.mock.calls)).not.toContain('unsafe')
    if (run.deferCount === 3) {
      expect(deps.runs.update).toHaveBeenLastCalledWith(
        'run-1',
        expect.objectContaining({
          status: 'failed',
          continuationPending: false,
          errorSamples: expect.arrayContaining([
            expect.objectContaining({ category: 'rate_limit' }),
          ]),
        }),
        expect.any(Object),
      )
      expect(deps.enqueueContinuation).not.toHaveBeenCalled()
    } else {
      expect(deps.runs.update).toHaveBeenLastCalledWith(
        'run-1',
        expect.objectContaining({
          status: 'deferred',
          continuationPending: true,
          continuationGeneration: 1,
        }),
        expect.any(Object),
      )
    }
  })

  it('retries 5xx/network fetches a bounded number with capped backoff', async () => {
    const error = new GuangdadaApiError({
      message: 'unsafe upstream detail',
      category: 'server',
      status: 503,
      retryable: true,
    })
    const fetchAds = jest
      .fn()
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ data: [], pagination: {} })
    const deps = workerDependencies({ fetchAds })

    await expect(
      processExternalMaterialSyncJob(job(), deps),
    ).resolves.toMatchObject({
      status: 'completed',
    })
    expect(fetchAds).toHaveBeenCalledTimes(3)
    expect(deps.sleep).toHaveBeenCalledTimes(2)
    expect(Math.max(...deps.sleep.mock.calls.flat())).toBeLessThanOrEqual(
      30_000,
    )
  })

  it('stops before another candidate when lock ownership is lost', async () => {
    const redis = {
      set: jest.fn().mockResolvedValue('OK'),
      eval: jest
        .fn()
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValue(0),
    }
    const deps = workerDependencies({
      redis,
      fetchAds: jest.fn().mockResolvedValue({ data: [{}, {}], pagination: {} }),
      normalizeAds: jest.fn().mockReturnValue([
        { provider: 'guangdada', providerAssetKey: 'first' },
        { provider: 'guangdada', providerAssetKey: 'second' },
      ]),
      ingest: jest
        .fn()
        .mockResolvedValue({ kind: 'created', materialId: 'm1' }),
    })

    const result = await processExternalMaterialSyncJob(job(), deps)

    expect(result).toMatchObject({ status: 'failed', retryable: true })
    expect(deps.ingest).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(deps.runs.update.mock.calls)).toContain('lock_lost')
    expect(deps.clearInterval).toHaveBeenCalled()
  })

  it('does not continue a retryable candidate after losing the lock during backoff', async () => {
    const redis = {
      set: jest.fn().mockResolvedValue('OK'),
      eval: jest
        .fn()
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValue(0),
    }
    const deps = workerDependencies({
      redis,
      fetchAds: jest.fn().mockResolvedValue({ data: [{}], pagination: {} }),
      normalizeAds: jest
        .fn()
        .mockReturnValue([
          { provider: 'guangdada', providerAssetKey: 'retrying' },
        ]),
      ingest: jest.fn().mockResolvedValue({
        kind: 'failed',
        retryable: true,
        category: 'network',
      }),
    })

    const result = await processExternalMaterialSyncJob(job(), deps)

    expect(result).toMatchObject({ status: 'failed', retryable: true })
    expect(deps.ingest).toHaveBeenCalledTimes(1)
    expect(deps.sleep).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(deps.runs.update.mock.calls)).toContain('lock_lost')
  })

  it('classifies a timer-detected lock loss during fetch as retryable lock loss', async () => {
    let renewalTick: (() => void) | undefined
    const redis = {
      set: jest.fn().mockResolvedValue('OK'),
      eval: jest.fn().mockResolvedValue(0),
    }
    const deps = workerDependencies({
      redis,
      setInterval: jest.fn((callback: () => void) => {
        renewalTick = callback
        return 1
      }),
      fetchAds: jest.fn(async () => {
        renewalTick?.()
        await Promise.resolve()
        await Promise.resolve()
        throw new GuangdadaApiError({
          message: 'request cancelled after lock loss',
          category: 'cancelled',
        })
      }),
    })

    const result = await processExternalMaterialSyncJob(job(), deps)

    expect(result).toMatchObject({ status: 'failed', retryable: true })
    const persisted = JSON.stringify(deps.runs.update.mock.calls)
    expect(persisted).toContain('lock_lost')
    expect(persisted).not.toContain('cancelled')
  })

  it('does not count or complete the unique final item after timer lock loss during ingest', async () => {
    let renewalTick: (() => void) | undefined
    const redis = {
      set: jest.fn().mockResolvedValue('OK'),
      eval: jest
        .fn()
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValue(0),
    }
    const deps = workerDependencies({
      redis,
      setInterval: jest.fn((callback: () => void) => {
        renewalTick = callback
        return 1
      }),
      fetchAds: jest
        .fn()
        .mockResolvedValue({ data: [{ id: 'only' }], pagination: {} }),
      normalizeAds: jest
        .fn()
        .mockReturnValue([{ provider: 'guangdada', providerAssetKey: 'only' }]),
      ingest: jest.fn(async () => {
        renewalTick?.()
        await Promise.resolve()
        await Promise.resolve()
        return { kind: 'created', materialId: 'm1' }
      }),
    })

    const result = await processExternalMaterialSyncJob(job(), deps)

    expect(result).toMatchObject({
      status: 'failed',
      retryable: true,
      counters: expect.objectContaining({
        newlyCreated: 0,
        downloaded: 0,
      }),
    })
    expect(deps.ingest).toHaveBeenCalledTimes(1)
    expect(deps.runs.checkpoint).not.toHaveBeenCalled()
    const persisted = JSON.stringify(deps.runs.update.mock.calls)
    expect(persisted).toContain('lock_lost')
    expect(persisted).not.toContain('"status":"completed"')
  })

  it.each(['normalize', 'checkpoint', 'progress'])(
    'lets an unexpected %s failure reach BullMQ retry handling',
    async (failurePoint) => {
      const unsafeError = new Error(`unsafe ${failurePoint} details`)
      const deps = workerDependencies({
        fetchAds: jest
          .fn()
          .mockResolvedValue({ data: [{ id: 'one' }], pagination: {} }),
        normalizeAds:
          failurePoint === 'normalize'
            ? jest.fn(() => {
                throw unsafeError
              })
            : jest.fn().mockReturnValue(
                failurePoint === 'progress'
                  ? [
                      {
                        provider: 'guangdada',
                        providerAssetKey: 'one',
                      },
                    ]
                  : [],
              ),
        ingest: jest
          .fn()
          .mockResolvedValue({ kind: 'alreadySeen', materialId: 'existing' }),
      })
      if (failurePoint === 'checkpoint') {
        deps.runs.checkpoint.mockRejectedValue(unsafeError)
      }
      const failingJob = job({
        updateProgress:
          failurePoint === 'progress'
            ? jest.fn().mockRejectedValue(unsafeError)
            : jest.fn(),
      })

      await expect(
        processExternalMaterialSyncJob(failingJob as any, deps),
      ).rejects.toThrow(unsafeError)
      expect(
        deps.runs.update.mock.calls.some(
          ([, update]: [string, Record<string, unknown>]) =>
            update.status === 'failed',
        ),
      ).toBe(false)
    },
  )

  it('awaits owned continuation restore before rethrowing a claimed core failure', async () => {
    const coreError = new Error('unsafe claimed core failure')
    const { deps, getRun } = statefulContinuationDependencies('success')
    deps.states.get.mockRejectedValueOnce(coreError)

    await expect(
      processExternalMaterialSyncJob(
        continuationJob('continuation-job', 0) as any,
        deps,
      ),
    ).rejects.toThrow(coreError)

    expect(deps.runs.restoreDelivery).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        token: expect.any(String),
        generation: 2,
      }),
    )
    expect(getRun()).toMatchObject({
      status: 'deferred',
      continuationPending: true,
      executionClaimJobId: null,
      executionClaimDeferCount: null,
      executionClaimToken: null,
      executionClaimGeneration: null,
      executionClaimExpiresAt: null,
    })
  })

  it.each(['reject', 'timeout'] as const)(
    'allows the same BullMQ delivery to reclaim only after a bounded %s restore lease expires',
    async (restoreMode) => {
      const coreError = new Error('unsafe first-attempt failure')
      const { deps, getRun, setNow, releaseLateRestore } =
        statefulContinuationDependencies(restoreMode)
      deps.states.get.mockRejectedValueOnce(coreError)

      await expect(
        processExternalMaterialSyncJob(
          continuationJob('continuation-job', 0) as any,
          deps,
        ),
      ).rejects.toThrow(coreError)
      expect(getRun()).toMatchObject({
        status: 'running',
        continuationPending: false,
        executionClaimJobId: 'continuation-job',
        executionClaimDeferCount: 2,
        executionClaimToken: expect.any(String),
        executionClaimGeneration: 2,
        executionClaimExpiresAt: new Date('2026-07-23T00:00:30.000Z'),
      })
      const expiredToken = getRun().executionClaimToken

      await expect(
        processExternalMaterialSyncJob(
          continuationJob('different-job', 0) as any,
          deps,
        ),
      ).resolves.toMatchObject({ status: 'stale' })

      await expect(
        processExternalMaterialSyncJob(
          continuationJob('continuation-job', 0) as any,
          deps,
        ),
      ).resolves.toMatchObject({ status: 'stale' })

      setNow(new Date('2026-07-23T00:01:00.000Z'))
      let releaseFetch: (() => void) | undefined
      let markFetchStarted: (() => void) | undefined
      const fetchStarted = new Promise<void>((resolve) => {
        markFetchStarted = resolve
      })
      deps.fetchAds.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            markFetchStarted?.()
            releaseFetch = () => resolve({ data: [], pagination: {} })
          }),
      )
      const retry = processExternalMaterialSyncJob(
        continuationJob('continuation-job', 0) as any,
        deps,
      )
      await fetchStarted
      expect(getRun()).toMatchObject({
        status: 'running',
        executionClaimJobId: 'continuation-job',
        executionClaimToken: expect.any(String),
        executionClaimGeneration: 2,
        executionClaimExpiresAt: new Date('2026-07-23T00:01:30.000Z'),
      })
      expect(getRun().executionClaimToken).not.toBe(expiredToken)

      releaseLateRestore()
      await Promise.resolve()
      expect(getRun()).toMatchObject({
        status: 'running',
        executionClaimToken: expect.any(String),
        executionClaimGeneration: 2,
      })
      releaseFetch?.()
      await expect(retry).resolves.toMatchObject({ status: 'completed' })
      expect(getRun()).toMatchObject({
        status: 'completed',
        continuationPending: false,
        executionClaimJobId: null,
        executionClaimDeferCount: null,
        executionClaimToken: null,
        executionClaimGeneration: null,
        executionClaimExpiresAt: null,
      })
    },
  )

  it('terminalizes a final claimed attempt in the processor before rethrowing', async () => {
    const coreError = new Error('unsafe final-attempt failure')
    const { deps, getRun } = statefulContinuationDependencies('reject')
    deps.states.get.mockRejectedValueOnce(coreError)

    await expect(
      processExternalMaterialSyncJob(
        continuationJob('continuation-job', 2) as any,
        deps,
      ),
    ).rejects.toThrow(coreError)

    expect(deps.runs.restoreDelivery).not.toHaveBeenCalled()
    expect(deps.runs.failClaimedDelivery).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        token: expect.any(String),
        generation: 2,
      }),
      new Date('2026-07-23T00:00:00.000Z'),
    )
    expect(getRun()).toMatchObject({
      status: 'failed',
      continuationPending: false,
      executionClaimJobId: null,
      executionClaimDeferCount: null,
      executionClaimToken: null,
      executionClaimGeneration: null,
      executionClaimExpiresAt: null,
    })
  })

  it('recovers an expired terminal job after final fenced persistence repeatedly fails', async () => {
    const coreError = new Error('unsafe final-attempt failure')
    const claimedRun = {
      _id: 'run-1',
      provider: 'guangdada',
      mode: request.mode,
      dryRun: false,
      request: { recentDays: 3, limit: 10 },
      status: 'running',
      counters: counters(),
      cursor: null,
      deferCount: 0,
      continuationPending: false,
      continuationGeneration: 1,
      executionClaimJobId: 'continuation-job',
      executionClaimAttempt: 2,
      executionClaimDeferCount: 0,
      executionClaimGeneration: 1,
      executionClaimExpiresAt: new Date('2026-07-23T00:02:00.000Z'),
    }
    const baseRuns = workerDependencies().runs
    const failClaimedDelivery = jest
      .fn()
      .mockRejectedValue(new Error('mongo unavailable'))
    const deps = workerDependencies({
      restoreAttempts: 2,
      runs: {
        ...baseRuns,
        claimDelivery: jest.fn().mockResolvedValue(claimedRun),
        failClaimedDelivery,
      },
    })
    deps.states.get.mockRejectedValueOnce(coreError)
    const finalJob = continuationJob('continuation-job', 2, 0)
    finalJob.data.generation = 1

    await expect(
      processExternalMaterialSyncJob(finalJob as any, deps),
    ).rejects.toThrow(coreError)
    expect(failClaimedDelivery).toHaveBeenCalledTimes(2)
    const claimToken = deps.runs.claimDelivery.mock.calls[0]?.[3]
    const snapshot = {
      ...claimedRun,
      executionClaimToken: claimToken,
    }
    const expiredRuns = {
      findExpiredClaims: jest.fn().mockResolvedValue([snapshot]),
      failExpiredClaim: jest
        .fn()
        .mockResolvedValue({ _id: 'run-1', status: 'failed' }),
    }

    await expect(
      recoverExpiredExternalMaterialClaims(
        { provider: 'guangdada' },
        {
          runs: expiredRuns,
          queue: {
            getJob: jest.fn().mockResolvedValue({
              getState: jest.fn().mockResolvedValue('failed'),
            }),
          } as any,
          now: () => new Date('2026-07-23T00:03:00.000Z'),
        },
      ),
    ).resolves.toBe(1)
    expect(expiredRuns.failExpiredClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        executionClaimToken: claimToken,
        executionClaimGeneration: 1,
        executionClaimJobId: 'continuation-job',
        executionClaimAttempt: 2,
      }),
      new Date('2026-07-23T00:03:00.000Z'),
    )
  })

  it('does not let a late intermediate failed event roll back a completed retry', async () => {
    const coreError = new Error('unsafe first-attempt failure')
    const { deps, getRun } = statefulContinuationDependencies('success')
    deps.states.get.mockRejectedValueOnce(coreError)

    await expect(
      processExternalMaterialSyncJob(
        continuationJob('continuation-job', 0) as any,
        deps,
      ),
    ).rejects.toThrow(coreError)
    await expect(
      processExternalMaterialSyncJob(
        continuationJob('continuation-job', 1) as any,
        deps,
      ),
    ).resolves.toMatchObject({ status: 'completed' })

    deps.runs.restoreDelivery.mockResolvedValueOnce(null)
    await handleExternalMaterialWorkerFailure(
      continuationJob('continuation-job', 1) as any,
      coreError,
      deps,
    )

    expect(deps.runs.restoreDelivery).toHaveBeenCalledTimes(1)
    expect(getRun()).toMatchObject({
      status: 'completed',
      continuationPending: false,
    })
  })

  it('keeps the failed event as a no-op backup for intermediate failures', async () => {
    const deps = workerDependencies()
    await handleExternalMaterialWorkerFailure(
      job({
        attemptsMade: 1,
        opts: { attempts: 3 },
        data: {
          runId: 'run-1',
          provider: 'guangdada',
          request,
          continuation: true,
          deferCount: 2,
          generation: 2,
        },
      }) as any,
      new Error('unsafe transient failure'),
      deps,
    )

    expect(deps.runs.restoreDelivery).not.toHaveBeenCalled()
    expect(deps.runs.failTerminalBackup).not.toHaveBeenCalled()
  })

  it('does not let a continuation failed event bypass the claim fence', async () => {
    const deps = workerDependencies()
    await handleExternalMaterialWorkerFailure(
      continuationJob('continuation-job', 3) as any,
      new Error('unsafe terminal failure'),
      deps,
    )

    expect(deps.runs.restoreDelivery).not.toHaveBeenCalled()
    expect(deps.runs.failTerminalBackup).not.toHaveBeenCalled()
    expect(deps.runs.failClaimedDelivery).not.toHaveBeenCalled()
  })

  it('only terminalizes an unexpected BullMQ failure after attempts are exhausted', async () => {
    const deps = workerDependencies()
    const unsafeError = new Error('unsafe provider payload')

    await handleExternalMaterialWorkerFailure(
      job({ attemptsMade: 2, opts: { attempts: 3 } }) as any,
      unsafeError,
      deps,
    )
    expect(deps.runs.failTerminalBackup).not.toHaveBeenCalled()

    await handleExternalMaterialWorkerFailure(
      job({ attemptsMade: 3, opts: { attempts: 3 } }) as any,
      unsafeError,
      deps,
    )
    expect(deps.runs.failTerminalBackup).toHaveBeenCalledWith(
      'run-1',
      'safe-job',
      2,
      new Date('2026-07-23T00:00:00.000Z'),
    )
    expect(
      JSON.stringify(deps.runs.failTerminalBackup.mock.calls),
    ).not.toContain('unsafe')
  })

  it('resumes backfill from a bounded cursor and persists the next page with progress', async () => {
    const deps = workerDependencies({
      states: {
        get: jest.fn().mockResolvedValue({
          provider: 'guangdada',
          paused: false,
          recurringEnabled: true,
          backfillCursor: '7',
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      fetchAds: jest.fn().mockResolvedValue({
        data: [{ id: 'record' }],
        pagination: { page: 7, has_more: true },
      }),
      normalizeAds: jest.fn().mockReturnValue([]),
    })

    await processExternalMaterialSyncJob(
      job({
        data: {
          runId: 'run-1',
          provider: 'guangdada',
          request: { ...request, mode: 'backfill' },
        },
      }),
      deps,
    )

    expect(deps.fetchAds).toHaveBeenCalledWith(
      expect.objectContaining({ page: 7 }),
    )
    expect(deps.states.update).toHaveBeenCalledWith('guangdada', {
      backfillCursor: '8',
    })
    expect(deps.runs.checkpoint).toHaveBeenCalledWith(
      'run-1',
      null,
      expect.objectContaining({ cursor: '8', counters: expect.any(Object) }),
      expect.any(Object),
    )
  })

  it('fetches a 2000-item backfill as two client-bounded batches and resumes after the saved cursor', async () => {
    const firstBatch = Array.from({ length: 1000 }, (_, index) => ({
      id: `a-${index}`,
    }))
    const secondBatch = Array.from({ length: 1000 }, (_, index) => ({
      id: `b-${index}`,
    }))
    const states = {
      get: jest.fn().mockResolvedValue({
        provider: 'guangdada',
        paused: false,
        recurringEnabled: true,
        backfillCursor: '7',
      }),
      update: jest.fn().mockResolvedValue(undefined),
    }
    const fetchAds = jest
      .fn()
      .mockResolvedValueOnce({
        data: firstBatch,
        pagination: { page: 16, has_more: true },
      })
      .mockResolvedValueOnce({
        data: secondBatch,
        pagination: { page: 26, has_more: true },
      })
    const deps = workerDependencies({
      states,
      fetchAds,
      normalizeAds: jest.fn().mockReturnValue([]),
    })

    const result = await processExternalMaterialSyncJob(
      job({
        data: {
          runId: 'run-1',
          provider: 'guangdada',
          request: {
            ...request,
            mode: 'backfill',
            recentDays: 30,
            limit: 2000,
            dryRun: true,
          },
        },
      }),
      deps,
    )

    expect(fetchAds).toHaveBeenCalledTimes(2)
    expect(fetchAds).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        page: 7,
        maxItems: GUANGDADA_LIMITS.totalItems,
      }),
    )
    expect(fetchAds).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        page: 17,
        maxItems: GUANGDADA_LIMITS.totalItems,
      }),
    )
    expect(states.update).not.toHaveBeenCalled()
    expect(deps.runs.checkpoint).toHaveBeenCalledTimes(2)
    expect(deps.runs.checkpoint).toHaveBeenNthCalledWith(
      1,
      'run-1',
      null,
      expect.objectContaining({
        cursor: '17',
        counters: expect.objectContaining({ discovered: 1000 }),
      }),
      expect.any(Object),
    )
    expect(deps.runs.checkpoint).toHaveBeenNthCalledWith(
      2,
      'run-1',
      '17',
      expect.objectContaining({
        cursor: '27',
        counters: expect.objectContaining({ discovered: 2000 }),
      }),
      expect.any(Object),
    )
    expect(result).toMatchObject({
      status: 'completed',
      counters: expect.objectContaining({ discovered: 2000 }),
      cursor: '27',
    })

    const resumedFetch = jest.fn().mockResolvedValue({
      data: [],
      pagination: { page: 27, has_more: false },
    })
    const resumed = workerDependencies({
      states: {
        get: jest.fn().mockResolvedValue({
          provider: 'guangdada',
          paused: false,
          recurringEnabled: true,
          backfillCursor: '27',
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      fetchAds: resumedFetch,
      normalizeAds: jest.fn().mockReturnValue([]),
    })
    await processExternalMaterialSyncJob(
      job({
        data: {
          runId: 'run-1',
          provider: 'guangdada',
          request: {
            ...request,
            mode: 'backfill',
            recentDays: 30,
            limit: 2000,
            dryRun: true,
          },
        },
      }),
      resumed,
    )
    expect(resumedFetch).toHaveBeenCalledWith(
      expect.objectContaining({ page: 27 }),
    )
  })

  it('replays an interrupted 1000-item batch without double-counting its run checkpoint', async () => {
    const firstBatch = Array.from({ length: 1000 }, (_, index) => ({
      id: `a-${index}`,
    }))
    const secondBatch = Array.from({ length: 1000 }, (_, index) => ({
      id: `b-${index}`,
    }))
    const normalizeAds = jest.fn((records: Array<{ id: string }>) =>
      records.map((record) => ({
        provider: 'guangdada',
        providerAssetKey: record.id,
      })),
    )
    const stateRecord = {
      provider: 'guangdada',
      paused: false,
      recurringEnabled: true,
      backfillCursor: '7',
    }
    const interruptedJob = job({
      data: {
        runId: 'run-1',
        provider: 'guangdada',
        request: {
          ...request,
          mode: 'backfill',
          recentDays: 30,
          limit: 2000,
        },
      },
      updateProgress: jest
        .fn()
        .mockRejectedValueOnce(new Error('progress storage unavailable')),
    })
    const interrupted = workerDependencies({
      states: {
        get: jest.fn().mockResolvedValue(stateRecord),
        update: jest.fn().mockResolvedValue(undefined),
      },
      fetchAds: jest.fn().mockResolvedValue({
        data: firstBatch,
        pagination: { page: 16, has_more: true },
      }),
      normalizeAds,
      ingest: jest
        .fn()
        .mockResolvedValue({ kind: 'alreadySeen', materialId: 'existing' }),
    })

    await expect(
      processExternalMaterialSyncJob(interruptedJob as any, interrupted),
    ).rejects.toThrow('progress storage unavailable')
    expect(interrupted.ingest).toHaveBeenCalledTimes(25)
    expect(interrupted.runs.checkpoint).not.toHaveBeenCalled()
    expect(interrupted.states.update).not.toHaveBeenCalled()
    expect(
      interrupted.runs.update.mock.calls.some(
        ([, update]: [string, Record<string, any>]) =>
          update.counters?.discovered === 1000,
      ),
    ).toBe(false)

    const restarted = workerDependencies({
      states: {
        get: jest.fn().mockResolvedValue(stateRecord),
        update: jest.fn().mockResolvedValue(undefined),
      },
      fetchAds: jest
        .fn()
        .mockResolvedValueOnce({
          data: firstBatch,
          pagination: { page: 16, has_more: true },
        })
        .mockResolvedValueOnce({
          data: secondBatch,
          pagination: { page: 26, has_more: true },
        }),
      normalizeAds,
      ingest: jest
        .fn()
        .mockResolvedValue({ kind: 'alreadySeen', materialId: 'existing' }),
    })

    const result = await processExternalMaterialSyncJob(
      job({
        data: interruptedJob.data,
      }),
      restarted,
    )

    expect(restarted.fetchAds).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ page: 7 }),
    )
    expect(restarted.fetchAds).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ page: 17 }),
    )
    expect(restarted.ingest).toHaveBeenCalledTimes(2000)
    expect(restarted.runs.checkpoint).toHaveBeenCalledTimes(2)
    expect(restarted.runs.checkpoint).toHaveBeenNthCalledWith(
      1,
      'run-1',
      null,
      expect.objectContaining({
        cursor: '17',
        counters: expect.objectContaining({
          discovered: 1000,
          alreadySeen: 1000,
        }),
      }),
      expect.any(Object),
    )
    expect(restarted.runs.checkpoint).toHaveBeenNthCalledWith(
      2,
      'run-1',
      '17',
      expect.objectContaining({
        cursor: '27',
        counters: expect.objectContaining({
          discovered: 2000,
          alreadySeen: 2000,
        }),
      }),
      expect.any(Object),
    )
    expect(result).toMatchObject({
      status: 'completed',
      counters: expect.objectContaining({
        discovered: 2000,
        alreadySeen: 2000,
      }),
    })
  })

  it('bounds graceful worker shutdown and force closes after the deadline', async () => {
    const pause = jest.fn().mockReturnValue(new Promise<void>(() => undefined))
    const close = jest.fn().mockResolvedValue(undefined)
    const waitForTimeout = jest.fn().mockResolvedValue(undefined)

    await closeExternalMaterialWorkerInstance(
      { pause, close },
      { gracefulTimeoutMs: 250, waitForTimeout },
    )

    expect(waitForTimeout).toHaveBeenCalledWith(250)
    expect(pause).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledWith(true)
  })

  it('closes normally after active work drains within the deadline', async () => {
    const pause = jest.fn().mockResolvedValue(undefined)
    const close = jest.fn().mockResolvedValue(undefined)
    const waitForTimeout = jest
      .fn()
      .mockReturnValue(new Promise<void>(() => undefined))

    await closeExternalMaterialWorkerInstance(
      { pause, close },
      { gracefulTimeoutMs: 250, waitForTimeout },
    )

    expect(pause).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledWith()
  })

  it('force closes when pausing the worker rejects', async () => {
    const pause = jest.fn().mockRejectedValue(new Error('pause failed'))
    const close = jest.fn().mockResolvedValue(undefined)
    const waitForTimeout = jest
      .fn()
      .mockReturnValue(new Promise<void>(() => undefined))

    await closeExternalMaterialWorkerInstance(
      { pause, close },
      { gracefulTimeoutMs: 250, waitForTimeout },
    )

    expect(pause).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledWith(true)
  })

  it('awaits normal close completion after the worker drains', async () => {
    let resolveClose!: () => void
    let closeStarted!: () => void
    const closeStartedPromise = new Promise<void>((resolve) => {
      closeStarted = resolve
    })
    const closePromise = new Promise<void>((resolve) => {
      resolveClose = resolve
    })
    const pause = jest.fn().mockResolvedValue(undefined)
    const close = jest.fn().mockImplementation(() => {
      closeStarted()
      return closePromise
    })
    const waitForTimeout = jest
      .fn()
      .mockReturnValue(new Promise<void>(() => undefined))
    let settled = false

    const shutdown = closeExternalMaterialWorkerInstance(
      { pause, close },
      { gracefulTimeoutMs: 250, waitForTimeout },
    ).finally(() => {
      settled = true
    })
    await closeStartedPromise

    expect(settled).toBe(false)
    resolveClose()
    await expect(shutdown).resolves.toBeUndefined()
    expect(settled).toBe(true)
  })

  it('propagates a normal close rejection after the worker drains', async () => {
    const closeError = new Error('worker close failed')
    const pause = jest.fn().mockResolvedValue(undefined)
    const close = jest.fn().mockRejectedValue(closeError)
    const waitForTimeout = jest
      .fn()
      .mockReturnValue(new Promise<void>(() => undefined))

    await expect(
      closeExternalMaterialWorkerInstance(
        { pause, close },
        { gracefulTimeoutMs: 250, waitForTimeout },
      ),
    ).rejects.toBe(closeError)
    expect(close).toHaveBeenCalledWith()
  })
})

describe('external material cron', () => {
  beforeEach(() => {
    mockSchedule.mockReset()
  })

  it('has no import-time schedule side effect and registers the six-hour expression once', () => {
    expect(mockSchedule).not.toHaveBeenCalled()
    const stop = jest.fn()
    mockSchedule.mockReturnValue({ stop })
    initExternalMaterialCron()
    expect(EXTERNAL_MATERIAL_CRON_EXPRESSION).toBe('0 */6 * * *')
    expect(mockSchedule).toHaveBeenCalledWith(
      EXTERNAL_MATERIAL_CRON_EXPRESSION,
      expect.any(Function),
    )
  })

  it.each([
    [
      'feature disabled',
      { EXTERNAL_MATERIAL_SYNC_ENABLED: 'false', GUANGDADA_API_KEY: 'key' },
    ],
    ['missing key', { EXTERNAL_MATERIAL_SYNC_ENABLED: 'true' }],
  ])('does not read state or enqueue when %s', async (_case, env) => {
    const states = { get: jest.fn() }
    const enqueue = jest.fn()
    const reconcile = jest.fn()
    const recoverExpiredClaims = jest.fn()
    await runExternalMaterialCronTick({
      env,
      states,
      enqueue,
      reconcile,
      recoverExpiredClaims,
    } as any)
    expect(states.get).not.toHaveBeenCalled()
    expect(reconcile).not.toHaveBeenCalled()
    expect(recoverExpiredClaims).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('only enqueues when state is unpaused and recurring remains enabled', async () => {
    const enqueue = jest.fn()
    const states = {
      get: jest
        .fn()
        .mockResolvedValueOnce({ paused: true, recurringEnabled: true })
        .mockResolvedValueOnce({ paused: false, recurringEnabled: false })
        .mockResolvedValueOnce(null),
    }
    const deps = {
      env: {
        EXTERNAL_MATERIAL_SYNC_ENABLED: 'true',
        GUANGDADA_API_KEY: 'unit-test-placeholder',
      },
      states,
      enqueue,
      reconcile: jest.fn().mockResolvedValue(0),
      recoverExpiredClaims: jest.fn().mockResolvedValue(0),
    }

    await runExternalMaterialCronTick(deps as any)
    await runExternalMaterialCronTick(deps as any)
    await runExternalMaterialCronTick(deps as any)

    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(deps.reconcile).toHaveBeenCalledTimes(1)
    expect(deps.recoverExpiredClaims).toHaveBeenCalledTimes(2)
    expect(deps.recoverExpiredClaims.mock.invocationCallOrder[0]).toBeLessThan(
      deps.reconcile.mock.invocationCallOrder[0],
    )
    expect(deps.reconcile.mock.invocationCallOrder[0]).toBeLessThan(
      deps.recoverExpiredClaims.mock.invocationCallOrder[1],
    )
    expect(deps.recoverExpiredClaims.mock.invocationCallOrder[1]).toBeLessThan(
      enqueue.mock.invocationCallOrder[0],
    )
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'guangdada',
        mode: 'scheduled',
      }),
    )
  })
})

const redisIntegrationEnabled = (
  env: Pick<
    NodeJS.ProcessEnv,
    'TEST_REDIS_URL' | 'RUN_EXTERNAL_SYNC_REDIS_INTEGRATION'
  >,
) =>
  Boolean(env.TEST_REDIS_URL && env.RUN_EXTERNAL_SYNC_REDIS_INTEGRATION === '1')

describe('external material Redis integration gate safety', () => {
  it('requires both the test URL and explicit destructive-integration opt-in', () => {
    expect(
      redisIntegrationEnabled({
        TEST_REDIS_URL: 'redis://127.0.0.1:6379',
      }),
    ).toBe(false)
    expect(
      redisIntegrationEnabled({
        RUN_EXTERNAL_SYNC_REDIS_INTEGRATION: '1',
      }),
    ).toBe(false)
    expect(
      redisIntegrationEnabled({
        TEST_REDIS_URL: 'redis://127.0.0.1:6379',
        RUN_EXTERNAL_SYNC_REDIS_INTEGRATION: '1',
      }),
    ).toBe(true)
  })
})

const integrationDescribe = redisIntegrationEnabled(process.env)
  ? describe
  : describe.skip

integrationDescribe('external material Redis and BullMQ integration', () => {
  const redisUrl = process.env.TEST_REDIS_URL as string
  let RedisConstructor: any
  let redis: any

  beforeAll(async () => {
    RedisConstructor = jest.requireActual('ioredis').default
    redis = new RedisConstructor(redisUrl, {
      maxRetriesPerRequest: null,
    })
    await redis.ping()
  })

  afterAll(async () => {
    if (redis) await redis.quit()
  })

  it('rejects nonowners and expired owners with real Redis Lua execution', async () => {
    const provider = 'guangdada'
    const testPrefix = `external-material-test-${randomUUID()}`
    const testKey = `${testPrefix}:external-material:sync-lock:${provider}`

    try {
      const owner = await acquireExternalMaterialLock(
        redis,
        provider,
        30_000,
        testPrefix,
      )
      expect(owner).toBeTruthy()
      await expect(
        renewExternalMaterialLock(
          redis,
          provider,
          'not-the-owner',
          30_000,
          testPrefix,
        ),
      ).resolves.toBe(false)
      await expect(
        releaseExternalMaterialLock(
          redis,
          provider,
          'not-the-owner',
          testPrefix,
        ),
      ).resolves.toBe(false)
      await expect(
        renewExternalMaterialLock(redis, provider, owner, 30_000, testPrefix),
      ).resolves.toBe(true)

      await redis.set(testKey, owner, 'PX', 50)
      await new Promise((resolve) => setTimeout(resolve, 100))
      await expect(
        renewExternalMaterialLock(redis, provider, owner, 30_000, testPrefix),
      ).resolves.toBe(false)
      await expect(
        releaseExternalMaterialLock(redis, provider, owner, testPrefix),
      ).resolves.toBe(false)
    } finally {
      await redis.unlink(testKey)
    }
  })

  it('keeps delayed jobs delayed until due and exposes terminal failed attempts', async () => {
    const { Queue: RealQueue, Worker: RealWorker } =
      jest.requireActual('bullmq')
    const testNamespace = randomUUID().replace(/-/g, '')
    const queueName = `external-material-integration-${testNamespace}`
    const delayedJobId = `${testNamespace}-delayed`
    const terminalJobId = `${testNamespace}-terminal`
    const queueConnection = new RedisConstructor(redisUrl, {
      maxRetriesPerRequest: null,
    })
    const workerConnection = new RedisConstructor(redisUrl, {
      maxRetriesPerRequest: null,
    })
    const queue = new RealQueue(queueName, {
      connection: queueConnection,
    })
    const worker = new RealWorker(
      queueName,
      async (queuedJob: any) => {
        if (queuedJob.name === 'terminal') {
          throw new Error('integration failure')
        }
        return { ok: true }
      },
      { connection: workerConnection },
    )
    const waitForState = async (jobId: string, wanted: string) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const current = await queue.getJob(jobId)
        if (current && (await current.getState()) === wanted) return current
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      throw new Error(`integration_state_timeout_${wanted}`)
    }

    try {
      const delayed = await queue.add(
        'delayed',
        { safe: true },
        { jobId: delayedJobId, delay: 200 },
      )
      await expect(delayed.getState()).resolves.toBe('delayed')
      await waitForState(delayedJobId, 'completed')

      await queue.add(
        'terminal',
        { safe: true },
        { jobId: terminalJobId, attempts: 1 },
      )
      const terminal = await waitForState(terminalJobId, 'failed')
      expect(terminal.attemptsMade).toBe(1)
    } finally {
      await worker.close()
      await queue.obliterate({ force: true })
      await queue.close()
      await Promise.all([
        queueConnection.quit().catch(() => undefined),
        workerConnection.quit().catch(() => undefined),
      ])
    }
  })
})
