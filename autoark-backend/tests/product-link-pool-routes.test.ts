import express, { NextFunction, Request, Response } from 'express'
import request from 'supertest'
import { UserRole } from '../src/models/User'

const mockFind = jest.fn()
const mockFindOne = jest.fn()
const mockExists = jest.fn()
const mockCreate = jest.fn()
const mockFindOneAndUpdate = jest.fn()
const mockFindOneAndDelete = jest.fn()

type MockAuthUser = {
  role: UserRole
  userId: string
  organizationId: string
}

const mockAuthState: { user: MockAuthUser } = {
  user: {
    role: UserRole.ORG_ADMIN,
    userId: '665000000000000000000002',
    organizationId: '665000000000000000000001',
  },
}

jest.mock('../src/config/redis', () => ({
  getRedisClient: jest.fn(() => null),
}))

jest.mock('../src/middlewares/auth', () => {
  const actual = jest.requireActual('../src/middlewares/auth')
  return {
    ...actual,
    authenticate: (req: Request, _res: Response, next: NextFunction) => {
      req.user = mockAuthState.user
      next()
    },
  }
})

jest.mock('../src/models/ProductLinkPool', () => ({
  __esModule: true,
  PRODUCT_LINK_PLATFORMS: ['ios', 'android'],
  PRODUCT_LINK_POOL_STATUSES: ['active', 'inactive'],
  PRODUCT_LINK_WEIGHT_MAX: 1000,
  default: {
    find: mockFind,
    findOne: mockFindOne,
    exists: mockExists,
    create: mockCreate,
    findOneAndUpdate: mockFindOneAndUpdate,
    findOneAndDelete: mockFindOneAndDelete,
  },
}))

import productLinkPoolRoutes from '../src/routes/productLinkPool.routes'
import productLinkRedirectRoutes from '../src/routes/productLinkRedirect.routes'
import { resetProductLinkRoutingStateForTests } from '../src/services/productLinkRouting.service'

const createApp = () => {
  const app = express()
  app.set('trust proxy', 1)
  app.use(express.json())
  app.use('/r', productLinkRedirectRoutes)
  app.use('/api/product-link-pools', productLinkPoolRoutes)
  return app
}

const activePool = {
  _id: '665000000000000000000401',
  name: 'Creative Studio',
  shortCode: 'aB3kP9xQ',
  shortLinkDomain: 'go.remixhub.app',
  status: 'active',
  fallbackUrl: 'https://example.com/download',
  updatedAt: new Date('2026-07-28T00:00:00.000Z'),
  destinations: [
    {
      _id: 'ios-a',
      name: 'iOS A',
      platform: 'ios',
      url: 'https://apps.apple.com/app/a',
      weight: 3,
      enabled: true,
    },
    {
      _id: 'ios-b',
      name: 'iOS B',
      platform: 'ios',
      url: 'https://apps.apple.com/app/b',
      weight: 1,
      enabled: true,
    },
    {
      _id: 'android-a',
      name: 'Android A',
      platform: 'android',
      url: 'https://play.google.com/store/apps/details?id=a',
      weight: 1,
      enabled: true,
    },
  ],
}

