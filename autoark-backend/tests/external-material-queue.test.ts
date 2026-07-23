/* eslint-disable @typescript-eslint/no-explicit-any */
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
  externalMaterialContinuationJobId,
  parseExternalMaterialSyncRequest,
} from '../src/queue/externalMaterial.queue'
import {
  acquireExternalMaterialLock,
  handleExternalMaterialWorkerFailure,
  processExternalMaterialSyncJob,
  releaseExternalMaterialLock,
  renewExternalMaterialLock,
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
      findRunningConflict: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(run),
      checkpoint: jest.fn().mockResolvedValue(run),
      failExhausted: jest.fn().mockResolvedValue(run),
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
    expect(runSchema.path('errorSamples.category')).toBeDefined()
    expect(runSchema.path('rawRecord')).toBeUndefined()
    expect(runSchema.path('mediaUrl')).toBeUndefined()
    expect(runSchema.path('apiKey')).toBeUndefined()
    expect(runSchema.indexes()).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          { provider: 1 },
          expect.objectContaining({
            unique: true,
            partialFilterExpression: {
              status: { $in: expect.arrayContaining(['deferred']) },
            },
          }),
        ]),
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
      rawRecord: { secret: true },
      mediaUrl: 'https://secret.invalid/media',
    })
    expect(cast).toMatchObject({
      request: { recentDays: 3, limit: 500 },
      retryAfterMs: 60_000,
      deferCount: 1,
    })
    expect(cast).not.toHaveProperty('rawRecord')
    expect(cast).not.toHaveProperty('mediaUrl')
    expect(new ExternalMaterialSyncRun(cast).validateSync()).toBeUndefined()
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
      },
      expect.objectContaining({
        jobId: continuationId,
        delay: 60 * 60 * 1000,
        attempts: 3,
      }),
    )
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
})

