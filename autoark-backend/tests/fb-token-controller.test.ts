const mockFbTokenFind = jest.fn()
const mockFbTokenFindOneAndUpdate = jest.fn()
const mockValidateToken = jest.fn()

jest.mock('../src/models/FbToken', () => ({
  __esModule: true,
  default: {
    find: mockFbTokenFind,
    findOneAndUpdate: mockFbTokenFindOneAndUpdate,
  },
}))

jest.mock('../src/services/fbToken.validation.service', () => ({
  validateToken: mockValidateToken,
  checkAndUpdateTokenStatus: jest.fn(),
}))

import { bindToken, getTokens, updateToken } from '../src/controllers/fbToken.controller'
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

  it('sanitizes token list optimizer and status filters', async () => {
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
        optimizer: `  ${'o'.repeat(120)}  `,
        status: 'deleted',
      },
    }
    const res: any = {
      json: jest.fn(),
    }
    const next = jest.fn()

    await getTokens(req, res, next)

    const query = mockFbTokenFind.mock.calls[0][0]
    expect(query.optimizer).toHaveLength(80)
    expect(query).not.toHaveProperty('status')
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

  it('sanitizes token optimizer updates and ignores unrelated fields', async () => {
    const lean = jest.fn().mockResolvedValue({
      _id: '665000000000000000000201',
      userId: '665000000000000000000002',
      optimizer: 'o'.repeat(80),
      status: 'active',
      fbUserId: 'fb_1',
      fbUserName: 'Alice FB',
      createdAt: new Date('2026-06-01T00:00:00Z'),
      updatedAt: new Date('2026-06-02T00:00:00Z'),
    })
    mockFbTokenFindOneAndUpdate.mockReturnValue({ lean })

    const req: any = {
      params: { id: '665000000000000000000201' },
      user: {
        role: UserRole.ORG_ADMIN,
        userId: '665000000000000000000002',
        organizationId: '665000000000000000000001',
      },
      body: {
        optimizer: `  ${'o'.repeat(120)}  `,
        token: 'EAA_SHOULD_NOT_UPDATE',
        status: 'invalid',
        organizationId: '665000000000000000000999',
      },
    }
    const res: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    }
    const next = jest.fn()

    await updateToken(req, res, next)

    const update = mockFbTokenFindOneAndUpdate.mock.calls[0][1]
    expect(update.optimizer).toHaveLength(80)
    expect(update).not.toHaveProperty('token')
    expect(update).not.toHaveProperty('status')
    expect(update).not.toHaveProperty('organizationId')
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      message: 'Token updated successfully',
    }))
  })

  it('sanitizes token and optimizer values before validation and binding', async () => {
    mockValidateToken.mockResolvedValue({
      isValid: true,
      fbUser: { id: 'fb_1', name: 'Alice FB' },
      expiresAt: new Date('2026-07-01T00:00:00Z'),
    })
    mockFbTokenFindOneAndUpdate.mockResolvedValue({
      _id: '665000000000000000000201',
      userId: '665000000000000000000002',
      optimizer: 'o'.repeat(80),
      status: 'active',
      fbUserId: 'fb_1',
      fbUserName: 'Alice FB',
      expiresAt: new Date('2026-07-01T00:00:00Z'),
      lastCheckedAt: new Date('2026-06-02T00:00:00Z'),
    })

    const req: any = {
      user: {
        role: UserRole.ORG_ADMIN,
        userId: '665000000000000000000002',
        organizationId: '665000000000000000000001',
      },
      body: {
        token: `  ${'E'.repeat(5000)}  `,
        optimizer: `  ${'o'.repeat(120)}  `,
        status: 'invalid',
        organizationId: '665000000000000000000999',
      },
    }
    const res: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    }
    const next = jest.fn()

    await bindToken(req, res, next)

    const validatedToken = mockValidateToken.mock.calls[0][0]
    expect(validatedToken).toHaveLength(4096)
    const savedTokenData = mockFbTokenFindOneAndUpdate.mock.calls[0][1]
    expect(savedTokenData.optimizer).toHaveLength(80)
    expect(savedTokenData.status).toBe('active')
    expect(savedTokenData.organizationId).toBe(req.user.organizationId)
    expect(savedTokenData).not.toHaveProperty('createdBy')
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      message: 'Facebook token saved successfully',
    }))
  })
})
