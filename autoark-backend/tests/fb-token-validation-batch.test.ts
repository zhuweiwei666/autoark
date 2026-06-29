import axios from 'axios'
import FbToken from '../src/models/FbToken'
import { checkAllTokensStatus } from '../src/services/fbToken.validation.service'

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
    expect(sort).toHaveBeenCalledWith({ lastCheckedAt: 1, updatedAt: 1, _id: 1 })
    expect(limit).toHaveBeenCalledWith(2)
    expect(axios.get).toHaveBeenCalledTimes(4)
    expect(FbToken.findByIdAndUpdate).toHaveBeenCalledTimes(2)
    expect(summary).toMatchObject({
      totalFound: 250,
      checked: 2,
      succeeded: 2,
      failed: 0,
      limit: 2,
      concurrency: 1,
    })
  })
})
