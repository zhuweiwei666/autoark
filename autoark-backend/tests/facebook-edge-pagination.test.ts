const mockFacebookGet = jest.fn()

jest.mock('../src/integration/facebook/facebookClient', () => ({
  facebookClient: { get: mockFacebookGet },
}))

import { fetchFacebookEdgePages } from '../src/integration/facebook/pagination'

describe('facebook edge pagination', () => {
  beforeEach(() => jest.clearAllMocks())

  it('follows cursor pages without reusing a next URL that may contain a token', async () => {
    mockFacebookGet
      .mockResolvedValueOnce({
        data: [{ id: '1' }, { id: '2' }],
        paging: {
          cursors: { after: 'cursor-1' },
          next: 'https://graph.facebook.com/page?access_token=SECRET',
        },
      })
      .mockResolvedValueOnce({ data: [{ id: '3' }] })

    const result = await fetchFacebookEdgePages('/campaign-1/ads', {
      access_token: 'TOKEN',
      fields: 'id,creative{id}',
      limit: 500,
    })

    expect(result).toEqual([{ id: '1' }, { id: '2' }, { id: '3' }])
    expect(mockFacebookGet).toHaveBeenNthCalledWith(1, '/campaign-1/ads', {
      access_token: 'TOKEN',
      fields: 'id,creative{id}',
      limit: 500,
    })
    expect(mockFacebookGet).toHaveBeenNthCalledWith(2, '/campaign-1/ads', {
      access_token: 'TOKEN',
      fields: 'id,creative{id}',
      limit: 500,
      after: 'cursor-1',
    })
  })

  it('stops on a repeated cursor instead of looping forever', async () => {
    mockFacebookGet
      .mockResolvedValueOnce({ data: [{ id: '1' }], paging: { cursors: { after: 'same' }, next: 'next' } })
      .mockResolvedValueOnce({ data: [{ id: '2' }], paging: { cursors: { after: 'same' }, next: 'next' } })

    const result = await fetchFacebookEdgePages('/campaign-1/ads', {})

    expect(result).toHaveLength(2)
    expect(mockFacebookGet).toHaveBeenCalledTimes(2)
  })
})
