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

import productMappingRoutes from '../src/routes/productMapping.routes'

const createApp = () => {
  const app = express()
  app.use(express.json())
  app.use('/api/product-mapping', productMappingRoutes)
  return app
}

describe('product mapping route authorization', () => {
  it.each([
    ['POST', '/api/product-mapping/products', { name: 'Demo', identifier: 'demo' }],
    ['PUT', '/api/product-mapping/products/665000000000000000000301', { name: 'Demo 2' }],
    ['POST', '/api/product-mapping/products/665000000000000000000301/pixels', { pixelId: 'pixel_1' }],
    ['DELETE', '/api/product-mapping/products/665000000000000000000301/pixels/pixel_1', {}],
    ['PUT', '/api/product-mapping/products/665000000000000000000301/primary-pixel', { pixelId: 'pixel_1' }],
    ['POST', '/api/product-mapping/products/665000000000000000000301/accounts', { accountId: 'act_123' }],
    ['POST', '/api/product-mapping/scan-products', {}],
    ['POST', '/api/product-mapping/match-pixels', {}],
    ['POST', '/api/product-mapping/discover-accounts', {}],
    ['POST', '/api/product-mapping/sync-all', {}],
  ] as const)('blocks members from %s %s', async (method, path, body) => {
    const app = createApp()
    const response = await request(app)[method.toLowerCase() as 'post' | 'put' | 'delete'](path).send(body)

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({
      success: false,
      message: '权限不足',
    })
  })
})
