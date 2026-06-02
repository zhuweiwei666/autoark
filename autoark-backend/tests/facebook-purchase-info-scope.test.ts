const mockGetUserAccountIds = jest.fn()
const mockCampaignFindOne = jest.fn()
const mockGetPurchaseValueInfo = jest.fn()

jest.mock('../src/middlewares/auth', () => ({
  getUserAccountIds: mockGetUserAccountIds,
  getOrgFilter: jest.fn(),
}))

jest.mock('../src/models/Campaign', () => ({
  __esModule: true,
  default: {
    findOne: mockCampaignFindOne,
  },
}))

jest.mock('../src/services/facebook.purchase.correction', () => ({
  getPurchaseValueInfo: mockGetPurchaseValueInfo,
}))

jest.mock('../src/services/facebook.service', () => ({
  getCampaigns: jest.fn(),
  getAdSets: jest.fn(),
  getAds: jest.fn(),
  getInsightsDaily: jest.fn(),
}))

jest.mock('../src/services/facebook.accounts.service', () => ({
  syncAccountsFromTokens: jest.fn(),
  getAccounts: jest.fn(),
}))

jest.mock('../src/services/facebook.campaigns.service', () => ({
  syncCampaignsFromAdAccounts: jest.fn(),
  getCampaigns: jest.fn(),
}))

jest.mock('../src/services/facebook.campaigns.v2.service', () => ({
  syncCampaignsFromAdAccountsV2: jest.fn(),
  getQueueStatus: jest.fn(),
}))

jest.mock('../src/services/facebook.permissions.service', () => ({
  diagnoseToken: jest.fn(),
  diagnoseAllTokens: jest.fn(),
}))

jest.mock('../src/services/facebook.token.pool', () => ({
  tokenPool: {
    getTokenStatus: jest.fn(),
    getNextToken: jest.fn(),
  },
}))

jest.mock('../src/services/facebook.countries.service', () => ({
  getCountries: jest.fn(),
}))

jest.mock('../src/services/facebook.sync.service', () => ({
  getEffectiveAdAccounts: jest.fn(),
}))

jest.mock('../src/models/Ad', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
    findOneAndUpdate: jest.fn(),
  },
}))

jest.mock('../src/models/Account', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
  },
}))

jest.mock('../src/models/FbToken', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
  },
}))

import { UserRole } from '../src/models/User'
import { getPurchaseValueInfo } from '../src/controllers/facebook.controller'

const campaignQuery = (result: any) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(result),
  }),
})

const createReq = (query: any = {}) => ({
  query: {
    campaignId: 'camp_1',
    date: '2026-06-02',
    ...query,
  },
  user: {
    role: UserRole.ORG_ADMIN,
    organizationId: '665000000000000000000001',
    userId: '665000000000000000000002',
  },
}) as any

const createRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
}) as any

describe('facebook purchase value info scope', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('does not query purchase metrics when the campaign is unknown locally', async () => {
    mockCampaignFindOne.mockReturnValue(campaignQuery(null))
    const res = createRes()

    await getPurchaseValueInfo(createReq(), res, jest.fn())

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Campaign not found' })
    expect(mockGetPurchaseValueInfo).not.toHaveBeenCalled()
  })

  it('blocks purchase metrics for campaigns outside the requester account scope', async () => {
    mockCampaignFindOne.mockReturnValue(campaignQuery({ accountId: '123' }))
    mockGetUserAccountIds.mockResolvedValue(['999'])
    const res = createRes()

    await getPurchaseValueInfo(createReq(), res, jest.fn())

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Forbidden' })
    expect(mockGetPurchaseValueInfo).not.toHaveBeenCalled()
  })

  it('allows purchase metrics for campaigns inside the requester account scope', async () => {
    const info = { today: 1, yesterday: 0, last7d: 3, corrected: 3, lastUpdated: '2026-06-02T00:00:00.000Z' }
    mockCampaignFindOne.mockReturnValue(campaignQuery({ accountId: '123' }))
    mockGetUserAccountIds.mockResolvedValue(['act_123'])
    mockGetPurchaseValueInfo.mockResolvedValue(info)
    const res = createRes()

    await getPurchaseValueInfo(createReq({ country: 'US' }), res, jest.fn())

    expect(mockGetPurchaseValueInfo).toHaveBeenCalledWith('camp_1', '2026-06-02', 'US')
    expect(res.json).toHaveBeenCalledWith({ success: true, data: info })
  })
})
