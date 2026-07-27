import express from 'express'
import request from 'supertest'
import { UserRole } from '../src/models/User'

const authState: { user: any } = {
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
      req.user = authState.user
      next()
    },
  }
})

jest.mock('../src/services/metaBusinessCredential.service', () => ({
  listCredentials: jest.fn().mockResolvedValue([]),
  listBootstrapTokens: jest.fn().mockResolvedValue([]),
  getMigrationInventory: jest.fn().mockResolvedValue({ organizations: [], apps: [] }),
  discoverBusinesses: jest.fn().mockResolvedValue([]),
  inspectBusiness: jest.fn(),
  inspectApplicationOwnership: jest
    .fn()
    .mockResolvedValue({ graph: { isBusinessOwned: false } }),
  buildProvisionPlan: jest.fn(),
  provisionSystemUser: jest.fn(),
  refreshCredential: jest.fn(),
  deactivateCredential: jest.fn(),
  safeProvisionResult: jest.fn((value) => value),
}))

import metaBusinessCredentialRoutes from '../src/routes/metaBusinessCredential.routes'

const createApp = () => {
  const app = express()
  app.use(express.json())
  app.use('/api/meta-business-credentials', metaBusinessCredentialRoutes)
  return app
}

describe('Meta System User route authorization', () => {
  beforeEach(() => {
    authState.user = {
      role: UserRole.MEMBER,
      userId: '665000000000000000000002',
      organizationId: '665000000000000000000001',
    }
  })

  it.each([
    ['get', '/api/meta-business-credentials/migration-inventory', undefined],
    ['get', '/api/meta-business-credentials/bootstrap-tokens', undefined],
    [
      'post',
      '/api/meta-business-credentials/discover-businesses',
      { bootstrapTokenId: 'token' },
    ],
    [
      'post',
      '/api/meta-business-credentials/inspect-application-ownership',
      { facebookAppId: 'app' },
    ],
    [
      'post',
      '/api/meta-business-credentials/provision',
      { confirmation: 'PROVISION_SYSTEM_USER' },
    ],
  ] as const)(
    'blocks non-super-admin access to %s %s',
    async (method, path, body) => {
      const call = request(createApp())[method](path)
      const response = body ? await call.send(body) : await call
      expect(response.status).toBe(403)
    },
  )

  it('allows a super admin to read the safe migration inventory', async () => {
    authState.user = {
      role: UserRole.SUPER_ADMIN,
      userId: '665000000000000000000099',
    }
    const response = await request(createApp())
      .get('/api/meta-business-credentials/migration-inventory')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      success: true,
      data: { organizations: [], apps: [] },
    })
  })
})
