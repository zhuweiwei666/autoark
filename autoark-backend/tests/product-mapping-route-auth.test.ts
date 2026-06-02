import express from 'express'
import request from 'supertest'
import { UserRole } from '../src/models/User'

const mockProductFind = jest.fn()
const mockProductCountDocuments = jest.fn()

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

jest.mock('../src/models/Product', () => ({
  __esModule: true,
  default: {
    find: mockProductFind,
    countDocuments: mockProductCountDocuments,
  },
}))

import productMappingRoutes from '../src/routes/productMapping.routes'
import * as productMappingService from '../src/services/productMapping.service'

const createApp = () => {
  const app = express()
  app.use(express.json())
  app.use('/api/product-mapping', productMappingRoutes)
  return app
}

const productListQuery = (value: any[]) => ({
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  populate: jest.fn().mockResolvedValue(value),
})

describe('product mapping route authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuthState.user = {
      role: UserRole.MEMBER,
      userId: '665000000000000000000002',
      organizationId: '665000000000000000000001',
    }
    mockProductFind.mockReturnValue(productListQuery([]))
    mockProductCountDocuments.mockResolvedValue(0)
  })

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

  it('caps product list pagination and escapes search input', async () => {
    mockAuthState.user = {
      role: UserRole.ORG_ADMIN,
      userId: '665000000000000000000002',
      organizationId: '665000000000000000000001',
    }
    const query = productListQuery([{ name: 'Demo' }])
    mockProductFind.mockReturnValue(query)
    mockProductCountDocuments.mockResolvedValue(250)

    const response = await request(createApp())
      .get('/api/product-mapping/products?page=3&limit=9999&status[$ne]=archived&search=a.b%2B[x]')

    expect(response.status).toBe(200)
    expect(query.skip).toHaveBeenCalledWith(200)
    expect(query.limit).toHaveBeenCalledWith(100)
    expect(response.body).toMatchObject({
      success: true,
      total: 250,
      pagination: {
        page: 3,
        pageSize: 100,
        total: 250,
        totalPages: 3,
      },
    })

    const productQueryText = JSON.stringify(mockProductFind.mock.calls[0][0])
    expect(productQueryText).toContain('a\\\\.b\\\\+\\\\[x\\\\]')
    expect(productQueryText).not.toContain('$ne')
  })

  it('sanitizes pixel match confidence thresholds', async () => {
    mockAuthState.user = {
      role: UserRole.ORG_ADMIN,
      userId: '665000000000000000000002',
      organizationId: '665000000000000000000001',
    }
    const matchProductsWithPixels = jest
      .spyOn(productMappingService, 'matchProductsWithPixels')
      .mockResolvedValue({ matched: 0 } as any)

    const negativeResponse = await request(createApp()).post('/api/product-mapping/match-pixels?minConfidence=-20')
    const oversizedResponse = await request(createApp()).post('/api/product-mapping/match-pixels?minConfidence=9999')

    expect(negativeResponse.status).toBe(200)
    expect(oversizedResponse.status).toBe(200)
    expect(matchProductsWithPixels).toHaveBeenNthCalledWith(
      1,
      50,
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
    )
    expect(matchProductsWithPixels).toHaveBeenNthCalledWith(
      2,
      100,
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
    )
  })

  it('rejects unsafe product URL query values', async () => {
    const app = createApp()

    const objectUrlResponse = await request(app).get('/api/product-mapping/parse-url?url[$ne]=https://example.com')
    const invalidUrlResponse = await request(app).get('/api/product-mapping/find-by-url?url=not-a-url')

    expect(objectUrlResponse.status).toBe(400)
    expect(objectUrlResponse.body).toMatchObject({
      success: false,
      error: 'url parameter is required',
    })
    expect(invalidUrlResponse.status).toBe(400)
    expect(invalidUrlResponse.body).toMatchObject({
      success: false,
      error: 'url parameter must be a valid URL',
    })
  })
})
