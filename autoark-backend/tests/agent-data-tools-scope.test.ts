const mockMetricsFind = jest.fn()
const mockMetricsAggregate = jest.fn()
const mockCampaignFindOne = jest.fn()
const mockAdSetFind = jest.fn()
const mockAdFind = jest.fn()
const mockAccountFind = jest.fn()
const mockAggDailyFind = jest.fn()
const mockAggAccountFind = jest.fn()
const mockAggAccountAggregate = jest.fn()
const mockAggCampaignFind = jest.fn()
const mockAggCountryFind = jest.fn()

jest.mock('../src/models/MetricsDaily', () => ({
  __esModule: true,
  default: {
    find: mockMetricsFind,
    aggregate: mockMetricsAggregate,
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
    find: mockAdSetFind,
  },
}))

jest.mock('../src/models/Ad', () => ({
  __esModule: true,
  default: {
    find: mockAdFind,
  },
}))

jest.mock('../src/models/Account', () => ({
  __esModule: true,
  default: {
    find: mockAccountFind,
  },
}))

jest.mock('../src/models/Aggregation', () => ({
  AggDaily: {
    find: mockAggDailyFind,
  },
  AggAccount: {
    find: mockAggAccountFind,
    aggregate: mockAggAccountAggregate,
  },
  AggCampaign: {
    find: mockAggCampaignFind,
  },
  AggCountry: {
    find: mockAggCountryFind,
  },
}))

import { dataTools } from '../src/agent/tools/data.tools'

const chain = (result: any) => ({
  select: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(result),
})

const getTool = (name: string) => {
  const tool = dataTools.find(item => item.name === name)
  if (!tool) throw new Error(`Missing tool ${name}`)
  return tool
}

const baseContext = (overrides: any = {}) => ({
  agentId: 'agent_1',
  agentConfig: {},
  sessionId: 'session_1',
  mode: 'observe',
  permissions: {},
  objectives: {},
  scope: {
    adAccountIds: [],
    fbTokenIds: [],
    tiktokTokenIds: [],
    facebookAppIds: [],
  },
  ...overrides,
}) as any

describe('agent data tools account scoping', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('does not query daily metrics for an account outside the agent scope', async () => {
    const result = await getTool('query_daily_metrics').handler(
      { level: 'campaign', accountId: 'act_999' },
      baseContext({ scope: { adAccountIds: ['act_123'], fbTokenIds: [], tiktokTokenIds: [], facebookAppIds: [] } }),
    )

    expect(result).toMatchObject({
      success: true,
      data: [],
      metadata: { scopedOut: true },
    })
    expect(mockMetricsFind).not.toHaveBeenCalled()
  })

  it('uses organization accounts instead of global dashboard rows when no explicit scope is configured', async () => {
    mockAccountFind.mockReturnValueOnce(chain([{ accountId: '123' }]))
    mockAggAccountAggregate.mockResolvedValueOnce([
      { date: '2026-06-02', spend: 100, revenue: 220, impressions: 1000, clicks: 50, installs: 10 },
    ])

    const result = await getTool('query_dashboard_summary').handler(
      { startDate: '2026-06-02', endDate: '2026-06-02' },
      baseContext({ organizationId: '665000000000000000000001' }),
    )

    expect(mockAggDailyFind).not.toHaveBeenCalled()
    expect(mockAggAccountAggregate).toHaveBeenCalledWith([
      expect.objectContaining({
        $match: expect.objectContaining({
          accountId: { $in: expect.arrayContaining(['123', 'act_123']) },
        }),
      }),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
    ])
    expect(result.data.totals).toMatchObject({ spend: 100, revenue: 220 })
  })

  it('rejects campaign performance requests for a scoped-out account', async () => {
    const result = await getTool('query_campaign_performance').handler(
      { accountId: 'act_999' },
      baseContext({ scope: { adAccountIds: ['123'], fbTokenIds: [], tiktokTokenIds: [], facebookAppIds: [] } }),
    )

    expect(result).toMatchObject({
      success: true,
      data: [],
      metadata: { scopedOut: true },
    })
    expect(mockAggCampaignFind).not.toHaveBeenCalled()
  })

  it('scopes campaign details by channel and accessible account ids', async () => {
    mockCampaignFindOne.mockReturnValueOnce(chain({ campaignId: 'camp_1', accountId: '123' }))
    mockAdSetFind.mockReturnValueOnce(chain([{ adsetId: 'adset_1' }]))
    mockAdFind.mockReturnValueOnce(chain([{ adId: 'ad_1' }]))

    const result = await getTool('get_campaign_details').handler(
      { campaignId: 'camp_1' },
      baseContext({ scope: { adAccountIds: ['act_123'], fbTokenIds: [], tiktokTokenIds: [], facebookAppIds: [] } }),
    )

    expect(mockCampaignFindOne).toHaveBeenCalledWith({
      channel: 'facebook',
      campaignId: 'camp_1',
      accountId: { $in: expect.arrayContaining(['123', 'act_123']) },
    })
    expect(mockAdSetFind).toHaveBeenCalledWith({
      channel: 'facebook',
      campaignId: 'camp_1',
      accountId: '123',
    })
    expect(mockAdFind).toHaveBeenCalledWith({
      channel: 'facebook',
      campaignId: 'camp_1',
      accountId: '123',
    })
    expect(result).toMatchObject({
      success: true,
      data: {
        summary: { totalAdSets: 1, totalAds: 1 },
      },
    })
  })
})
