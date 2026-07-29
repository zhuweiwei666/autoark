jest.mock('../src/integration/facebook/facebookClient', () => ({
  facebookClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}))

jest.mock('../src/services/remoteMediaDownload.service', () => ({
  downloadRemoteMedia: jest.fn(),
}))

import { facebookClient } from '../src/integration/facebook/facebookClient'
import { uploadImageFromUrl } from '../src/integration/facebook/bulkCreate.api'
import { downloadRemoteMedia } from '../src/services/remoteMediaDownload.service'

describe('Facebook image binary upload', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('downloads the image and uploads bytes instead of asking Meta to fetch the URL', async () => {
    const imageBuffer = Buffer.from('jpeg-image-bytes')
    ;(downloadRemoteMedia as jest.Mock).mockResolvedValue({
      buffer: imageBuffer,
      mimeType: 'image/jpeg',
      filename: 'image.jpg',
      host: 'api.autoark.work',
    })
    ;(facebookClient.post as jest.Mock).mockResolvedValue({
      images: {
        image: {
          hash: 'target_account_hash',
        },
      },
    })

    await expect(
      uploadImageFromUrl({
        accountId: '123',
        token: 'token',
        imageUrl: 'https://api.autoark.work/api/materials/public/image.jpg',
        name: 'Image 1',
      }),
    ).resolves.toMatchObject({
      success: true,
      hash: 'target_account_hash',
    })

    expect(downloadRemoteMedia).toHaveBeenCalledWith(
      'https://api.autoark.work/api/materials/public/image.jpg',
    )
    expect(facebookClient.post).toHaveBeenCalledWith('/act_123/adimages', {
      access_token: 'token',
      bytes: imageBuffer.toString('base64'),
    })
    expect(facebookClient.post).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ url: expect.anything() }),
    )
  })

  it('does not send non-image media to the Meta image endpoint', async () => {
    ;(downloadRemoteMedia as jest.Mock).mockResolvedValue({
      buffer: Buffer.from('video-bytes'),
      mimeType: 'video/mp4',
      filename: 'video.mp4',
      host: 'api.autoark.work',
    })

    await expect(
      uploadImageFromUrl({
        accountId: '123',
        token: 'token',
        imageUrl: 'https://api.autoark.work/api/materials/public/video.mp4',
      }),
    ).resolves.toMatchObject({
      success: false,
      error: {
        code: 'IMAGE_MEDIA_TYPE_INVALID',
      },
    })

    expect(facebookClient.post).not.toHaveBeenCalled()
  })
})
