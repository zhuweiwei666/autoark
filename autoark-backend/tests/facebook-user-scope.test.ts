import FacebookUser from '../src/models/FacebookUser'
import {
  getCachedPixels,
  getSyncStatus,
} from '../src/services/facebookUser.service'

describe('facebook user asset cache scoping', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('reads cached assets by organization scope before token fallback', async () => {
    const findOne = jest.spyOn(FacebookUser, 'findOne').mockResolvedValue({ pixels: [] } as any)

    await getCachedPixels('fb_1', { organizationId: '665000000000000000000001', tokenId: 'token_1' })

    expect(findOne).toHaveBeenCalledWith({
      fbUserId: 'fb_1',
      organizationId: '665000000000000000000001',
    })
  })

  it('falls back to token scope when organization is unavailable', async () => {
    const findOne = jest.spyOn(FacebookUser, 'findOne').mockResolvedValue(null)

    const status = await getSyncStatus('fb_1', { tokenId: 'token_1' })

    expect(findOne).toHaveBeenCalledWith({
      fbUserId: 'fb_1',
      tokenId: 'token_1',
    })
    expect(status.status).toBe('pending')
  })
})
