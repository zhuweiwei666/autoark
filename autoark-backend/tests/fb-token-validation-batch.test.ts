import axios from 'axios'
import FbToken from '../src/models/FbToken'
import {
  checkAllTokensStatus,
  checkAndUpdateTokenStatus,
} from '../src/services/fbToken.validation.service'

jest.mock('axios', () => ({
  get: jest.fn(),
}))

jest.mock('../src/models/FbToken', () => ({
  __esModule: true,
  default: {
    countDocuments: jest.fn(),
    find: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  },
}))

describe('facebook token validation batch', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('validates only a bounded oldest-check batch', async () => {
    const tokens = [
      { _id: 'token_1', token: 'access_1', userId: 'user_1' },
      { _id: 'token_2', token: 'access_2', userId: 'user_2' },
    ]
    const limit = jest.fn().mockResolvedValue(tokens)
    const sort = jest.fn().mockReturnValue({ limit })
    ;(FbToken.countDocuments as jest.Mock).mockResolvedValue(250)
    ;(FbToken.find as jest.Mock).mockReturnValue({ sort })
    ;(FbToken.findByIdAndUpdate as jest.Mock).mockResolvedValue({})
    ;(axios.get as jest.Mock).mockImplementation(async (url: string) => {
      if (url.includes('/debug_token')) {
        return { data: { data: { expires_at: Math.floor(Date.now() / 1000) + 3600 } } }
      }
      return { data: { id: `fb_${url}`, name: 'Meta User' } }
    })

    const summary = await checkAllTokensStatus({ limit: 2, concurrency: 1 })

    expect(FbToken.countDocuments).toHaveBeenCalledWith({})
    expect(FbToken.find).toHaveBeenCalledWith({})
    expect(sort).toHaveBeenCalledWith({
      lastValidationAttemptAt: 1,
      lastCheckedAt: 1,
      updatedAt: 1,
      _id: 1,
    })
    expect(limit).toHaveBeenCalledWith(2)
    expect(axios.get).toHaveBeenCalledTimes(4)
    expect(FbToken.findByIdAndUpdate).toHaveBeenCalledTimes(2)
    expect(summary).toMatchObject({
      totalFound: 250,
      checked: 2,
      succeeded: 2,
      failed: 0,
      valid: 2,
      invalid: 0,
      transient: 0,
      limit: 2,
      concurrency: 1,
    })
  })

  it('preserves an active token when Meta validation is temporarily rate limited', async () => {
    const rateLimitError: any = new Error('Application request limit reached')
    rateLimitError.response = {
      status: 400,
      data: { error: { code: 4, message: '(#4) Application request limit reached' } },
    }
    ;(axios.get as jest.Mock).mockRejectedValue(rateLimitError)
    ;(FbToken.findByIdAndUpdate as jest.Mock).mockResolvedValue({})

    const status = await checkAndUpdateTokenStatus({
      _id: 'token_1',
      token: 'access_1',
      userId: 'user_1',
      status: 'active',
    } as any)

    expect(status).toBe('active')
    expect(FbToken.findByIdAndUpdate).toHaveBeenCalledWith(
      'token_1',
      expect.objectContaining({
        lastValidationAttemptAt: expect.any(Date),
        lastValidationError: '(#4) Application request limit reached',
      }),
    )
    const rateLimitUpdate = (FbToken.findByIdAndUpdate as jest.Mock).mock.calls[0][1]
    expect(rateLimitUpdate).not.toHaveProperty('status')
    expect(rateLimitUpdate).not.toHaveProperty('lastCheckedAt')
  })

  it('reports transient Meta failures as failed batch checks instead of successes', async () => {
    const tokens = [{
      _id: 'token_1',
      token: 'access_1',
      userId: 'user_1',
      status: 'active',
    }]
    const limit = jest.fn().mockResolvedValue(tokens)
    const sort = jest.fn().mockReturnValue({ limit })
    const rateLimitError: any = new Error('Application request limit reached')
    rateLimitError.response = {
      status: 400,
      data: { error: { code: 4, message: '(#4) Application request limit reached' } },
    }
    ;(FbToken.countDocuments as jest.Mock).mockResolvedValue(1)
    ;(FbToken.find as jest.Mock).mockReturnValue({ sort })
    ;(FbToken.findByIdAndUpdate as jest.Mock).mockResolvedValue({})
    ;(axios.get as jest.Mock).mockRejectedValue(rateLimitError)

    const summary = await checkAllTokensStatus({ limit: 1, concurrency: 1 })

    expect(summary).toMatchObject({
      checked: 1,
      succeeded: 0,
      failed: 1,
      valid: 0,
      invalid: 0,
      transient: 1,
    })
  })

  it('marks a token invalid only for a definitive OAuth token error', async () => {
    const invalidTokenError: any = new Error('Invalid OAuth access token')
    invalidTokenError.response = {
      status: 400,
      data: { error: { code: 190, message: 'Invalid OAuth 2.0 Access Token' } },
    }
    ;(axios.get as jest.Mock).mockRejectedValue(invalidTokenError)
    ;(FbToken.findByIdAndUpdate as jest.Mock).mockResolvedValue({})

    const status = await checkAndUpdateTokenStatus({
      _id: 'token_1',
      token: 'access_1',
      userId: 'user_1',
      status: 'active',
    } as any)

    expect(status).toBe('invalid')
    expect(FbToken.findByIdAndUpdate).toHaveBeenCalledWith(
      'token_1',
      expect.objectContaining({ status: 'invalid' }),
    )
  })

  it('recognizes string code 102 as a definitive invalid session', async () => {
    const invalidSessionError: any = new Error('Session key invalid')
    invalidSessionError.response = {
      status: 400,
      data: { error: { code: '102', message: 'Session key invalid' } },
    }
    ;(axios.get as jest.Mock).mockRejectedValue(invalidSessionError)
    ;(FbToken.findByIdAndUpdate as jest.Mock).mockResolvedValue({})

    const status = await checkAndUpdateTokenStatus({
      _id: 'token_1',
      token: 'access_1',
      userId: 'user_1',
      status: 'expired',
    } as any)

    expect(status).toBe('invalid')
  })

  it('preserves an already invalid status when a retry is transient', async () => {
    const timeoutError: any = new Error('timeout of 10000ms exceeded')
    timeoutError.code = 'ECONNABORTED'
    ;(axios.get as jest.Mock).mockRejectedValue(timeoutError)
    ;(FbToken.findByIdAndUpdate as jest.Mock).mockResolvedValue({})

    const status = await checkAndUpdateTokenStatus({
      _id: 'token_1',
      token: 'access_1',
      userId: 'user_1',
      status: 'invalid',
    } as any)

    expect(status).toBe('invalid')
    const timeoutUpdate = (FbToken.findByIdAndUpdate as jest.Mock).mock.calls[0][1]
    expect(timeoutUpdate).not.toHaveProperty('status')
    expect(timeoutUpdate).not.toHaveProperty('lastCheckedAt')
  })

  it('reactivates a previously invalid token after Meta confirms it is valid', async () => {
    ;(axios.get as jest.Mock)
      .mockResolvedValueOnce({ data: { id: 'fb_1', name: 'Meta User' } })
      .mockResolvedValueOnce({ data: { data: { expires_at: 0 } } })
    ;(FbToken.findByIdAndUpdate as jest.Mock).mockResolvedValue({})

    const status = await checkAndUpdateTokenStatus({
      _id: 'token_1',
      token: 'access_1',
      userId: 'user_1',
      status: 'invalid',
    } as any)

    expect(status).toBe('active')
    expect(FbToken.findByIdAndUpdate).toHaveBeenCalledWith(
      'token_1',
      expect.objectContaining({ status: 'active', fbUserId: 'fb_1' }),
    )
  })
})
