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

import accountManagementRoutes from '../src/routes/account.management.routes'

const createApp = () => {
  const app = express()
  app.use(express.json())
  app.use('/api/account-management', accountManagementRoutes)
  return app
}

describe('account management route authorization', () => {
  it.each([
    ['POST', '/api/account-management/accounts/act_123/tags', { tags: ['vip'] }],
    ['DELETE', '/api/account-management/accounts/act_123/tags', { tags: ['vip'] }],
    ['PUT', '/api/account-management/accounts/act_123/notes', { notes: 'note' }],
    ['POST', '/api/account-management/groups', { name: 'Group A' }],
  ] as const)('blocks members from %s %s', async (method, path, body) => {
    const app = createApp()
    const response = await request(app)[method.toLowerCase() as 'post' | 'delete' | 'put'](path).send(body)

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({
      success: false,
      message: '权限不足',
    })
  })
})