describe('external material worker orchestration', () => {
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
    const retryable = { kind: 'failed', retryable: true, category: 'network' }
    const ingest = jest
      .fn()
      .mockResolvedValueOnce({ kind: 'alreadySeen', materialId: 'm1' })
      .mockResolvedValueOnce({ kind: 'created', materialId: 'm2' })
      .mockResolvedValueOnce({ kind: 'invalid', reason: 'invalid_media' })
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
        downloaded: 3,
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
    )
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
      }),
    )
    expect(deps.enqueueContinuation).toHaveBeenCalledWith({
      runId: 'run-1',
      provider: 'guangdada',
      request,
      retryAfterMs: 60 * 60 * 1000,
      deferCount: 1,
    })
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
      deferredUntil: new Date('2026-07-23T00:00:00.000Z'),
      retryAfterMs: 60_000,
    }
    const deps = workerDependencies({
      runs: {
        get: jest.fn().mockResolvedValue(deferredRun),
        findRunningConflict: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(deferredRun),
        checkpoint: jest.fn().mockResolvedValue(deferredRun),
        failExhausted: jest.fn().mockResolvedValue(deferredRun),
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
        },
      }),
      deps,
    )

    expect(deps.runs.update).toHaveBeenNthCalledWith(
      1,
      'run-1',
      expect.objectContaining({
        status: 'running',
        deferredUntil: null,
        retryAfterMs: null,
      }),
    )
  })

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
      ...runPatch,
    }
    const deps = workerDependencies({
      runs: {
        get: jest.fn().mockResolvedValue(run),
        findRunningConflict: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(run),
        checkpoint: jest.fn().mockResolvedValue(run),
        failExhausted: jest.fn().mockResolvedValue(run),
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

    await expect(
      processExternalMaterialSyncJob(job(), deps),
    ).resolves.toMatchObject({ status: 'failed' })
    expect(JSON.stringify(deps.runs.update.mock.calls)).not.toContain('unsafe')
    expect(deps.runs.update).toHaveBeenLastCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'failed',
        errorSamples: expect.arrayContaining([
          expect.objectContaining({ category: 'rate_limit' }),
        ]),
      }),
    )
    if (run.deferCount === 3) {
      expect(deps.enqueueContinuation).not.toHaveBeenCalled()
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

  it('only terminalizes an unexpected BullMQ failure after attempts are exhausted', async () => {
    const deps = workerDependencies()
    const unsafeError = new Error('unsafe provider payload')

    await handleExternalMaterialWorkerFailure(
      job({ attemptsMade: 2, opts: { attempts: 3 } }) as any,
      unsafeError,
      deps,
    )
    expect(deps.runs.failExhausted).not.toHaveBeenCalled()

    await handleExternalMaterialWorkerFailure(
      job({ attemptsMade: 3, opts: { attempts: 3 } }) as any,
      unsafeError,
      deps,
    )
    expect(deps.runs.failExhausted).toHaveBeenCalledWith(
      'run-1',
      new Date('2026-07-23T00:00:00.000Z'),
    )
    expect(JSON.stringify(deps.runs.failExhausted.mock.calls)).not.toContain(
      'unsafe',
    )
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
    expect(states.update).toHaveBeenNthCalledWith(1, 'guangdada', {
      backfillCursor: '17',
    })
    expect(states.update).toHaveBeenNthCalledWith(2, 'guangdada', {
      backfillCursor: '27',
    })
    expect(deps.runs.checkpoint).toHaveBeenCalledTimes(2)
    expect(deps.runs.checkpoint).toHaveBeenNthCalledWith(
      1,
      'run-1',
      null,
      expect.objectContaining({
        cursor: '17',
        counters: expect.objectContaining({ discovered: 1000 }),
      }),
    )
    expect(deps.runs.checkpoint).toHaveBeenNthCalledWith(
      2,
      'run-1',
      '17',
      expect.objectContaining({
        cursor: '27',
        counters: expect.objectContaining({ discovered: 2000 }),
      }),
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
    )
    expect(result).toMatchObject({
      status: 'completed',
      counters: expect.objectContaining({
        discovered: 2000,
        alreadySeen: 2000,
      }),
    })
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
    await runExternalMaterialCronTick({ env, states, enqueue } as any)
    expect(states.get).not.toHaveBeenCalled()
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
    }

    await runExternalMaterialCronTick(deps as any)
    await runExternalMaterialCronTick(deps as any)
    await runExternalMaterialCronTick(deps as any)

    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'guangdada',
        mode: 'scheduled',
      }),
    )
  })
})

const integrationDescribe = process.env.TEST_REDIS_URL
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
    const key = `external-material:sync-lock:${provider}`
    await redis.del(key)

    const owner = await acquireExternalMaterialLock(redis, provider, 30_000)
    expect(owner).toBeTruthy()
    await expect(
      renewExternalMaterialLock(redis, provider, 'not-the-owner', 30_000),
    ).resolves.toBe(false)
    await expect(
      releaseExternalMaterialLock(redis, provider, 'not-the-owner'),
    ).resolves.toBe(false)
    await expect(
      renewExternalMaterialLock(redis, provider, owner!, 30_000),
    ).resolves.toBe(true)

    await redis.set(key, owner, 'PX', 50)
    await new Promise((resolve) => setTimeout(resolve, 100))
    await expect(
      renewExternalMaterialLock(redis, provider, owner!, 30_000),
    ).resolves.toBe(false)
    await expect(
      releaseExternalMaterialLock(redis, provider, owner!),
    ).resolves.toBe(false)
  })

  it('keeps delayed jobs delayed until due and exposes terminal failed attempts', async () => {
    const { Queue: RealQueue, Worker: RealWorker } =
      jest.requireActual('bullmq')
    const queueName = `external-material-integration-${process.pid}-${Date.now()}`
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
        { jobId: 'delayed', delay: 200 },
      )
      await expect(delayed.getState()).resolves.toBe('delayed')
      await waitForState('delayed', 'completed')

      await queue.add(
        'terminal',
        { safe: true },
        { jobId: 'terminal', attempts: 1 },
      )
      const terminal = await waitForState('terminal', 'failed')
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
