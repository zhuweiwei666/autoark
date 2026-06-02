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
})
