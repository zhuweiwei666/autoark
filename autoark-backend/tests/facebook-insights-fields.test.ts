const mockFacebookGet = jest.fn()

jest.mock('../src/integration/facebook/facebookClient', () => ({
  facebookClient: {
    get: mockFacebookGet,
  },
}))

import { fetchInsights } from '../src/integration/facebook/insights.api'

describe('Facebook insights fields', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFacebookGet.mockResolvedValue({ data: [] })
  })

  it('requests campaign_name for campaign-level aggregation', async () => {
    await fetchInsights(
      'act_123',
      'campaign',
      undefined,
      'TOKEN',
      ['country'],
      { since: '2026-07-29', until: '2026-07-29' },
    )

    expect(mockFacebookGet).toHaveBeenCalledTimes(1)
    const [, params] = mockFacebookGet.mock.calls[0]
    expect(params.level).toBe('campaign')
    expect(params.fields.split(',')).toContain('campaign_name')
  })

  it('does not request campaign_name for account-level aggregation', async () => {
    await fetchInsights('act_123', 'account', 'today', 'TOKEN')

    const [, params] = mockFacebookGet.mock.calls[0]
    expect(params.level).toBe('account')
    expect(params.fields.split(',')).not.toContain('campaign_name')
  })
})
