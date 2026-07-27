const mockFetchCampaigns = jest.fn()
const mockSearchTargetingLocations = jest.fn()
const mockUploadImageFromUrl = jest.fn()

jest.mock('../src/integration/facebook/campaigns.api', () => ({
  fetchCampaigns: mockFetchCampaigns,
}))

jest.mock('../src/integration/facebook/bulkCreate.api', () => ({
  createCampaign: jest.fn(),
  createAdSet: jest.fn(),
  createAdCreative: jest.fn(),
  createAd: jest.fn(),
  updateCampaign: jest.fn(),
  updateAdSet: jest.fn(),
  updateAd: jest.fn(),
  uploadImageFromUrl: mockUploadImageFromUrl,
  uploadVideoFromUrl: jest.fn(),
  searchTargetingInterests: jest.fn(),
  searchTargetingLocations: mockSearchTargetingLocations,
  getPages: jest.fn(),
  getPixels: jest.fn(),
  getCustomConversions: jest.fn(),
}))

import { facebookTools } from '../src/agent/tools/facebook.tools'

const scopedContext: any = {
  fbToken: 'PRE_RESOLVED_SYSTEM_TOKEN',
  organizationId: '665000000000000000000001',
  scope: {
    adAccountIds: ['123'],
    fbTokenIds: [],
  },
}

const getTool = (name: string) => {
  const tool = facebookTools.find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`Missing test tool ${name}`)
  return tool
}

describe('agent Facebook tool account scoping with System User credentials', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('blocks account reads outside the agent account scope before calling Meta', async () => {
    const result = await getTool('get_campaigns').handler(
      { accountId: '999' },
      scopedContext,
    )

    expect(result).toEqual(expect.objectContaining({
      success: false,
      metadata: { scopedOut: true },
    }))
    expect(mockFetchCampaigns).not.toHaveBeenCalled()
  })

  it('blocks media uploads outside the agent account scope before calling Meta', async () => {
    const result = await getTool('upload_image').handler(
      { accountId: '999', imageUrl: 'https://example.com/image.png' },
      scopedContext,
    )

    expect(result).toEqual(expect.objectContaining({
      success: false,
      metadata: { scopedOut: true },
    }))
    expect(mockUploadImageFromUrl).not.toHaveBeenCalled()
  })

  it('does not apply a nonexistent account field to global targeting searches', async () => {
    mockSearchTargetingLocations.mockResolvedValue({
      success: true,
      data: [{ key: 'US' }],
    })

    const result = await getTool('search_locations').handler(
      { query: 'United States' },
      scopedContext,
    )

    expect(result.success).toBe(true)
    expect(mockSearchTargetingLocations).toHaveBeenCalledWith({
      token: 'PRE_RESOLVED_SYSTEM_TOKEN',
      query: 'United States',
    })
  })
})
