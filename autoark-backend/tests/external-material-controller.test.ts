/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'fs'
import path from 'path'
import express from 'express'
import request from 'supertest'
import { UserPermission, UserRole } from '../src/models/User'

const mockEnqueue = jest.fn()
const mockWriteAuditLog = jest.fn()
const mockStateLean = jest.fn()
const mockStateFindOne = jest.fn(() => ({ lean: mockStateLean }))
const mockStateFindOneAndUpdate = jest.fn()
const mockRunLean = jest.fn()
const mockRunSort = jest.fn(() => ({ lean: mockRunLean }))
const mockRunFindOne = jest.fn(() => ({ sort: mockRunSort }))

jest.mock('../src/models/ExternalMaterialSyncState', () => ({
  __esModule: true,
  default: {
    findOne: mockStateFindOne,
    findOneAndUpdate: mockStateFindOneAndUpdate,
  },
}))

jest.mock('../src/models/ExternalMaterialSyncRun', () => ({
  __esModule: true,
  default: {
    findOne: mockRunFindOne,
  },
}))

jest.mock('../src/queue/externalMaterial.queue', () => {
  const actual = jest.requireActual('../src/queue/externalMaterial.queue')
  return {
    ...actual,
    enqueueExternalMaterialSync: mockEnqueue,
  }
})

jest.mock('../src/services/auditLog.service', () => ({
  writeAuditLog: mockWriteAuditLog,
}))

jest.mock('../src/middlewares/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    const role = req.get('x-test-role')
    if (role === 'super') {
      req.user = {
        userId: 'super-1',
        role: UserRole.SUPER_ADMIN,
        permissions: [],
      }
    } else if (role === 'reader') {
      req.user = {
        userId: 'reader-1',
        role: UserRole.MEMBER,
        permissions: [UserPermission.MATERIALS_EXTERNAL_READ],
      }
    } else if (role === 'manager') {
      req.user = {
        userId: 'manager-1',
        role: UserRole.MEMBER,
        permissions: [UserPermission.MATERIALS_EXTERNAL_MANAGE],
      }
    } else {
      req.user = {
        userId: 'ordinary-1',
        role: UserRole.MEMBER,
        permissions: [],
      }
    }
    next()
  },
}))

const ordinaryMaterialHandler = (_req: any, res: any) =>
  res.json({ success: true, data: 'ordinary-material-handler' })

jest.mock('../src/controllers/material.controller', () => ({
  streamPublicMaterial: ordinaryMaterialHandler,
  getConfigStatus: ordinaryMaterialHandler,
  getPresignedUrl: ordinaryMaterialHandler,
  getPresignedUrls: ordinaryMaterialHandler,
  confirmUpload: ordinaryMaterialHandler,
  confirmUploads: ordinaryMaterialHandler,
  uploadMaterial: ordinaryMaterialHandler,
  uploadMaterialBatch: ordinaryMaterialHandler,
  getMaterialList: ordinaryMaterialHandler,
  getMaterialSmartGroups: ordinaryMaterialHandler,
  getFolders: ordinaryMaterialHandler,
  getFolderTree: ordinaryMaterialHandler,
  createFolder: ordinaryMaterialHandler,
  renameFolder: ordinaryMaterialHandler,
  deleteFolder: ordinaryMaterialHandler,
  moveToFolder: ordinaryMaterialHandler,
  getTags: ordinaryMaterialHandler,
  recordFbMapping: ordinaryMaterialHandler,
  findByFacebookId: ordinaryMaterialHandler,
  getReusable: ordinaryMaterialHandler,
  aggregateMetrics: ordinaryMaterialHandler,
  recordAdMapping: ordinaryMaterialHandler,
  recordAdMappingsBatch: ordinaryMaterialHandler,
  getFullData: ordinaryMaterialHandler,
  getMaterial: ordinaryMaterialHandler,
  updateMaterial: ordinaryMaterialHandler,
  deleteMaterial: ordinaryMaterialHandler,
  deleteMaterialBatch: ordinaryMaterialHandler,
}))

import materialRoutes from '../src/routes/material.routes'

const app = express()
app.use(express.json())
app.use('/api/materials', materialRoutes)

const sampleCounters = {
  discovered: 20,
  considered: 18,
  alreadySeen: 2,
  downloaded: 16,
  contentReused: 3,
  newlyCreated: 10,
  invalid: 1,
  failed: 2,
  deferred: 0,
}

