import express from 'express'
import request from 'supertest'
import { UserRole } from '../src/models/User'

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

jest.mock('../src/controllers/optimizerLearning.controller', () => {
  const ok = (_req: any, res: any) => res.json({ success: true, data: [] })
  return {
    getOptimizers: jest.fn(ok),
    createPlaybook: jest.fn(ok),
    getPlaybookGenerationById: jest.fn(ok),
    getPlaybooks: jest.fn(ok),
    getPlaybookById: jest.fn(ok),
    getReplicaAssets: jest.fn(ok),
    createReplicaRun: jest.fn(ok),
    getReplicaRuns: jest.fn(ok),
    getReplicaRun: jest.fn(ok),
    approveReplicaRun: jest.fn(ok),
    publishReplicaRun: jest.fn(ok),
    evaluateReplicaRun: jest.fn(ok),
  }
})

import optimizerLearningRoutes from '../src/routes/optimizerLearning.routes'
import * as controller from '../src/controllers/optimizerLearning.controller'

const createApp = () => {
  const app = express()
  app.use(express.json())
  app.use('/api/optimizer-learning', optimizerLearningRoutes)
  return app
}

describe('optimizer learning route authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuthState.user = {
      role: UserRole.MEMBER,
      userId: '665000000000000000000002',
      organizationId: '665000000000000000000001',
    }
  })

  it.each([
    ['GET', '/api/optimizer-learning/optimizers'],
    ['POST', '/api/optimizer-learning/optimizers/buyer-a/playbooks'],
    [
      'GET',
      '/api/optimizer-learning/playbook-generations/665000000000000000000009',
    ],
    ['GET', '/api/optimizer-learning/playbooks'],
    [
      'POST',
      '/api/optimizer-learning/playbooks/665000000000000000000010/replicas',
    ],
    [
      'POST',
      '/api/optimizer-learning/replicas/665000000000000000000020/approve',
    ],
    [
      'POST',
      '/api/optimizer-learning/replicas/665000000000000000000020/publish',
    ],
  ] as const)('blocks members from %s %s', async (method, path) => {
    const response = await request(createApp())
      [method.toLowerCase() as 'get' | 'post'](path)
      .send({})
    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({ success: false, message: '权限不足' })
  })

  it('allows an organization admin to read optimizer summaries', async () => {
    mockAuthState.user = {
      role: UserRole.ORG_ADMIN,
      userId: '665000000000000000000002',
      organizationId: '665000000000000000000001',
    }

    const response = await request(createApp()).get(
      '/api/optimizer-learning/optimizers',
    )

    expect(response.status).toBe(200)
    expect(controller.getOptimizers).toHaveBeenCalled()
  })
})
