const mockAccountFind = jest.fn()
const mockFbTokenFind = jest.fn()
const mockCountrySummaryFind = jest.fn()
const mockCountrySummaryAggregate = jest.fn()
const mockCountrySummaryBulkWrite = jest.fn()
const mockFetchInsights = jest.fn()

jest.mock('../src/models/Account', () => ({
  __esModule: true,
  default: {
    find: mockAccountFind,
  },
}))

jest.mock('../src/models/FbToken', () => ({
  __esModule: true,
  default: {
    find: mockFbTokenFind,
  },
}))

jest.mock('../src/models/Summary', () => ({
  CountrySummary: {
    find: mockCountrySummaryFind,
    aggregate: mockCountrySummaryAggregate,
    bulkWrite: mockCountrySummaryBulkWrite,
  },
}))

jest.mock('../src/integration/facebook/insights.api', () => ({
  fetchInsights: mockFetchInsights,
}))

import { getCountries } from '../src/services/facebook.countries.service'

const leanResult = (value: any) => ({
  lean: jest.fn().mockResolvedValue(value),
})

const pagination = {
  page: 1,
  limit: 20,
  sortBy: 'spend',
  sortOrder: 'desc' as const,
}

describe('facebook countries tenant scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAccountFind.mockReturnValue(leanResult([{ accountId: '123', token: 'token-a' }]))
    mockFbTokenFind.mockReturnValue(leanResult([{ token: 'token-a' }]))
    mockCountrySummaryFind.mockReturnValue(leanResult([]))
    mockCountrySummaryAggregate.mockResolvedValue([])
    mockCountrySummaryBulkWrite.mockResolvedValue({})
    mockFetchInsights.mockResolvedValue([
      {
        country: 'US',
        spend: '10',
        impressions: '1000',
        clicks: '50',
        campaign_id: 'camp-1',
        actions: [{ action_type: 'mobile_app_install', value: '3' }],
        action_values: [{ action_type: 'omni_purchase', value: '25' }],
      },
    ])
  })

  it('uses only scoped accounts and tokens for tenant country data', async () => {
    const result = await getCountries(
      {},
      pagination,
      {
        accountIds: ['123'],
        tokenFilter: { organizationId: 'org-a' },
        allowCacheFallback: false,
        allowCacheWrite: false,
      },
    )

    expect(mockAccountFind).toHaveBeenCalledWith({ accountId: { $in: ['123', 'act_123'] } })
    expect(mockFbTokenFind).toHaveBeenCalledWith({ status: 'active', organizationId: 'org-a' })
    expect(mockFetchInsights).toHaveBeenCalledWith(
      'act_123',
      'campaign',
      undefined,
      'token-a',
      ['country'],
      expect.any(Object),
    )
    expect(mockCountrySummaryBulkWrite).not.toHaveBeenCalled()
    expect(result.data).toHaveLength(1)
    expect(result.data[0]).toMatchObject({ country: 'US', spend: 10, purchase_value: 25 })
  })

  it('does not fall back to global country cache for tenant requests', async () => {
    mockFetchInsights.mockRejectedValue(new Error('api down'))

    const result = await getCountries(
      {},
      pagination,
      {
        accountIds: ['123'],
        tokenFilter: { organizationId: 'org-a' },
        allowCacheFallback: false,
        allowCacheWrite: false,
      },
    )

    expect(mockCountrySummaryFind).not.toHaveBeenCalled()
    expect(mockCountrySummaryAggregate).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      data: [],
      pagination: { total: 0, page: 1, limit: 20, pages: 0 },
    })
  })

  it('caps endDate-only country insight ranges before calling Facebook Insights', async () => {
    await getCountries(
      { endDate: '2026-06-02' },
      pagination,
      {
        accountIds: ['123'],
        tokenFilter: { organizationId: 'org-a' },
        allowCacheFallback: false,
        allowCacheWrite: false,
      },
    )

    expect(mockFetchInsights).toHaveBeenCalledWith(
      'act_123',
      'campaign',
      undefined,
      'token-a',
      ['country'],
      { since: '2026-03-05', until: '2026-06-02' },
    )
  })
})
