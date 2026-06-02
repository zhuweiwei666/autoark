import express from 'express'
import request from 'supertest'
import { UserRole } from '../src/models/User'

jest.mock('../src/services/automationJob.service', () => ({
  createAutomationJob: jest.fn(),
  listAutomationJobs: jest.fn(),
  cancelAutomationJob: jest.fn(),
  retryAutomationJob: jest.fn(),
}))

const mockAuthState: { user: any } = {
  user: {
    role: UserRole.MEMBER,
    userId: '665000000000000000000002',
    organizationId: '665000000000000000000001',
  },
}

jest.mock('../src/middlewares/auth', () => {
  const actual = jest.requireActual('../src/middlewares/auth')
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = mockAuthState.user
      next()
    },
  }
})

import automationJobRoutes from '../src/routes/automationJob.routes'
import * as automationJobService from '../src/services/automationJob.service'

const createApp = () => {
  const app = express()
  app.use(express.json())
  app.use('/api/automation-jobs', automationJobRoutes)
  return app
}

describe('automation job route authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuthState.user = {
      role: UserRole.MEMBER,
      userId: '665000000000000000000002',
      organizationId: '665000000000000000000001',
    }
    ;(automationJobService.listAutomationJobs as jest.Mock).mockResolvedValue({
      list: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })
    ;(automationJobService.createAutomationJob as jest.Mock).mockResolvedValue({
      _id: '665000000000000000000401',
      type: 'PUBLISH_DRAFT',
      status: 'queued',
    })
  })

  it.each([
    ['GET', '/api/automation-jobs', undefined],
    ['POST', '/api/automation-jobs', { type: 'PUBLISH_DRAFT', payload: { draftId: '665000000000000000000099' } }],
    ['GET', '/api/automation-jobs/665000000000000000000301', undefined],
    ['POST', '/api/automation-jobs/665000000000000000000301/cancel', {}],
    ['POST', '/api/automation-jobs/665000000000000000000301/retry', {}],
  ] as const)('blocks members from %s %s', async (method, path, body) => {
    const req = request(createApp())[method.toLowerCase() as 'get' | 'post'](path)
    const response = body ? await req.send(body) : await req

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({
      success: false,
      message: '权限不足',
    })
  })

  it('caps automation job list page size for organization admins', async () => {
    mockAuthState.user = {
      role: UserRole.ORG_ADMIN,
      userId: '665000000000000000000002',
      organizationId: '665000000000000000000001',
    }

    const response = await request(createApp()).get('/api/automation-jobs?page=2&pageSize=9999')

    expect(response.status).toBe(200)
    expect(automationJobService.listAutomationJobs).toHaveBeenCalledWith(expect.objectContaining({
      page: 2,
      pageSize: 100,
    }))
  })

  it('passes only validated automation job filters', async () => {
    mockAuthState.user = {
      role: UserRole.ORG_ADMIN,
      userId: '665000000000000000000002',
      organizationId: '665000000000000000000001',
    }

    const response = await request(createApp())
      .get('/api/automation-jobs?status=queued&type=PUBLISH_DRAFT&agentId=665000000000000000000301&pageSize=9999')

    expect(response.status).toBe(200)
    expect(automationJobService.listAutomationJobs).toHaveBeenCalledWith(expect.objectContaining({
      status: 'queued',
      type: 'PUBLISH_DRAFT',
      agentId: '665000000000000000000301',
      pageSize: 100,
    }))
  })

  it('rejects invalid automation job filters before querying', async () => {
    mockAuthState.user = {
      role: UserRole.ORG_ADMIN,
      userId: '665000000000000000000002',
      organizationId: '665000000000000000000001',
    }

    const response = await request(createApp()).get('/api/automation-jobs?status=not-a-real-status')

    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({
      success: false,
      error: 'status filter is invalid',
    })
    expect(automationJobService.listAutomationJobs).not.toHaveBeenCalled()
  })

  it('returns sanitized empty pagination for organization admins without an organization', async () => {
    mockAuthState.user = {
      role: UserRole.ORG_ADMIN,
      userId: '665000000000000000000002',
    }

    const response = await request(createApp()).get('/api/automation-jobs?page=3&pageSize=9999')

    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({
      list: [],
      total: 0,
      page: 3,
      pageSize: 100,
    })
    expect(automationJobService.listAutomationJobs).not.toHaveBeenCalled()
  })

  it('sanitizes automation job create payloads before enqueueing', async () => {
    mockAuthState.user = {
      role: UserRole.SUPER_ADMIN,
      userId: '665000000000000000000002',
      organizationId: '665000000000000000000001',
    }

    const response = await request(createApp())
      .post('/api/automation-jobs')
      .send({
        type: 'PUBLISH_DRAFT',
        agentId: '665000000000000000000301',
        idempotencyKey: `  ${'k'.repeat(220)}  `,
        priority: 999,
        payload: {
          draftId: '  draft-1  ',
          note: `  ${'n'.repeat(1200)}  `,
          nested: { keep: '  ok  ' },
          list: Array.from({ length: 150 }, (_, index) => `item-${index}`),
          $where: 'evil',
          'bad.key': 'evil',
        },
        createdBy: 'attacker',
        organizationId: '665000000000000000000999',
      })

    expect(response.status).toBe(200)
    const input = (automationJobService.createAutomationJob as jest.Mock).mock.calls[0][0]
    expect(input).toMatchObject({
      type: 'PUBLISH_DRAFT',
      agentId: '665000000000000000000301',
      priority: 10,
      createdBy: '665000000000000000000002',
    })
    expect(input.idempotencyKey).toHaveLength(160)
    expect(input.payload).toMatchObject({
      draftId: 'draft-1',
      nested: { keep: 'ok' },
    })
    expect(input.payload.note).toHaveLength(1000)
    expect(input.payload.list).toHaveLength(100)
    expect(input.payload).not.toHaveProperty('$where')
    expect(input.payload).not.toHaveProperty('bad.key')
  })

  it('rejects automation job payloads containing raw token fields', async () => {
    mockAuthState.user = {
      role: UserRole.SUPER_ADMIN,
      userId: '665000000000000000000002',
      organizationId: '665000000000000000000001',
    }

    const response = await request(createApp())
      .post('/api/automation-jobs')
      .send({
        type: 'SYNC_FB_USER_ASSETS',
        payload: {
          fbUserId: 'fb_1',
          nested: { access_token: 'raw-token' },
        },
      })

    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({
      success: false,
      error: 'Raw token or secret is not allowed in automation job payload',
    })
    expect(automationJobService.createAutomationJob).not.toHaveBeenCalled()
  })

  it('rejects oversized automation job payloads before enqueueing', async () => {
    mockAuthState.user = {
      role: UserRole.SUPER_ADMIN,
      userId: '665000000000000000000002',
      organizationId: '665000000000000000000001',
    }

    const response = await request(createApp())
      .post('/api/automation-jobs')
      .send({
        type: 'PUBLISH_DRAFT',
        payload: {
          note: 'n'.repeat(70 * 1024),
        },
      })

    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({
      success: false,
      error: 'payload is too large',
    })
    expect(automationJobService.createAutomationJob).not.toHaveBeenCalled()
  })
})
