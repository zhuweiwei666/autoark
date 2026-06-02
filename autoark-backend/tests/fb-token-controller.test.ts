const mockFbTokenFind = jest.fn()

jest.mock('../src/models/FbToken', () => ({
  __esModule: true,
  default: {
    find: mockFbTokenFind,
  },
}))

import { getTokens } from '../src/controllers/fbToken.controller'
import { UserRole } from '../src/models/User'

describe('fb token controller', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('caps token list pagination and never returns raw token values', async () => {
    const lean = jest.fn().mockResolvedValue([{
      _id: '665000000000000000000201',
      userId: '665000000000000000000002',
      token: 'EAA_REAL_FACEBOOK_TOKEN',
      optimizer: 'Alice',
      status: 'active',
      fbUserId: 'fb_1',
      fbUserName: 'Alice FB',
      createdAt: new Date('2026-06-01T00:00:00Z'),
      updatedAt: new Date('2026-06-01T00:00:00Z'),
    }])
    const limit = jest.fn(() => ({ lean }))
    const skip = jest.fn(() => ({ limit }))
    const sort = jest.fn(() => ({ skip }))
    mockFbTokenFind.mockReturnValue({ sort })

    const req: any = {
      user: {
        role: UserRole.ORG_ADMIN,
        userId: '665000000000000000000002',
        organizationId: '665000000000000000000001',
      },
      query: {
        page: '2',
        limit: '999',
      },
    }
    const res: any = {
      json: jest.fn(),
    }
    const next = jest.fn()

    await getTokens(req, res, next)

    const query = mockFbTokenFind.mock.calls[0][0]
    expect(String(query.organizationId)).toBe(req.user.organizationId)
    expect(sort).toHaveBeenCalledWith({ createdAt: -1 })
    expect(skip).toHaveBeenCalledWith(200)
    expect(limit).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [expect.not.objectContaining({ token: 'EAA_REAL_FACEBOOK_TOKEN' })],
      count: 1,
      pagination: {
        page: 2,
        pageSize: 200,
      },
    })
  })

  it('rejects invalid token list dates before querying', async () => {
    const req: any = {
      user: {
        role: UserRole.ORG_ADMIN,
        userId: '665000000000000000000002',
        organizationId: '665000000000000000000001',
      },
      query: {
        startDate: '2026-02-31',
      },
    }
    const res: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    }
    const next = jest.fn()

    await getTokens(req, res, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'startDate must be a valid YYYY-MM-DD date',
    })
    expect(mockFbTokenFind).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  it('uses inclusive day boundaries for token list date filters', async () => {
    const lean = jest.fn().mockResolvedValue([])
    const limit = jest.fn(() => ({ lean }))
    const skip = jest.fn(() => ({ limit }))
    const sort = jest.fn(() => ({ skip }))
    mockFbTokenFind.mockReturnValue({ sort })

    const req: any = {
      user: {
        role: UserRole.ORG_ADMIN,
        userId: '665000000000000000000002',
        organizationId: '665000000000000000000001',
      },
      query: {
        startDate: '2026-06-02',
        endDate: '2026-06-02',
      },
    }
    const res: any = {
      json: jest.fn(),
    }
    const next = jest.fn()

    await getTokens(req, res, next)

    const query = mockFbTokenFind.mock.calls[0][0]
    expect(query.createdAt.$gte).toBeInstanceOf(Date)
    expect(query.createdAt.$lte).toBeInstanceOf(Date)
    expect(query.createdAt.$gte.getTime()).toBeLessThan(query.createdAt.$lte.getTime())
  })
})
