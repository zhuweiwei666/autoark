const mockAxios = jest.fn()
const mockGetNextToken = jest.fn()
const mockMarkTokenFailure = jest.fn()
const mockMarkTokenSuccess = jest.fn()

jest.mock('axios', () => ({
  __esModule: true,
  default: mockAxios,
}))

jest.mock('../src/utils/fbToken', () => ({
  getFacebookAccessToken: jest.fn(),
}))

jest.mock('../src/integration/facebook/tokenPool', () => ({
  tokenPool: {
    getNextToken: mockGetNextToken,
    markTokenFailure: mockMarkTokenFailure,
    markTokenSuccess: mockMarkTokenSuccess,
  },
}))

jest.mock('../src/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    timerLog: jest.fn(),
  },
}))

import { facebookClient } from '../src/integration/facebook/facebookClient'

describe('Facebook client explicit-token isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('retries a rate-limited explicit token without switching to the pool', async () => {
    const timeout = jest.spyOn(global, 'setTimeout').mockImplementation(((
      callback: any,
    ) => {
      callback()
      return 0 as any
    }) as any)
    mockGetNextToken.mockReturnValue('DIFFERENT_TOKEN')
    mockAxios
      .mockRejectedValueOnce({
        message: 'Application request limit reached',
        response: {
          data: {
            error: {
              code: 4,
              message: 'Application request limit reached',
            },
          },
        },
      })
      .mockResolvedValueOnce({ data: { data: [{ id: 'row_1' }] } })

    const response = await facebookClient.get('/act_123/insights', {
      access_token: 'FIXED_TOKEN',
      fields: 'spend',
    })

    expect(response).toEqual({ data: [{ id: 'row_1' }] })
    expect(mockGetNextToken).not.toHaveBeenCalled()
    expect(mockMarkTokenFailure).toHaveBeenCalledWith(
      'FIXED_TOKEN',
      expect.any(Object),
    )
    expect(mockAxios).toHaveBeenCalledTimes(2)
    for (const [config] of mockAxios.mock.calls) {
      expect(config.params.access_token).toBe('FIXED_TOKEN')
    }
    timeout.mockRestore()
  })
})
