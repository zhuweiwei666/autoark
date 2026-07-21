const mockAxiosGet = jest.fn()

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: mockAxiosGet,
  },
}))

jest.mock('../src/models', () => ({
  MetricsDaily: {
    findOneAndUpdate: jest.fn(),
  },
}))

jest.mock('../src/services/facebook.sync.service', () => ({
  getEffectiveAdAccounts: jest.fn(),
}))

jest.mock('../src/utils/fbToken', () => ({
  getFacebookAccessToken: jest.fn(),
}))

import {
  getAccountInfo,
  getCampaigns,
  getAdSets,
  getAds,
} from '../src/services/facebook.service'

describe('facebook account-level API identifiers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAxiosGet.mockResolvedValue({ data: { data: [] } })
  })

  it.each([
    ['account info', getAccountInfo, ''],
    ['campaigns', getCampaigns, '/campaigns'],
    ['ad sets', getAdSets, '/adsets'],
    ['ads', getAds, '/ads'],
  ])('normalizes an unprefixed account ID for %s', async (_label, method, suffix) => {
    await method('1234567890', 'TOKEN')

    expect(mockAxiosGet).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`/act_1234567890${suffix}$`)),
      expect.any(Object),
    )
  })

  it('does not duplicate an existing act_ prefix', async () => {
    await getAds('act_1234567890', 'TOKEN')

    expect(mockAxiosGet).toHaveBeenCalledWith(
      expect.stringMatching(/\/act_1234567890\/ads$/),
      expect.any(Object),
    )
  })
})
