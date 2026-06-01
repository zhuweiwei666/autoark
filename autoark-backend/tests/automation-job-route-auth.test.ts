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
  it('blocks members from creating automation jobs', async () => {
    const response = await request(createApp())
      .post('/api/automation-jobs')
      .send({
        type: 'PUBLISH_DRAFT',
        payload: { draftId: '665000000000000000000099' },
      })

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({
      success: false,
      message: '权限不足',
    })
  })
})
