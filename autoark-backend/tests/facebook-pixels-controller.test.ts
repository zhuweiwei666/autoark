jest.mock('../src/services/facebook.pixels.service', () => ({
  getAllPixelsFromAllTokens: jest.fn(),
  getPixelsByToken: jest.fn(),
  getAllPixels: jest.fn(),
  getPixelDetails: jest.fn(),
  getPixelEvents: jest.fn(),
}))

import * as pixelsService from '../src/services/facebook.pixels.service'
import { UserRole } from '../src/models/User'
import {
  getPixelDetails,
  getPixelEvents,
  getPixels,
} from '../src/controllers/facebook.pixels.controller'

const mockPixelsService = pixelsService as jest.Mocked<typeof pixelsService>

const responseMock = () => ({
  json: jest.fn(),
  status: jest.fn().mockReturnThis(),
})

const superAdminReq = (input: { query?: any; params?: any } = {}) => ({
  query: input.query || {},
  params: input.params || {},
  user: {
    role: UserRole.SUPER_ADMIN,
    userId: '665000000000000000000001',
  },
})

describe('Facebook pixels controller', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPixelsService.getAllPixels.mockResolvedValue([])
    mockPixelsService.getPixelsByToken.mockResolvedValue([])
    mockPixelsService.getAllPixelsFromAllTokens.mockResolvedValue([])
    mockPixelsService.getPixelDetails.mockResolvedValue({ id: 'pixel_1', name: 'Pixel 1' } as any)
    mockPixelsService.getPixelEvents.mockResolvedValue([])
  })

  it('rejects malformed tokenId values before fetching pixels', async () => {
    const res = responseMock()
    const next = jest.fn()

    await getPixels(
      superAdminReq({ query: { tokenId: { $ne: 'token_1' } } }) as any,
      res as any,
      next,
    )

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'tokenId must be a string',
    })
    expect(mockPixelsService.getPixelsByToken).not.toHaveBeenCalled()
    expect(mockPixelsService.getAllPixels).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  it('trims tokenId values before fetching pixels for one token', async () => {
    const res = responseMock()

    await getPixels(
      superAdminReq({ query: { tokenId: '  token_1  ' } }) as any,
      res as any,
      jest.fn(),
    )

    expect(mockPixelsService.getPixelsByToken).toHaveBeenCalledWith('token_1')
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [],
      count: 0,
    })
  })

  it('rejects malformed pixel IDs before fetching details', async () => {
    const res = responseMock()
    const next = jest.fn()

    await getPixelDetails(
      superAdminReq({
        params: { id: { $gt: '' } },
      }) as any,
      res as any,
      next,
    )

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Pixel ID must be a string',
    })
    expect(mockPixelsService.getPixelDetails).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  it('sanitizes pixel event queries and caps event limits', async () => {
    const res = responseMock()

    await getPixelEvents(
      superAdminReq({
        params: { id: '  pixel_1  ' },
        query: { tokenId: '  token_1  ', limit: '9999' },
      }) as any,
      res as any,
      jest.fn(),
    )

    expect(mockPixelsService.getPixelEvents).toHaveBeenCalledWith('pixel_1', 'token_1', 200)
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [],
      count: 0,
    })
  })
})
