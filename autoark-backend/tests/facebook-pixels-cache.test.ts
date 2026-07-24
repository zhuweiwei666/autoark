const mockFbTokenFindById = jest.fn()
const mockFbTokenFind = jest.fn()
const mockFacebookUserFindOne = jest.fn()
const mockFacebookUserFind = jest.fn()
const mockSyncFacebookTokenAssets = jest.fn()
const mockLiveGetPixels = jest.fn()

jest.mock('../src/models/FbToken', () => ({
  __esModule: true,
  default: {
    findById: mockFbTokenFindById,
    find: mockFbTokenFind,
  },
}))

jest.mock('../src/models/FacebookUser', () => ({
  __esModule: true,
  default: {
    findOne: mockFacebookUserFindOne,
    find: mockFacebookUserFind,
  },
}))

jest.mock('../src/services/facebookUser.service', () => ({
  syncFacebookTokenAssets: mockSyncFacebookTokenAssets,
}))

jest.mock('../src/integration/facebook/pixels.api', () => ({
  getPixels: mockLiveGetPixels,
  getPixelDetails: jest.fn(),
  getPixelEvents: jest.fn(),
}))

import {
  getAllPixelsFromAllTokens,
  getPixelsByToken,
} from '../src/services/facebook.pixels.service'

const token = {
  _id: { toString: () => 'token_1' },
  token: 'TOKEN_A',
  status: 'active',
  fbUserId: 'fb_1',
  fbUserName: 'Alice',
  organizationId: 'org_1',
}

const snapshot = {
  tokenId: 'token_1',
  syncStatus: 'completed',
  lastSyncedAt: new Date('2026-07-24T00:00:00Z'),
  adAccounts: [{ accountId: '100' }],
  pages: [{ pageId: 'page_1' }],
  productCatalogs: [{ catalogId: 'catalog_1' }],
  pixels: [{
    pixelId: 'pixel_1',
    name: 'Pixel 1',
    ownerBusiness: { id: 'biz_1', name: 'Business 1' },
    accounts: [],
  }],
  syncStats: {
    graphRequestCount: 4,
    accountAssetMode: 'field_expansion',
  },
}

describe('Facebook pixel cache service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFbTokenFindById.mockResolvedValue(token)
    mockFacebookUserFindOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(snapshot),
    })
    mockSyncFacebookTokenAssets.mockResolvedValue(snapshot)
    mockLiveGetPixels.mockResolvedValue([{ id: 'live_pixel', name: 'Live Pixel' }])
  })

  it('returns a token snapshot without making a live Pixel API request', async () => {
    const result = await getPixelsByToken('token_1')

    expect(result.pixels).toEqual([
      expect.objectContaining({
        id: 'pixel_1',
        name: 'Pixel 1',
        tokenId: 'token_1',
        fbUserId: 'fb_1',
      }),
    ])
    expect(result.meta).toEqual(expect.objectContaining({
      source: 'cache',
      tokenId: 'token_1',
      syncStatus: 'completed',
      accountCount: 1,
      pixelCount: 1,
      pageCount: 1,
      catalogCount: 1,
    }))
    expect(mockLiveGetPixels).not.toHaveBeenCalled()
    expect(mockSyncFacebookTokenAssets).not.toHaveBeenCalled()
  })

  it('returns a pending empty cache instead of implicitly spending Meta quota', async () => {
    mockFacebookUserFindOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    })

    const result = await getPixelsByToken('token_1')

    expect(result.pixels).toEqual([])
    expect(result.meta).toEqual(expect.objectContaining({
      source: 'cache',
      syncStatus: 'pending',
      pixelCount: 0,
    }))
    expect(mockSyncFacebookTokenAssets).not.toHaveBeenCalled()
  })

  it('aggregates all active token snapshots without per-token Meta requests', async () => {
    const secondToken = {
      ...token,
      _id: { toString: () => 'token_2' },
      fbUserId: 'fb_2',
      fbUserName: 'Bob',
    }
    mockFbTokenFind.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([token, secondToken]),
      }),
    })
    mockFacebookUserFind.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        snapshot,
        {
          ...snapshot,
          tokenId: 'token_2',
          pixels: [{ pixelId: 'pixel_2', name: 'Pixel 2', accounts: [] }],
        },
      ]),
    })

    const result = await getAllPixelsFromAllTokens()

    expect(result.pixels.map((pixel: any) => pixel.id)).toEqual(['pixel_1', 'pixel_2'])
    expect(result.meta).toEqual(expect.objectContaining({
      source: 'cache',
      tokenCount: 2,
      pixelCount: 2,
    }))
    expect(mockLiveGetPixels).not.toHaveBeenCalled()
    expect(mockSyncFacebookTokenAssets).not.toHaveBeenCalled()
  })

  it('forces one selected token refresh only when explicitly requested', async () => {
    await getPixelsByToken('token_1', { refresh: true })

    expect(mockSyncFacebookTokenAssets).toHaveBeenCalledWith(token, { force: true })
    expect(mockLiveGetPixels).not.toHaveBeenCalled()
  })
})