describe('external material controller and routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.GUANGDADA_API_KEY = 'unit-test-key-must-not-leak'
    process.env.EXTERNAL_MATERIAL_SYNC_ENABLED = 'true'
    mockStateLean.mockResolvedValue({
      provider: 'guangdada',
      paused: false,
      pauseReason: null,
      recurringEnabled: true,
      backfillCursor: '17',
      createdAt: new Date('2026-07-20T00:00:00.000Z'),
      updatedAt: new Date('2026-07-23T00:00:00.000Z'),
    })
    mockRunLean.mockResolvedValue({
      _id: 'run-secret-id',
      provider: 'guangdada',
      mode: 'scheduled',
      dryRun: false,
      request: { recentDays: 3, limit: 500 },
      status: 'completed',
      cursor: 'must-not-be-returned',
      counters: sampleCounters,
      errorSamples: [{ category: 'configuration' }],
      startedAt: new Date('2026-07-23T00:00:00.000Z'),
      completedAt: new Date('2026-07-23T00:05:00.000Z'),
      createdAt: new Date('2026-07-23T00:00:00.000Z'),
    })
    mockStateFindOneAndUpdate.mockResolvedValue({
      provider: 'guangdada',
      paused: true,
      pauseReason: 'manual',
      recurringEnabled: true,
    })
    mockEnqueue.mockResolvedValue({
      enqueued: true,
      status: 'queued',
      runId: 'run-secret-id',
      jobId: 'job-secret-id',
      request: {
        provider: 'guangdada',
        mode: 'backfill',
        dryRun: true,
        recentDays: 30,
        limit: 2000,
      },
    })
  })

  afterEach(() => {
    delete process.env.GUANGDADA_API_KEY
    delete process.env.EXTERNAL_MATERIAL_SYNC_ENABLED
  })

  it.each([
    ['GET', '/api/materials/external/guangdada/status'],
    ['POST', '/api/materials/external/guangdada/sync'],
    ['POST', '/api/materials/external/guangdada/pause'],
    ['POST', '/api/materials/external/guangdada/resume'],
  ])(
    'returns a fixed non-leaking 403 for ordinary users: %s %s',
    async (method, url) => {
      const response =
        method === 'GET'
          ? await request(app).get(url).set('x-test-role', 'ordinary')
          : await request(app).post(url).set('x-test-role', 'ordinary').send({})

      expect(response.status).toBe(403)
      expect(response.body).toEqual({ success: false, message: '权限不足' })
      const serialized = JSON.stringify(response.body)
      expect(serialized).not.toMatch(
        /guangdada|count|run|job|https?:|redis|key|config|paused|enabled/i,
      )
      expect(mockStateFindOne).not.toHaveBeenCalled()
      expect(mockStateFindOneAndUpdate).not.toHaveBeenCalled()
      expect(mockRunFindOne).not.toHaveBeenCalled()
      expect(mockEnqueue).not.toHaveBeenCalled()
    },
  )

  it('allows explicit readers and superadmins to read a redacted status', async () => {
    for (const role of ['reader', 'super']) {
      const response = await request(app)
        .get('/api/materials/external/guangdada/status')
        .set('x-test-role', role)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        success: true,
        data: {
          provider: 'guangdada',
          paused: false,
          pauseReason: null,
          recurringEnabled: true,
          lastRun: {
            mode: 'scheduled',
            dryRun: false,
            request: { recentDays: 3, limit: 500 },
            status: 'completed',
            counters: sampleCounters,
            startedAt: '2026-07-23T00:00:00.000Z',
            completedAt: '2026-07-23T00:05:00.000Z',
          },
        },
      })
      const serialized = JSON.stringify(response.body)
      expect(serialized).not.toMatch(
        /unit-test-key|run-secret|job-secret|must-not-be-returned|https?:|redis|configuration|errorSamples/i,
      )
    }
  })

  it('requires manage permission for sync and returns only a clamped safe summary', async () => {
    const forbidden = await request(app)
      .post('/api/materials/external/guangdada/sync')
      .set('x-test-role', 'reader')
      .send({ mode: 'backfill', dryRun: true, recentDays: 999, limit: 99999 })
    expect(forbidden.status).toBe(403)

    const response = await request(app)
      .post('/api/materials/external/guangdada/sync')
      .set('x-test-role', 'manager')
      .send({ mode: 'backfill', dryRun: true, recentDays: 999, limit: 99999 })

    expect(response.status).toBe(202)
    expect(mockEnqueue).toHaveBeenCalledWith({
      provider: 'guangdada',
      mode: 'backfill',
      dryRun: true,
      recentDays: 30,
      limit: 2000,
    })
    expect(response.body).toEqual({
      success: true,
      data: {
        provider: 'guangdada',
        mode: 'backfill',
        dryRun: true,
        request: { recentDays: 30, limit: 2000 },
        status: 'queued',
        enqueued: true,
      },
    })
    expect(JSON.stringify(response.body)).not.toMatch(/run-secret|job-secret/i)
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        category: 'external_material',
        action: 'external_material.sync',
        metadata: {
          provider: 'guangdada',
          mode: 'backfill',
          dryRun: true,
          recentDays: 30,
          limit: 2000,
          enqueued: true,
          status: 'queued',
        },
      }),
    )
    expect(
      JSON.stringify(mockWriteAuditLog.mock.calls.map((call) => call[1])),
    ).not.toContain('unit-test-key')
  })

  it('uses the scheduled defaults for an empty manage request body', async () => {
    mockEnqueue.mockResolvedValueOnce({
      enqueued: true,
      status: 'queued',
      runId: 'run-secret-id',
      request: {
        provider: 'guangdada',
        mode: 'scheduled',
        dryRun: false,
        recentDays: 3,
        limit: 500,
      },
    })

    const response = await request(app)
      .post('/api/materials/external/guangdada/sync')
      .set('x-test-role', 'manager')

    expect(response.status).toBe(202)
    expect(mockEnqueue).toHaveBeenCalledWith({
      provider: 'guangdada',
      mode: 'scheduled',
      dryRun: false,
      recentDays: 3,
      limit: 500,
    })
  })

  it.each([
    [{ mode: 'canary10', dryRun: false, unknown: true }],
    [{ mode: 'not-a-mode', dryRun: false }],
    [{ mode: 'canary10', dryRun: 'false' }],
    [{ mode: 'canary10', recentDays: { $gt: 0 } }],
  ])('rejects strict-schema sync bodies without enqueuing', async (body) => {
    const response = await request(app)
      .post('/api/materials/external/guangdada/sync')
      .set('x-test-role', 'manager')
      .send(body)

    expect(response.status).toBe(400)
    expect(response.body).toEqual({
      success: false,
      message: '同步参数无效',
    })
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('makes pause and resume idempotent while returning no configuration state', async () => {
    const paused = await request(app)
      .post('/api/materials/external/guangdada/pause')
      .set('x-test-role', 'manager')
      .send({})
    expect(paused.status).toBe(200)
    expect(mockStateFindOneAndUpdate).toHaveBeenNthCalledWith(
      1,
      { provider: 'guangdada' },
      {
        $set: { paused: true, pauseReason: 'manual' },
        $setOnInsert: { provider: 'guangdada' },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
    expect(paused.body).toEqual({
      success: true,
      data: {
        provider: 'guangdada',
        paused: true,
        pauseReason: 'manual',
        recurringEnabled: true,
      },
    })

    mockStateFindOneAndUpdate.mockResolvedValueOnce({
      provider: 'guangdada',
      paused: false,
      pauseReason: null,
      recurringEnabled: true,
    })
    const resumed = await request(app)
      .post('/api/materials/external/guangdada/resume')
      .set('x-test-role', 'manager')
      .send({})
    expect(resumed.status).toBe(200)
    expect(mockStateFindOneAndUpdate).toHaveBeenNthCalledWith(
      2,
      { provider: 'guangdada' },
      {
        $set: {
          paused: false,
          pauseReason: null,
          recurringEnabled: true,
        },
        $setOnInsert: { provider: 'guangdada' },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
    expect(resumed.body.data).toEqual({
      provider: 'guangdada',
      paused: false,
      pauseReason: null,
      recurringEnabled: true,
    })
    expect(JSON.stringify(resumed.body)).not.toMatch(
      /apiKey|feature|configured|configUrl/i,
    )
  })

  it('returns a fixed sanitized server error instead of upstream or database details', async () => {
    mockStateLean.mockRejectedValueOnce(
      new Error('mongodb://secret-host/provider?api_key=unsafe'),
    )
    const response = await request(app)
      .get('/api/materials/external/guangdada/status')
      .set('x-test-role', 'super')

    expect(response.status).toBe(500)
    expect(response.body).toEqual({
      success: false,
      message: '外部素材同步操作失败',
    })
    expect(JSON.stringify(response.body)).not.toMatch(
      /mongodb|secret|api_key|provider/i,
    )
  })

  it('registers all external routes before dynamic material routes', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../src/routes/material.routes.ts'),
      'utf8',
    )
    const dynamicIndex = source.indexOf("router.get('/:id'")
    for (const route of [
      '/external/guangdada/status',
      '/external/guangdada/sync',
      '/external/guangdada/pause',
      '/external/guangdada/resume',
    ]) {
      expect(source.indexOf(route)).toBeGreaterThan(-1)
      expect(source.indexOf(route)).toBeLessThan(dynamicIndex)
    }
  })
})

describe('external material bootstrap lifecycle', () => {
  it('has no import side effect and initializes external queue/worker before cron', async () => {
    jest.resetModules()
    const events: string[] = []
    const redis = { ping: jest.fn().mockResolvedValue('PONG') }
    const close = jest.fn((callback?: () => void) => callback?.())

    jest.doMock('../src/app', () => ({
      __esModule: true,
      default: {
        listen: jest.fn(() => {
          events.push('http')
          return { close }
        }),
      },
    }))
    jest.doMock('../src/config/db', () => ({
      __esModule: true,
      default: jest.fn(async () => {
        events.push('db')
      }),
    }))
    jest.doMock('../src/config/redis', () => ({
      initRedis: jest.fn(() => {
        events.push('redis')
        return redis
      }),
    }))
    jest.doMock('../src/services/facebook.upsert.service', () => ({
      ensureMetricsDailyIndexCompatibility: jest.fn(async () => {
        events.push('metrics')
      }),
    }))
    jest.doMock('../src/services/facebook.token.pool', () => ({
      tokenPool: {
        initialize: jest.fn(() => {
          events.push('token')
          return Promise.resolve()
        }),
      },
    }))
    jest.doMock('../src/queue/facebook.queue', () => ({
      initQueues: jest.fn(() => events.push('queues')),
    }))
    jest.doMock('../src/queue/facebook.worker', () => ({
      initWorkers: jest.fn(async () => events.push('workers')),
    }))
    jest.doMock('../src/queue/bulkAd.worker', () => ({
      initBulkAdWorker: jest.fn(() => events.push('bulkWorker')),
    }))
    jest.doMock('../src/queue/automation.worker', () => ({
      initAutomationWorker: jest.fn(() => events.push('automationWorker')),
    }))
    jest.doMock('../src/queue/externalMaterial.queue', () => ({
      initExternalMaterialQueue: jest.fn(async () =>
        events.push('externalQueue'),
      ),
      closeExternalMaterialQueue: jest.fn(async () =>
        events.push('closeExternalQueue'),
      ),
    }))
    jest.doMock('../src/queue/externalMaterial.worker', () => ({
      initExternalMaterialWorker: jest.fn(async () =>
        events.push('externalWorker'),
      ),
      closeExternalMaterialWorker: jest.fn(async () =>
        events.push('closeExternalWorker'),
      ),
    }))
    jest.doMock('../src/agent', () => ({
      initializeAgentSystem: jest.fn(() => events.push('agent')),
    }))
    jest.doMock('../src/cron', () => ({
      __esModule: true,
      default: jest.fn(() => events.push('cron')),
    }))
    jest.doMock('../src/cron/sync.cron.v2', () => ({
      __esModule: true,
      default: jest.fn(() => events.push('syncCron')),
    }))
    jest.doMock('../src/cron/preaggregation.cron', () => ({
      __esModule: true,
      default: jest.fn(() => events.push('preaggregationCron')),
    }))
    jest.doMock('../src/cron/tokenValidation.cron', () => ({
      __esModule: true,
      default: jest.fn(() => events.push('tokenCron')),
    }))
    jest.doMock('../src/cron/externalMaterial.cron', () => ({
      closeExternalMaterialCron: jest.fn(() =>
        events.push('closeExternalCron'),
      ),
    }))
    jest.doMock('../src/utils/logger', () => ({
      __esModule: true,
      default: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    }))

    const serverModule = await import('../src/server')
    await Promise.resolve()
    expect(events).toEqual([])

    await serverModule.bootstrap()
    expect(events.indexOf('redis')).toBeLessThan(
      events.indexOf('externalQueue'),
    )
    expect(events.indexOf('externalQueue')).toBeLessThan(
      events.indexOf('externalWorker'),
    )
    expect(events.indexOf('externalWorker')).toBeLessThan(
      events.indexOf('cron'),
    )
    expect(events.indexOf('cron')).toBeLessThan(events.indexOf('http'))
  })
})
