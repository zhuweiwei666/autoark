import express from 'express'
import request from 'supertest'
import dayjs from 'dayjs'
import { UserRole } from '../src/models/User'

const mockAuthState: { user: any } = { user: null }

jest.mock('../src/middlewares/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = mockAuthState.user
    next()
  },
  getUserAccountIds: jest.fn(),
}))

jest.mock('../src/services/aggregation.service', () => ({
  refreshRecentDays: jest.fn(),
}))

jest.mock('../src/models/MaterialMetrics', () => ({
  __esModule: true,
  default: {
    aggregate: jest.fn(),
  },
}))

jest.mock('../src/models/Account', () => ({
  __esModule: true,
  default: {
    collection: { name: 'accounts' },
  },
}))

jest.mock('../src/models/Aggregation', () => ({
  AggDaily: {
    find: jest.fn(),
    findOne: jest.fn(),
  },
  AggCountry: {
    aggregate: jest.fn(),
  },
  AggAccount: {
    find: jest.fn(),
    aggregate: jest.fn(),
  },
  AggCampaign: {
    aggregate: jest.fn(),
  },
  AggOptimizer: {},
}))

import summaryRouter from '../src/controllers/summary.controller'
import { getUserAccountIds } from '../src/middlewares/auth'
import { AggAccount, AggCampaign, AggCountry, AggDaily } from '../src/models/Aggregation'
import MaterialMetrics from '../src/models/MaterialMetrics'

const createApp = () => {
  const app = express()
  app.use('/api/summary', summaryRouter)
  return app
}

