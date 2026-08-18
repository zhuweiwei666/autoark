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

  it('loads every cursor page before returning a snapshot', async () => {
    mockFacebookGet
      .mockResolvedValueOnce({
        data: [{ campaign_id: 'cmp-1' }],
        paging: { next: 'next-page', cursors: { after: 'cursor-1' } },
      })
      .mockResolvedValueOnce({ data: [{ campaign_id: 'cmp-2' }] })

    const rows = await fetchInsights('act_123', 'campaign', 'today', 'TOKEN')

    expect(rows).toEqual([
      { campaign_id: 'cmp-1' },
      { campaign_id: 'cmp-2' },
    ])
    expect(mockFacebookGet).toHaveBeenNthCalledWith(
      2,
      '/act_123/insights',
      expect.objectContaining({ after: 'cursor-1' }),
    )
  })

  it('fails closed instead of persisting a repeated pagination cursor', async () => {
    mockFacebookGet
      .mockResolvedValueOnce({
        data: [{ campaign_id: 'cmp-1' }],
        paging: { next: 'next-page', cursors: { after: 'cursor-1' } },
      })
      .mockResolvedValueOnce({
        data: [{ campaign_id: 'cmp-2' }],
        paging: { next: 'same-page', cursors: { after: 'cursor-1' } },
      })

    await expect(
      fetchInsights('act_123', 'campaign', 'today', 'TOKEN'),
    ).rejects.toThrow('pagination cursor is missing or repeated')
  })

  it('fails closed instead of treating a malformed response as a real zero', async () => {
    mockFacebookGet.mockResolvedValueOnce({ data: null })

    await expect(
      fetchInsights('act_123', 'campaign', 'today', 'TOKEN'),
    ).rejects.toThrow('response data is not an array')
  })
})
