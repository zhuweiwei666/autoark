import express, { NextFunction, Request, Response } from 'express'
import request from 'supertest'
import { UserRole } from '../src/models/User'

const mockAxiosPost = jest.fn()
const mockMaterialFindOne = jest.fn()
const mockMaterialFindById = jest.fn()
const mockMaterialCreate = jest.fn()
const mockVariantFindOne = jest.fn()
const mockVariantFindById = jest.fn()
const mockVariantCreate = jest.fn()
const mockVariantFindOneAndUpdate = jest.fn()
const mockVariantFindByIdAndUpdate = jest.fn()
const mockWriteAuditLog = jest.fn()

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: mockAxiosPost,
  },
}))

jest.mock('../src/models/Material', () => ({
  __esModule: true,
  default: {
    findOne: mockMaterialFindOne,
    findById: mockMaterialFindById,
    create: mockMaterialCreate,
  },
}))

jest.mock('../src/models/MaterialVariantJob', () => ({
  __esModule: true,
  default: {
    findOne: mockVariantFindOne,
    findById: mockVariantFindById,
    create: mockVariantCreate,
    findOneAndUpdate: mockVariantFindOneAndUpdate,
    findByIdAndUpdate: mockVariantFindByIdAndUpdate,
  },
}))

jest.mock('../src/services/auditLog.service', () => ({
  writeAuditLog: mockWriteAuditLog,
}))

jest.mock('../src/middlewares/auth', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    const role = req.get('x-test-role')
    req.user = {
      userId: role === 'member'
        ? '665000000000000000000003'
        : '665000000000000000000002',
      role: role === 'member' ? UserRole.MEMBER : UserRole.ORG_ADMIN,
      organizationId: '665000000000000000000001',
      permissions: [],
    }
    next()
  },
}))

import materialVariantRoutes from '../src/routes/materialVariant.routes'
import materialVariantCallbackRoutes from '../src/routes/materialVariantCallback.routes'
import {
  buildRequestFingerprint,
  normalizePublicHttpUrl,
  parseMaterialVariantInput,
  signMaterialVariantCallback,
} from '../src/services/materialVariant.service'

const parentMaterialId = '665000000000000000000101'
const variantJobId = '665000000000000000000201'
const outputMaterialId = '665000000000000000000301'
const organizationId = '665000000000000000000001'
const userId = '665000000000000000000002'
const generationJobId = 'gen-video-edit-001'
const externalId = 'autoark-material-variant:test-external-id'
const sourceVideoUrl = 'https://media.example.com/source.mp4'
const hmacSecret = 'unit-test-hmac-secret-with-32-chars'

const parentMaterial = {
  _id: parentMaterialId,
  organizationId,
  name: '原始广告视频',
  type: 'video',
  status: 'ready',
  storage: { url: sourceVideoUrl },
  file: { width: 1080, height: 1920, duration: 12 },
  thumbnail: { url: 'https://media.example.com/source.jpg' },
  folder: '获客素材',
  tags: ['Meta', '夏季'],
}

const buildJob = (overrides: Record<string, any> = {}) => {
  const job: any = {
    _id: variantJobId,
    organizationId,
    scopeKey: `org:${organizationId}`,
    parentMaterialId,
    createdBy: userId,
    status: 'submitting',
    idempotencyKey: 'variant-request-001',
    upstreamIdempotencyKey:
      'autoark:material-variant:0123456789abcdef:variant-request-001',
    requestFingerprint: 'request-fingerprint',
    externalId,
    input: {
      sourceVideoUrl,
      prompt: '保留主体，改成暖色夜景并增加镜头运动',
      durationSeconds: 3,
      frameRate: 16,
      strength: 0.85,
      preserveAudio: true,
      aspectRatio: '9:16',
    },
    generation: {
      service: 'ai-host-v2',
      capability: 'video_edit',
      priority: 20,
      resultUrlPolicy: 'permanent',
    },
    callback: {},
    createdAt: new Date('2026-07-28T00:00:00.000Z'),
    updatedAt: new Date('2026-07-28T00:00:00.000Z'),
    ...overrides,
  }
  job.toObject = () => {
    const { toObject, ...plain } = job
    return plain
  }
  return job
}

const createApp = () => {
  const app = express()
  app.use(express.json({
    verify(req, _res, buffer) {
      ;(req as Request).rawBody = Buffer.from(buffer)
    },
  }))
  app.use('/api/material-variants', materialVariantRoutes)
  app.use('/api/internal/generation/material-variants', materialVariantCallbackRoutes)
  return app
}