describe('summary route data scoping', () => {
  afterEach(() => {
    jest.clearAllMocks()
    mockAuthState.user = null
  })

  it('does not expose global country summary to organization users', async () => {
    mockAuthState.user = {
      role: UserRole.ORG_ADMIN,
      organizationId: '665000000000000000000001',
      userId: '665000000000000000000002',
    }

    const response = await request(createApp()).get('/api/summary/countries')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      success: true,
      data: [],
      pagination: { page: 1, limit: 50, total: 0, pages: 0 },
      cached: true,
    })
    expect(AggCountry.aggregate).not.toHaveBeenCalled()
  })

  it('keeps global country summary available to super admins', async () => {
    mockAuthState.user = {
      role: UserRole.SUPER_ADMIN,
      userId: '665000000000000000000003',
    }
    ;(AggCountry.aggregate as jest.Mock).mockResolvedValue([
      {
        data: [{ country: 'US', spend: 10 }],
        total: [{ count: 1 }],
      },
    ])

    const response = await request(createApp()).get('/api/summary/countries?limit=10')

    expect(response.status).toBe(200)
    expect(response.body.data).toEqual([{ country: 'US', spend: 10 }])
    expect(response.body.pagination).toMatchObject({ page: 1, limit: 10, total: 1, pages: 1 })
    expect(AggCountry.aggregate).toHaveBeenCalledTimes(1)
  })

  it('returns scoped account summary to organization users', async () => {
    mockAuthState.user = {
      role: UserRole.ORG_ADMIN,
      organizationId: '665000000000000000000001',
      userId: '665000000000000000000002',
    }
    ;(getUserAccountIds as jest.Mock).mockResolvedValue(['act_123'])
    ;(AggAccount.aggregate as jest.Mock).mockResolvedValue([
      {
        data: [{ accountId: 'act_123', accountName: 'Scoped account', spend: 42 }],
        total: [{ count: 1 }],
      },
    ])

    const response = await request(createApp()).get('/api/summary/accounts?limit=10')

    expect(response.status).toBe(200)
    expect(response.body.data).toEqual([{ accountId: 'act_123', accountName: 'Scoped account', spend: 42 }])
    expect(response.body.pagination).toMatchObject({ page: 1, limit: 10, total: 1, pages: 1 })
    expect(AggAccount.aggregate).toHaveBeenCalledTimes(1)
    expect((AggAccount.aggregate as jest.Mock).mock.calls[0][0][0]).toMatchObject({
      $match: {
        accountId: { $in: ['123', 'act_123'] },
      },
    })
  })

  it('unions the account catalog so accounts without insight rows remain visible', async () => {
    mockAuthState.user = {
      role: UserRole.SUPER_ADMIN,
      userId: '665000000000000000000003',
    }
    ;(getUserAccountIds as jest.Mock).mockResolvedValue(null)
    ;(AggAccount.aggregate as jest.Mock).mockResolvedValue([{
      data: [{ accountId: '123', name: 'Catalog account', spend: 0 }],
      total: [{ count: 1 }],
    }])

    const response = await request(createApp()).get('/api/summary/accounts?limit=10')

    expect(response.status).toBe(200)
    const pipeline = (AggAccount.aggregate as jest.Mock).mock.calls[0][0]
    expect(pipeline).toEqual(expect.arrayContaining([
      expect.objectContaining({
        $unionWith: expect.objectContaining({ coll: 'accounts' }),
      }),
    ]))
  })

  it('filters account metadata after catalog and metrics are merged', async () => {
    mockAuthState.user = {
      role: UserRole.SUPER_ADMIN,
      userId: '665000000000000000000003',
    }
    ;(getUserAccountIds as jest.Mock).mockResolvedValue(null)
    ;(AggAccount.aggregate as jest.Mock).mockResolvedValue([{ data: [], total: [] }])

    const response = await request(createApp())
      .get('/api/summary/accounts?status=active&name=Catalog&optimizer=Alice')

    expect(response.status).toBe(200)
    const pipeline = (AggAccount.aggregate as jest.Mock).mock.calls[0][0]
    expect(pipeline[0].$match).not.toHaveProperty('status')
    expect(pipeline[0].$match).not.toHaveProperty('accountName')

    const unionStage = pipeline.find((stage: any) => stage.$unionWith)
    expect(unionStage.$unionWith.pipeline[0].$match).toEqual({ channel: 'facebook' })
    expect(pipeline).toEqual(expect.arrayContaining([
      {
        $match: {
          status: 'active',
          name: { $regex: 'Catalog', $options: 'i' },
          operator: { $regex: 'Alice', $options: 'i' },
        },
      },
    ]))
  })

  it('caps large summary limits and falls back to safe sort fields', async () => {
    mockAuthState.user = {
      role: UserRole.SUPER_ADMIN,
      userId: '665000000000000000000003',
    }
    ;(AggAccount.aggregate as jest.Mock).mockResolvedValue([
      {
        data: [{ accountId: 'act_999', accountName: 'Large account', spend: 99 }],
        total: [{ count: 250 }],
      },
    ])

    const response = await request(createApp())
      .get('/api/summary/accounts?limit=10000&page=3&sortBy=unsafeField')

    expect(response.status).toBe(200)
    expect(response.body.pagination).toMatchObject({ page: 3, limit: 100, total: 250, pages: 3 })

    const pipeline = (AggAccount.aggregate as jest.Mock).mock.calls[0][0]
    expect(pipeline.find((stage: any) => stage.$sort)).toEqual({ $sort: { spend: -1 } })
    expect(pipeline.find((stage: any) => stage.$facet).$facet.data).toEqual([
      { $skip: 200 },
      { $limit: 100 },
    ])
  })

  it('sanitizes account summary filter strings before aggregating', async () => {
    mockAuthState.user = {
      role: UserRole.SUPER_ADMIN,
      userId: '665000000000000000000003',
    }
    ;(getUserAccountIds as jest.Mock).mockResolvedValue(null)
    ;(AggAccount.aggregate as jest.Mock).mockResolvedValue([
      {
        data: [],
        total: [{ count: 0 }],
      },
    ])

    const response = await request(createApp())
      .get('/api/summary/accounts?status[$ne]=active&accountId[$ne]=123&name=a.b%2B[x]&limit=10')

    expect(response.status).toBe(200)
    const pipeline = (AggAccount.aggregate as jest.Mock).mock.calls[0][0]
    const sourceMatch = pipeline[0].$match
    expect(sourceMatch.status).toBeUndefined()
    expect(sourceMatch.accountId).toBeUndefined()
    expect(sourceMatch.accountName).toBeUndefined()
    const mergedMatch = pipeline.find((stage: any) => stage.$match?.name)?.$match
    expect(mergedMatch.name).toEqual({ $regex: 'a\\.b\\+\\[x\\]', $options: 'i' })
  })

  it('caps dashboard trend day windows before building the response', async () => {
    mockAuthState.user = {
      role: UserRole.SUPER_ADMIN,
      userId: '665000000000000000000003',
    }
    ;(getUserAccountIds as jest.Mock).mockResolvedValue(null)
    const findQuery = {
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    }
    ;(AggDaily.find as jest.Mock).mockReturnValue(findQuery)

    const response = await request(createApp()).get('/api/summary/dashboard/trend?days=100000')

    expect(response.status).toBe(200)
    expect(response.body.data).toHaveLength(90)
    expect(AggDaily.find).toHaveBeenCalledTimes(1)
    expect(findQuery.sort).toHaveBeenCalledWith({ date: 1 })
  })

  it('includes installs in every dashboard trend row', async () => {
    mockAuthState.user = {
      role: UserRole.SUPER_ADMIN,
      userId: '665000000000000000000003',
    }
    ;(getUserAccountIds as jest.Mock).mockResolvedValue(null)
    const findQuery = {
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{
        date: dayjs().format('YYYY-MM-DD'),
        spend: 25,
        installs: 17,
      }]),
    }
    ;(AggDaily.find as jest.Mock).mockReturnValue(findQuery)

    const response = await request(createApp()).get('/api/summary/dashboard/trend?days=7')

    expect(response.status).toBe(200)
    expect(response.body.data).toHaveLength(7)
    expect(response.body.data.at(-1)).toMatchObject({
      totalSpend: 25,
      totalInstalls: 17,
    })
  })

  it('sums installs in scoped dashboard trend rows', async () => {
    mockAuthState.user = {
      role: UserRole.ORG_ADMIN,
      organizationId: '665000000000000000000001',
      userId: '665000000000000000000002',
    }
    ;(getUserAccountIds as jest.Mock).mockResolvedValue(['act_123'])
    ;(AggAccount.aggregate as jest.Mock).mockResolvedValue([{
      date: dayjs().format('YYYY-MM-DD'),
      spend: 25,
      installs: 17,
    }])

    const response = await request(createApp()).get('/api/summary/dashboard/trend?days=7')

    expect(response.status).toBe(200)
    expect(response.body.data.at(-1)).toMatchObject({ totalInstalls: 17 })
    const pipeline = (AggAccount.aggregate as jest.Mock).mock.calls[0][0]
    expect(pipeline[1].$group.installs).toEqual({ $sum: '$installs' })
    expect(pipeline[2].$project.installs).toBe(1)
  })

  it('caps summary aggregation date ranges before querying account rows', async () => {
    mockAuthState.user = {
      role: UserRole.SUPER_ADMIN,
      userId: '665000000000000000000003',
    }
    ;(getUserAccountIds as jest.Mock).mockResolvedValue(null)
    ;(AggAccount.aggregate as jest.Mock).mockResolvedValue([
      {
        data: [{ accountId: 'act_999', accountName: 'Large account', spend: 99 }],
        total: [{ count: 1 }],
      },
    ])

    const response = await request(createApp())
      .get('/api/summary/accounts?startDate=2020-01-01&endDate=2026-06-02&limit=10')

    expect(response.status).toBe(200)
    const pipeline = (AggAccount.aggregate as jest.Mock).mock.calls[0][0]
    expect(pipeline[0]).toMatchObject({
      $match: {
        date: { $gte: '2026-03-05', $lte: '2026-06-02' },
      },
    })
  })

  it('rejects invalid summary date filters before querying aggregates', async () => {
    mockAuthState.user = {
      role: UserRole.SUPER_ADMIN,
      userId: '665000000000000000000003',
    }

    const response = await request(createApp()).get('/api/summary/dashboard?startDate=2026-02-30')

    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({
      success: false,
      error: 'startDate must be a valid YYYY-MM-DD date',
      meta: { maxDays: 90 },
    })
    expect(AggDaily.find).not.toHaveBeenCalled()
  })

  it('returns empty account summary when organization user has no linked accounts', async () => {
    mockAuthState.user = {
      role: UserRole.ORG_ADMIN,
      organizationId: '665000000000000000000001',
      userId: '665000000000000000000002',
    }
    ;(getUserAccountIds as jest.Mock).mockResolvedValue([])

    const response = await request(createApp()).get('/api/summary/accounts')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      success: true,
      data: [],
      pagination: { page: 1, limit: 100, total: 0, pages: 0 },
      cached: true,
    })
    expect(AggAccount.aggregate).not.toHaveBeenCalled()
  })

  it('matches campaign account filters across act_ account id formats', async () => {
    mockAuthState.user = {
      role: UserRole.ORG_ADMIN,
      organizationId: '665000000000000000000001',
      userId: '665000000000000000000002',
    }
    ;(getUserAccountIds as jest.Mock).mockResolvedValue(['123'])
    ;(AggCampaign.aggregate as jest.Mock).mockResolvedValue([
      {
        data: [{ campaignId: 'cmp_1', accountId: '123', spend: 42 }],
        total: [{ count: 1 }],
      },
    ])

    const response = await request(createApp()).get('/api/summary/campaigns?accountId=act_123&limit=10')

    expect(response.status).toBe(200)
    expect(response.body.data).toEqual([{ campaignId: 'cmp_1', accountId: '123', spend: 42 }])
    expect(AggCampaign.aggregate).toHaveBeenCalledTimes(1)
    expect((AggCampaign.aggregate as jest.Mock).mock.calls[0][0][0]).toMatchObject({
      $match: {
        accountId: { $in: ['123', 'act_123'] },
      },
    })
  })

  it('sanitizes material summary type filters before aggregating', async () => {
    mockAuthState.user = {
      role: UserRole.SUPER_ADMIN,
      userId: '665000000000000000000003',
    }
    ;(MaterialMetrics.aggregate as jest.Mock).mockResolvedValue([
      {
        data: [],
        total: [{ count: 0 }],
      },
    ])

    const objectTypeResponse = await request(createApp()).get('/api/summary/materials?type[$ne]=image&limit=10')
    const videoTypeResponse = await request(createApp()).get('/api/summary/materials?type=video&limit=10')

    expect(objectTypeResponse.status).toBe(200)
    expect(videoTypeResponse.status).toBe(200)
    const objectTypeMatch = (MaterialMetrics.aggregate as jest.Mock).mock.calls[0][0][0].$match
    const videoTypeMatch = (MaterialMetrics.aggregate as jest.Mock).mock.calls[1][0][0].$match
    expect(objectTypeMatch.materialType).toBeUndefined()
    expect(videoTypeMatch.materialType).toBe('video')
  })
})