describe('product link pool routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetProductLinkRoutingStateForTests()
    mockAuthState.user = {
      role: UserRole.ORG_ADMIN,
      userId: '665000000000000000000002',
      organizationId: '665000000000000000000001',
    }
    mockFindOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(activePool),
    })
  })

  it('blocks members from the product link pool management API', async () => {
    mockAuthState.user = {
      role: UserRole.MEMBER,
      userId: '665000000000000000000003',
      organizationId: '665000000000000000000001',
    }

    const response = await request(createApp()).get('/api/product-link-pools')

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({ success: false, message: '权限不足' })
    expect(mockFind).not.toHaveBeenCalled()
  })

  it('scopes product link pool reads to the authenticated organization', async () => {
    const lean = jest.fn().mockResolvedValue([])
    const sort = jest.fn().mockReturnValue({ lean })
    mockFind.mockReturnValue({ sort })

    const response = await request(createApp()).get('/api/product-link-pools')

    expect(response.status).toBe(200)
    expect(JSON.stringify(mockFind.mock.calls[0][0])).toContain(
      '665000000000000000000001',
    )
  })

  it('returns only the verified short-link domain catalog', async () => {
    const response = await request(createApp()).get(
      '/api/product-link-pools/domains',
    )

    expect(response.status).toBe(200)
    expect(response.body.data.defaultDomain).toBe('go.remixhub.app')
    expect(response.body.data.domains).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ hostname: 'app.autoark.work' }),
        expect.objectContaining({ hostname: 'go.remixhub.app' }),
      ]),
    )
    expect(response.body.data.domains).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ hostname: 'go.paycores.cc' }),
      ]),
    )
  })

  it('serializes the selected domain into the canonical short URL', async () => {
    const lean = jest.fn().mockResolvedValue([activePool])
    const sort = jest.fn().mockReturnValue({ lean })
    mockFind.mockReturnValue({ sort })

    const response = await request(createApp()).get('/api/product-link-pools')

    expect(response.status).toBe(200)
    expect(response.body.data[0]).toMatchObject({
      shortLinkDomain: 'go.remixhub.app',
      shortUrl: 'https://go.remixhub.app/r/aB3kP9xQ',
    })
  })

  it('persists a verified domain when creating a product pool', async () => {
    mockExists.mockResolvedValue(false)
    mockCreate.mockImplementation(async (payload) => ({
      _id: '665000000000000000000402',
      ...payload,
      destinations: [],
    }))

    const response = await request(createApp())
      .post('/api/product-link-pools')
      .send({
        name: 'Creative Studio',
        shortLinkDomain: 'go.remixhub.app',
      })

    expect(response.status).toBe(201)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ shortLinkDomain: 'go.remixhub.app' }),
    )
    expect(response.body.data.shortUrl).toMatch(
      /^https:\/\/go\.remixhub\.app\/r\/[A-Za-z0-9_-]{8}$/,
    )
  })

  it('switches the canonical domain without changing the short code', async () => {
    mockFindOneAndUpdate.mockResolvedValue({
      ...activePool,
      shortLinkDomain: 'go.bigloom.net',
    })

    const response = await request(createApp())
      .put('/api/product-link-pools/665000000000000000000401')
      .send({ shortLinkDomain: 'go.bigloom.net' })

    expect(response.status).toBe(200)
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      { $set: { shortLinkDomain: 'go.bigloom.net' } },
      { new: true, runValidators: true },
    )
    expect(response.body.data).toMatchObject({
      shortCode: 'aB3kP9xQ',
      shortLinkDomain: 'go.bigloom.net',
      shortUrl: 'https://go.bigloom.net/r/aB3kP9xQ',
    })
  })

  it('rejects a short-link domain outside the server allowlist', async () => {
    const response = await request(createApp())
      .post('/api/product-link-pools')
      .send({ name: 'Creative Studio', shortLinkDomain: 'evil.example' })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe(
      'shortLinkDomain is not an available short-link domain',
    )
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('rejects unsafe destination URLs before writing a product pool', async () => {
    const response = await request(createApp())
      .post('/api/product-link-pools')
      .send({
        name: 'Creative Studio',
        destinations: [
          {
            name: 'Unsafe',
            platform: 'ios',
            url: 'javascript:alert(1)',
            weight: 100,
            enabled: true,
          },
        ],
      })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe(
      'URL must be a valid http or https address',
    )
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('routes iOS traffic over a complete smooth weighted cycle', async () => {
    const app = createApp()
    const locations: string[] = []

    for (let requestIndex = 0; requestIndex < 4; requestIndex += 1) {
      const response = await request(app)
        .get('/r/aB3kP9xQ?campaign=summer')
        .set(
          'User-Agent',
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
        )

      expect(response.status).toBe(302)
      locations.push(response.headers.location)
    }

    expect(locations.filter((value) => value.includes('/app/a?'))).toHaveLength(
      3,
    )
    expect(locations.filter((value) => value.includes('/app/b?'))).toHaveLength(
      1,
    )
    expect(locations.every((value) => value.includes('campaign=summer'))).toBe(
      true,
    )
  })

  it('routes Android traffic only to Android destinations', async () => {
    const response = await request(createApp())
      .get('/r/aB3kP9xQ')
      .set('User-Agent', 'Mozilla/5.0 (Linux; Android 15; Pixel 9)')

    expect(response.status).toBe(302)
    expect(response.headers.location).toContain('play.google.com')
  })

  it('uses the fallback URL for unsupported devices', async () => {
    const response = await request(createApp())
      .get('/r/aB3kP9xQ?campaign=desktop')
      .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')

    expect(response.status).toBe(302)
    expect(response.headers.location).toBe(
      'https://example.com/download?campaign=desktop',
    )
  })

  it('returns 404 for unknown or inactive short codes without requiring authentication', async () => {
    mockFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) })

    const response = await request(createApp())
      .get('/r/missing1')
      .set('User-Agent', 'Mozilla/5.0 (iPhone)')

    expect(response.status).toBe(404)
    expect(response.text).toBe('Short link not found')
  })
})