describe('material video variants', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.NODE_ENV = 'test'
    process.env.AI_HOST_GENERATION_BASE_URL = 'https://generation.example.com'
    process.env.AI_HOST_GENERATION_API_KEY = 'generation-api-key'
    process.env.AI_HOST_GENERATION_HMAC_SECRET = hmacSecret
    process.env.AUTOARK_PUBLIC_BASE_URL = 'https://app.autoark.work'
    mockWriteAuditLog.mockResolvedValue(undefined)
  })

  it('blocks member users before any generation or database write', async () => {
    const response = await request(createApp())
      .post('/api/material-variants')
      .set('x-test-role', 'member')
      .set('Idempotency-Key', 'variant-request-001')
      .send({
        parentMaterialId,
        prompt: '生成一个合规的新变体',
      })

    expect(response.status).toBe(403)
    expect(mockMaterialFindOne).not.toHaveBeenCalled()
    expect(mockVariantCreate).not.toHaveBeenCalled()
    expect(mockAxiosPost).not.toHaveBeenCalled()
  })

  it('submits an idempotent low-priority permanent video_edit job', async () => {
    const localJob = buildJob()
    const queuedJob = buildJob({
      status: 'queued',
      generationJobId,
      generation: {
        ...localJob.generation,
        provider: 'comfyui-vace',
      },
    })
    mockMaterialFindOne.mockResolvedValue(parentMaterial)
    mockVariantFindOne.mockResolvedValue(null)
    mockVariantCreate.mockResolvedValue(localJob)
    mockAxiosPost.mockResolvedValue({
      data: {
        success: true,
        data: {
          jobId: generationJobId,
          status: 'queued',
          routing: { provider: 'comfyui-vace' },
        },
      },
    })
    mockVariantFindOneAndUpdate.mockResolvedValue(queuedJob)

    const response = await request(createApp())
      .post('/api/material-variants')
      .set('Idempotency-Key', 'variant-request-001')
      .send({
        parentMaterialId,
        prompt: '保留主体，改成暖色夜景并增加镜头运动',
        durationSeconds: 3,
        strength: 0.85,
        preserveAudio: true,
      })

    expect(response.status).toBe(202)
    expect(response.body.data).toMatchObject({
      status: 'queued',
      generationJobId,
      generation: {
        capability: 'video_edit',
        priority: 20,
        resultUrlPolicy: 'permanent',
      },
    })
    expect(mockAxiosPost).toHaveBeenCalledTimes(1)
    const [url, payload, options] = mockAxiosPost.mock.calls[0]
    expect(url).toBe('https://generation.example.com/api/v1/jobs')
    expect(options.headers['X-API-Key']).toBe('generation-api-key')
    expect(payload).toMatchObject({
      externalId,
      idempotencyKey: localJob.upstreamIdempotencyKey,
      capability: 'video_edit',
      priority: 20,
      resultUrlPolicy: 'permanent',
      callbackUrl:
        'https://app.autoark.work/api/internal/generation/material-variants/callback',
      input: {
        sourceVideoUrl,
        prompt: '保留主体，改成暖色夜景并增加镜头运动',
        durationSeconds: 3,
        frameRate: 16,
        strength: 0.85,
        preserveAudio: true,
        aspectRatio: '9:16',
      },
    })
    expect(payload).not.toHaveProperty('publish')
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'material_variant.create' }),
    )
  })

  it('returns an existing compatible job without submitting a duplicate', async () => {
    const input = parseMaterialVariantInput(
      {
        prompt: '保留主体，改成暖色夜景并增加镜头运动',
        durationSeconds: 3,
        strength: 0.85,
        preserveAudio: true,
      },
      sourceVideoUrl,
      '9:16',
    )
    const existing = buildJob({
      status: 'queued',
      generationJobId,
      requestFingerprint: buildRequestFingerprint(parentMaterialId, input),
    })
    mockMaterialFindOne.mockResolvedValue(parentMaterial)
    mockVariantFindOne.mockResolvedValue(existing)

    const firstResponse = await request(createApp())
      .post('/api/material-variants')
      .set('Idempotency-Key', 'variant-request-001')
      .send({
        parentMaterialId,
        prompt: '保留主体，改成暖色夜景并增加镜头运动',
        durationSeconds: 3,
        strength: 0.85,
        preserveAudio: true,
      })

    expect(firstResponse.status).toBe(202)
    expect(firstResponse.body.data).toMatchObject({
      status: 'queued',
      generationJobId,
      idempotentReplay: true,
    })
    expect(mockAxiosPost).not.toHaveBeenCalled()
  })

  it('rejects private-network media URLs before calling ai-host-v2', () => {
    expect(() => normalizePublicHttpUrl(
      'http://127.0.0.1:8188/system_stats',
      '素材视频 URL',
    )).toThrow('不能指向本机或私有网络')
  })

  it('rejects callbacks with an invalid signature before database access', async () => {
    const body = {
      jobId: generationJobId,
      externalId,
      capability: 'video_edit',
      status: 'completed',
      output: { resultUrl: 'https://media.example.com/output.mp4' },
      deliveryId: 'delivery-001',
      fingerprint: 'f'.repeat(64),
    }

    const response = await request(createApp())
      .post('/api/internal/generation/material-variants/callback')
      .set('Content-Type', 'application/json')
      .set('X-Signature', '0'.repeat(64))
      .send(JSON.stringify(body))

    expect(response.status).toBe(401)
    expect(response.body.code).toBe('INVALID_SIGNATURE')
    expect(mockVariantFindOne).not.toHaveBeenCalled()
    expect(mockMaterialCreate).not.toHaveBeenCalled()
  })

  it('creates one reviewable child material from a valid completed callback', async () => {
    const body = {
      jobId: generationJobId,
      externalId,
      capability: 'video_edit',
      status: 'completed',
      output: {
        resultUrl: 'https://media.example.com/variants/output-001.mp4',
        metadata: { provider: 'comfyui-vace' },
      },
      completedAt: '2026-07-28T00:10:00.000Z',
      deliveryId: 'delivery-001',
      fingerprint: 'a'.repeat(64),
    }
    const rawBody = JSON.stringify(body)
    const job = buildJob({
      status: 'queued',
      generationJobId,
    })
    mockVariantFindOne.mockResolvedValue(job)
    mockMaterialFindById.mockResolvedValue(parentMaterial)
    mockMaterialFindOne.mockResolvedValue(null)
    mockMaterialCreate.mockImplementation(async (record: any) => ({
      _id: outputMaterialId,
      ...record,
    }))
    mockVariantFindByIdAndUpdate.mockResolvedValue(buildJob({
      status: 'completed',
      generationJobId,
      outputMaterialId,
    }))

    const response = await request(createApp())
      .post('/api/internal/generation/material-variants/callback')
      .set('Content-Type', 'application/json')
      .set('X-Signature', signMaterialVariantCallback(rawBody, hmacSecret))
      .set('X-Job-Id', generationJobId)
      .set('X-Delivery-Id', body.deliveryId)
      .set('X-Callback-Attempt', '1')
      .send(rawBody)

    expect(response.status).toBe(200)
    expect(response.body.data).toEqual({
      duplicate: false,
      status: 'completed',
      outputMaterialId,
    })
    expect(mockMaterialCreate).toHaveBeenCalledTimes(1)
    expect(mockMaterialCreate.mock.calls[0][0]).toMatchObject({
      organizationId,
      type: 'video',
      status: 'ready',
      storage: {
        provider: 'ai-host-v2',
        url: body.output.resultUrl,
      },
      source: {
        type: 'ai_variant',
        platform: 'ai-host-v2',
      },
      variant: {
        parentMaterialId,
        rootMaterialId: parentMaterialId,
        variantJobId,
        generationJobId,
        provider: 'comfyui-vace',
        capability: 'video_edit',
        reviewStatus: 'pending',
      },
      tags: ['Meta', '夏季', 'AI变体'],
      autoTestStatus: 'pending',
    })
    expect(mockAxiosPost).not.toHaveBeenCalled()
  })

  it('deduplicates a repeated callback delivery without creating another material', async () => {
    const body = {
      jobId: generationJobId,
      externalId,
      capability: 'video_edit',
      status: 'completed',
      output: {
        resultUrl: 'https://media.example.com/variants/output-001.mp4',
      },
      deliveryId: 'delivery-repeat',
      fingerprint: 'b'.repeat(64),
    }
    const rawBody = JSON.stringify(body)
    mockVariantFindOne.mockResolvedValue(buildJob({
      status: 'completed',
      generationJobId,
      outputMaterialId,
      callback: {
        lastDeliveryId: body.deliveryId,
        lastFingerprint: body.fingerprint,
      },
    }))

    const response = await request(createApp())
      .post('/api/internal/generation/material-variants/callback')
      .set('Content-Type', 'application/json')
      .set('X-Signature', signMaterialVariantCallback(rawBody, hmacSecret))
      .set('X-Job-Id', generationJobId)
      .set('X-Delivery-Id', body.deliveryId)
      .send(rawBody)

    expect(response.status).toBe(200)
    expect(response.body.data).toEqual({
      duplicate: true,
      status: 'completed',
      outputMaterialId,
    })
    expect(mockMaterialFindById).not.toHaveBeenCalled()
    expect(mockMaterialCreate).not.toHaveBeenCalled()
    expect(mockVariantFindByIdAndUpdate).not.toHaveBeenCalled()
  })

  it('does not regress a completed callback when the submit response arrives late', async () => {
    const localJob = buildJob()
    const completedJob = buildJob({
      status: 'completed',
      generationJobId,
      outputMaterialId,
    })
    mockMaterialFindOne.mockResolvedValue(parentMaterial)
    mockVariantFindOne.mockResolvedValue(null)
    mockVariantCreate.mockResolvedValue(localJob)
    mockAxiosPost.mockResolvedValue({
      data: {
        success: true,
        data: {
          jobId: generationJobId,
          status: 'queued',
          routing: { provider: 'comfyui-vace' },
        },
      },
    })
    mockVariantFindOneAndUpdate.mockResolvedValue(null)
    mockVariantFindById.mockResolvedValue(completedJob)

    const response = await request(createApp())
      .post('/api/material-variants')
      .set('Idempotency-Key', 'variant-request-001')
      .send({
        parentMaterialId,
        prompt: '保留主体，改成暖色夜景并增加镜头运动',
      })

    expect(response.status).toBe(202)
    expect(response.body.data).toMatchObject({
      status: 'completed',
      outputMaterialId,
    })
    expect(mockVariantFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: variantJobId,
        status: { $in: ['submitting', 'submission_unknown'] },
      }),
      expect.anything(),
      { new: true },
    )
  })
})
