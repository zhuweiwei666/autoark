const mockGetUserAccountIds = jest.fn()
const mockCampaignFindOne = jest.fn()
const mockCampaignFindOneAndUpdate = jest.fn()
const mockGetPurchaseValueInfo = jest.fn()
const mockTokenPoolGetNextToken = jest.fn()

jest.mock('../src/middlewares/auth', () => ({
  getUserAccountIds: mockGetUserAccountIds,
  getOrgFilter: jest.fn(),
}))

jest.mock('../src/models/Campaign', () => ({
  __esModule: true,
  default: {
    findOne: mockCampaignFindOne,
    findOneAndUpdate: mockCampaignFindOneAndUpdate,
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
    getNextToken: mockTokenPoolGetNextToken,
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
import Account from '../src/models/Account'
import Ad from '../src/models/Ad'
import { tokenPool } from '../src/services/facebook.token.pool'
import { getPurchaseValueInfo, updateCampaignStatus } from '../src/controllers/facebook.controller'

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

  it('looks up purchase metrics only from local Facebook campaigns', async () => {
    mockCampaignFindOne.mockReturnValue(campaignQuery(null))
    const res = createRes()

    await getPurchaseValueInfo(createReq(), res, jest.fn())

    expect(mockCampaignFindOne).toHaveBeenCalledWith({
      channel: 'facebook',
      campaignId: 'camp_1',
    })
    expect(mockGetPurchaseValueInfo).not.toHaveBeenCalled()
  })

  it('rejects unsafe purchase campaign identifiers before lookup', async () => {
    const res = createRes()
    const next = jest.fn()

    await getPurchaseValueInfo(createReq({ campaignId: { $ne: 'camp_1' } }), res, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'campaignId and date are required',
    })
    expect(mockCampaignFindOne).not.toHaveBeenCalled()
    expect(mockGetPurchaseValueInfo).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects invalid purchase metric dates before lookup', async () => {
    const res = createRes()
    const next = jest.fn()

    await getPurchaseValueInfo(createReq({ date: '2026-02-31' }), res, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'date must be a valid YYYY-MM-DD date',
    })
    expect(mockCampaignFindOne).not.toHaveBeenCalled()
    expect(mockGetPurchaseValueInfo).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
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

  it('drops unsafe purchase country filters before service lookup', async () => {
    const info = { today: 1, yesterday: 0, last7d: 3, corrected: 3, lastUpdated: '2026-06-02T00:00:00.000Z' }
    mockCampaignFindOne.mockReturnValue(campaignQuery({ accountId: '123' }))
    mockGetUserAccountIds.mockResolvedValue(['act_123'])
    mockGetPurchaseValueInfo.mockResolvedValue(info)
    const res = createRes()

    await getPurchaseValueInfo(createReq({ country: { $ne: 'US' } }), res, jest.fn())

    expect(mockGetPurchaseValueInfo).toHaveBeenCalledWith('camp_1', '2026-06-02', undefined)
    expect(res.json).toHaveBeenCalledWith({ success: true, data: info })
  })

  it('updates campaign status with the token attached to the campaign account', async () => {
    mockCampaignFindOne.mockReturnValue(campaignQuery({ accountId: '123' }))
    ;(Account.findOne as jest.Mock).mockReturnValue(campaignQuery({ token: 'ACCOUNT_TOKEN' }))
    ;(Ad.find as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      }),
    })
    mockCampaignFindOneAndUpdate.mockResolvedValue({})
    const fetchMock = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ success: true }),
    })
    ;(global as any).fetch = fetchMock

    const req: any = {
      params: { campaignId: 'camp_1' },
      body: { status: 'PAUSED' },
      user: {
        role: UserRole.SUPER_ADMIN,
        userId: '665000000000000000000000',
      },
    }
    const res = createRes()

    await updateCampaignStatus(req, res, jest.fn())

    expect(tokenPool.getNextToken).not.toHaveBeenCalled()
    expect(Account.findOne).toHaveBeenCalledWith({
      channel: 'facebook',
      accountId: { $in: ['123', 'act_123'] },
    })
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/camp_1'), expect.objectContaining({
      body: JSON.stringify({
        access_token: 'ACCOUNT_TOKEN',
        status: 'PAUSED',
      }),
    }))
    expect(mockCampaignFindOneAndUpdate).toHaveBeenCalledWith(
      { channel: 'facebook', campaignId: 'camp_1', accountId: '123' },
      { status: 'PAUSED', updatedAt: expect.any(Date) },
    )
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Campaign status updated to PAUSED',
      data: { campaignId: 'camp_1', status: 'PAUSED' },
    })
  })
})
