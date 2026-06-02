import FbToken from '../src/models/FbToken'
import { fbClient } from '../src/services/facebook.api'
import { diagnoseAllTokens } from '../src/services/facebook.permissions.service'

jest.mock('../src/services/facebook.api', () => ({
  fbClient: {
    get: jest.fn(),
  },
}))

jest.mock('../src/models/FbToken', () => ({
  __esModule: true,
  default: {
    countDocuments: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
  },
}))

describe('facebook permission diagnosis batch', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('diagnoses only a bounded active-token batch', async () => {
    const tokens = [
      { _id: 'token_1', fbUserId: 'fb_1', fbUserName: 'Alice' },
      { _id: 'token_2', fbUserId: 'fb_2', fbUserName: 'Bob' },
    ]
    const limit = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(tokens) })
    const sort = jest.fn().mockReturnValue({ limit })
    ;(FbToken.countDocuments as jest.Mock).mockResolvedValue(25)
    ;(FbToken.find as jest.Mock).mockReturnValue({ sort })
    ;(FbToken.findById as jest.Mock).mockImplementation(async (tokenId: string) => ({
      _id: tokenId,
      token: `access_${tokenId}`,
      fbUserId: `fb_${tokenId}`,
      fbUserName: `User ${tokenId}`,
    }))
    ;(fbClient.get as jest.Mock).mockImplementation(async (path: string) => {
      if (path === '/me/adaccounts') return { data: [{ id: 'act_1' }] }
      return { data: [] }
    })

    const diagnosis = await diagnoseAllTokens({ limit: 2 })

    expect(FbToken.countDocuments).toHaveBeenCalledWith({ status: 'active' })
    expect(FbToken.find).toHaveBeenCalledWith({ status: 'active' })
    expect(sort).toHaveBeenCalledWith({ lastCheckedAt: 1, updatedAt: 1, _id: 1 })
    expect(limit).toHaveBeenCalledWith(2)
    expect(FbToken.findById).toHaveBeenCalledTimes(2)
    expect(diagnosis.results).toHaveLength(2)
    expect(diagnosis.meta).toMatchObject({
      totalFound: 25,
      checked: 2,
      limit: 2,
      truncated: true,
    })
  })
})
