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

const createApp = () => {
  const app = express()
  app.use(express.json())
  app.use('/api/automation-jobs', automationJobRoutes)
  return app
}

describe('automation job route authorization', () => {
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
})
