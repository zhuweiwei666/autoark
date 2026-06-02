const mockCreateCampaign = jest.fn()
const mockCreateAdSet = jest.fn()
const mockCreateAdCreative = jest.fn()
const mockCreateAd = jest.fn()
const mockUpdateCampaign = jest.fn()
const mockUpdateAdSet = jest.fn()
const mockUpdateAd = jest.fn()
const mockUploadImageFromUrl = jest.fn()
const mockUploadVideoFromUrl = jest.fn()
const mockSearchTargetingInterests = jest.fn()
const mockSearchTargetingLocations = jest.fn()
const mockGetPages = jest.fn()
const mockGetPixels = jest.fn()
const mockGetCustomConversions = jest.fn()
const mockFetchCampaigns = jest.fn()
const mockFetchInsights = jest.fn()
const mockFbTokenFindOne = jest.fn()
const mockAccountFind = jest.fn()
const mockCampaignFindOne = jest.fn()
const mockAdSetFindOne = jest.fn()
const mockAdFindOne = jest.fn()

jest.mock('../src/integration/facebook/bulkCreate.api', () => ({
  createCampaign: mockCreateCampaign,
  createAdSet: mockCreateAdSet,
  createAdCreative: mockCreateAdCreative,
  createAd: mockCreateAd,
  updateCampaign: mockUpdateCampaign,
  updateAdSet: mockUpdateAdSet,
  updateAd: mockUpdateAd,
  uploadImageFromUrl: mockUploadImageFromUrl,
  uploadVideoFromUrl: mockUploadVideoFromUrl,
  searchTargetingInterests: mockSearchTargetingInterests,
  searchTargetingLocations: mockSearchTargetingLocations,
  getPages: mockGetPages,
  getPixels: mockGetPixels,
  getCustomConversions: mockGetCustomConversions,
}))

jest.mock('../src/integration/facebook/campaigns.api', () => ({
  fetchCampaigns: mockFetchCampaigns,
}))

jest.mock('../src/integration/facebook/insights.api', () => ({
  fetchInsights: mockFetchInsights,
}))

jest.mock('../src/models/FbToken', () => ({
  __esModule: true,
  default: {
    findOne: mockFbTokenFindOne,
  },
}))

jest.mock('../src/models/Account', () => ({
  __esModule: true,
  default: {
    find: mockAccountFind,
  },
}))

jest.mock('../src/models/Campaign', () => ({
  __esModule: true,
  default: {
    findOne: mockCampaignFindOne,
  },
}))

jest.mock('../src/models/AdSet', () => ({
  __esModule: true,
  default: {
    findOne: mockAdSetFindOne,
  },
}))

jest.mock('../src/models/Ad', () => ({
  __esModule: true,
  default: {
    findOne: mockAdFindOne,
  },
}))

import { facebookTools } from '../src/agent/tools/facebook.tools'

const chain = (result: any) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(result),
})

const getTool = (name: string) => {
  const tool = facebookTools.find(item => item.name === name)
  if (!tool) throw new Error(`Missing tool ${name}`)
  return tool
}

const context = (accountIds: string[] = ['123']) => ({
  agentId: 'agent_1',
  agentConfig: {},
  sessionId: 'session_1',
  mode: 'auto',
  permissions: {},
  objectives: {},
  fbToken: 'FB_TOKEN',
  scope: {
    adAccountIds: accountIds,
    fbTokenIds: [],
    tiktokTokenIds: [],
    facebookAppIds: [],
  },
}) as any

describe('agent Facebook tools account scoping', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('blocks account-level writes outside the agent scope before calling Graph', async () => {
    const result = await getTool('create_campaign').handler(
      { accountId: 'act_999', name: 'New', objective: 'OUTCOME_SALES', status: 'PAUSED', reason: 'test' },
      context(['123']),
    )

    expect(result).toMatchObject({
      success: false,
      metadata: { scopedOut: true },
    })
    expect(mockCreateCampaign).not.toHaveBeenCalled()
  })

  it('allows account-level reads inside the agent scope', async () => {
    mockFetchCampaigns.mockResolvedValueOnce([{ id: 'camp_1', name: 'Campaign', status: 'ACTIVE', objective: 'SALES' }])

    const result = await getTool('get_campaigns').handler({ accountId: 'act_123' }, context(['123']))

    expect(mockFetchCampaigns).toHaveBeenCalledWith('act_123', 'FB_TOKEN')
    expect(result).toMatchObject({
      success: true,
      metadata: { count: 1 },
    })
  })

  it('blocks entity insights when the local campaign belongs to another scoped account', async () => {
    mockCampaignFindOne.mockReturnValueOnce(chain({ accountId: '999' }))

    const result = await getTool('get_campaign_insights').handler(
      { entityId: 'camp_1', level: 'campaign' },
      context(['123']),
    )

    expect(mockCampaignFindOne).toHaveBeenCalledWith({ channel: 'facebook', campaignId: 'camp_1' })
    expect(result).toMatchObject({
      success: false,
      metadata: { scopedOut: true },
    })
    expect(mockFetchInsights).not.toHaveBeenCalled()
  })

  it('allows entity writes only when the local campaign belongs to the agent scope', async () => {
    mockCampaignFindOne.mockReturnValueOnce(chain({ accountId: '123' }))
    mockUpdateCampaign.mockResolvedValueOnce({ success: true })

    const result = await getTool('pause_entity').handler(
      { entityType: 'campaign', entityId: 'camp_1', reason: 'test' },
      context(['act_123']),
    )

    expect(mockUpdateCampaign).toHaveBeenCalledWith({
      campaignId: 'camp_1',
      token: 'FB_TOKEN',
      status: 'PAUSED',
    })
    expect(result).toMatchObject({
      success: true,
      data: { entityId: 'camp_1', status: 'PAUSED' },
    })
  })
})
