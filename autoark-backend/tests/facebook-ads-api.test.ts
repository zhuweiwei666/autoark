const mockFacebookGet = jest.fn()

jest.mock('../src/integration/facebook/facebookClient', () => ({
  facebookClient: {
    get: mockFacebookGet,
  },
}))

import { fetchImageByHash } from '../src/integration/facebook/ads.api'

describe('Facebook ad image API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('serializes image hashes as a Meta list and returns the matching original image', async () => {
    mockFacebookGet.mockResolvedValue({
      data: [
        { hash: 'other', url: 'https://images.example/other.jpg' },
        {
          hash: 'target-hash',
          url: 'https://images.example/original.jpg',
          url_128: 'https://images.example/preview.jpg',
          width: 1200,
          height: 1200,
        },
      ],
    })

    const result = await fetchImageByHash('123', 'target-hash', 'TOKEN')

    expect(mockFacebookGet).toHaveBeenCalledWith('/act_123/adimages', {
      access_token: 'TOKEN',
      fields: 'hash,url,url_128,permalink_url,width,height',
      hashes: JSON.stringify(['target-hash']),
    })
    expect(result).toEqual(expect.objectContaining({
      success: true,
      url: 'https://images.example/original.jpg',
      width: 1200,
      height: 1200,
    }))
  })
})
