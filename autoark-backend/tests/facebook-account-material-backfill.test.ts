const mockFacebookGet = jest.fn()
const mockAdFindOneAndUpdate = jest.fn()
const mockCreativeFindOneAndUpdate = jest.fn()
const mockIngestCreativeAssets = jest.fn()

jest.mock('../src/integration/facebook/facebookClient', () => ({
  facebookClient: {
    get: mockFacebookGet,
  },
}))

jest.mock('../src/models/Ad', () => ({
  __esModule: true,
  default: {
    findOneAndUpdate: mockAdFindOneAndUpdate,
  },
}))

jest.mock('../src/models/Creative', () => ({
  __esModule: true,
  default: {
    findOneAndUpdate: mockCreativeFindOneAndUpdate,
  },
}))

jest.mock('../src/services/facebookMaterialIngestion.service', () => ({
  ingestCreativeAssets: mockIngestCreativeAssets,
}))

import {
  backfillFacebookAccountMaterialsPage,
} from '../src/services/facebookAccountMaterialBackfill.service'

describe('Facebook account material backfill', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAdFindOneAndUpdate.mockResolvedValue({})
    mockCreativeFindOneAndUpdate.mockResolvedValue({})
    mockIngestCreativeAssets.mockResolvedValue({
      success: true,
      materialIds: ['material-1'],
      imported: 1,
      reused: 0,
      errors: [],
    })
  })

  it('fetches one bounded page, persists every ad, and ingests each creative once', async () => {
    mockFacebookGet.mockResolvedValue({
      data: [
        {
          id: 'ad-1',
          name: 'Ad one',
          status: 'ACTIVE',
          adset_id: 'adset-1',
          campaign_id: 'campaign-1',
          creative: {
            id: 'creative-1',
            name: 'Creative one',
            image_hash: 'hash-1',
            image_url: 'https://example.com/one.jpg',
          },
        },
        {
          id: 'ad-2',
          name: 'Ad two',
          status: 'PAUSED',
          adset_id: 'adset-2',
          campaign_id: 'campaign-2',
          creative: {
            id: 'creative-1',
            name: 'Creative one',
            image_hash: 'hash-1',
            image_url: 'https://example.com/one.jpg',
          },
        },
      ],
      paging: {
        next: 'https://graph.facebook.com/next',
        cursors: { after: 'NEXT_CURSOR' },
      },
    })

    const result = await backfillFacebookAccountMaterialsPage({
      accountId: 'act_123',
      organizationId: 'org-1',
      token: 'SECRET_TOKEN',
      tokenId: 'token-1',
      optimizer: 'gyh',
      after: 'START_CURSOR',
      limit: 20,
      concurrency: 2,
    })

    expect(mockFacebookGet).toHaveBeenCalledWith('/act_123/ads', expect.objectContaining({
      access_token: 'SECRET_TOKEN',
      after: 'START_CURSOR',
      limit: 20,
      fields: expect.stringContaining('creative{id,name,status,image_hash,video_id'),
    }))
    expect(mockAdFindOneAndUpdate).toHaveBeenCalledTimes(2)
    expect(mockCreativeFindOneAndUpdate).toHaveBeenCalledTimes(1)
    expect(mockIngestCreativeAssets).toHaveBeenCalledTimes(1)
    expect(mockIngestCreativeAssets).toHaveBeenCalledWith(expect.objectContaining({
      accountId: '123',
      organizationId: 'org-1',
      token: 'SECRET_TOKEN',
      creative: expect.objectContaining({
        creativeId: 'creative-1',
        imageHash: 'hash-1',
      }),
    }))
    expect(result).toMatchObject({
      status: 'complete',
      accountId: '123',
      adsProcessed: 2,
      uniqueCreatives: 1,
      creativesSucceeded: 1,
      creativesFailed: 0,
      materialsImported: 1,
      materialsReused: 0,
      hasMore: true,
      nextAfter: 'NEXT_CURSOR',
    })
  })

  it('clamps work per request and returns bounded sanitized creative failures', async () => {
    mockFacebookGet.mockResolvedValue({
      data: [
        {
          id: 'ad-3',
          creative: {
            id: 'creative-3',
            video_id: 'video-3',
          },
        },
      ],
      paging: {},
    })
    mockIngestCreativeAssets.mockResolvedValue({
      success: false,
      materialIds: [],
      imported: 0,
      reused: 0,
      errors: ['download failed access_token=LEAK_ME'],
    })

    const result = await backfillFacebookAccountMaterialsPage({
      accountId: '123',
      organizationId: 'org-1',
      token: 'SECRET_TOKEN',
      limit: 500,
      concurrency: 99,
    })

    expect(mockFacebookGet).toHaveBeenCalledWith('/act_123/ads', expect.objectContaining({
      limit: 50,
    }))
    expect(result).toMatchObject({
      status: 'partial',
      limit: 50,
      concurrency: 3,
      creativesFailed: 1,
      hasMore: false,
    })
    expect(result.errors).toEqual([
      expect.objectContaining({
        creativeId: 'creative-3',
        error: 'download failed access_token=[REDACTED]',
      }),
    ])
  })
})
