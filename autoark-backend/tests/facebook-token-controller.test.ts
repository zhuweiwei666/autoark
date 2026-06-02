const mockAxiosGet = jest.fn()
const mockFbTokenFindOneAndUpdate = jest.fn()

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: mockAxiosGet,
  },
}))

jest.mock('../src/models/FbToken', () => ({
  __esModule: true,
  default: {
    findOneAndUpdate: mockFbTokenFindOneAndUpdate,
  },
}))

import { saveFacebookToken } from '../src/controllers/facebookToken.controller'
import { UserRole } from '../src/models/User'

describe('legacy facebook token controller', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('sanitizes legacy save-token payloads and validates via axios params', async () => {
    mockAxiosGet.mockResolvedValue({
      data: { id: 'fb_1', name: 'Alice FB' },
    })
    mockFbTokenFindOneAndUpdate.mockResolvedValue({})
    const req: any = {
      user: {
        role: UserRole.ORG_ADMIN,
        userId: '665000000000000000000002',
        organizationId: '665000000000000000000001',
      },
      body: {
        token: `  ${'E'.repeat(5000)}  `,
        organizationId: '665000000000000000000999',
      },
    }
    const res: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    }

    await saveFacebookToken(req, res)

    expect(mockAxiosGet).toHaveBeenCalledWith(
      expect.stringMatching(/\/me$/),
      expect.objectContaining({
        params: {
          access_token: 'E'.repeat(4096),
        },
        timeout: 10000,
      }),
    )
    const update = mockFbTokenFindOneAndUpdate.mock.calls[0][1]
    expect(update.token).toHaveLength(4096)
    expect(update.organizationId).toBe(req.user.organizationId)
    expect(update.status).toBe('active')
    expect(res.json).toHaveBeenCalledWith({
      message: 'Facebook token saved successfully',
      fbUser: { id: 'fb_1', name: 'Alice FB' },
    })
  })
})
