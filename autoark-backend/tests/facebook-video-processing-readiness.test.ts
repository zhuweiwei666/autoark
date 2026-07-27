jest.mock('../src/integration/facebook/facebookClient', () => ({
  facebookClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}))

import { facebookClient } from '../src/integration/facebook/facebookClient'
import { uploadVideoFromUrl } from '../src/integration/facebook/bulkCreate.api'

describe('Facebook video processing readiness', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('waits for Meta to finish processing before returning a usable video id', async () => {
    ;(facebookClient.post as jest.Mock).mockResolvedValue({ id: 'video_1' })
    ;(facebookClient.get as jest.Mock)
      .mockResolvedValueOnce({
        status: { video_status: 'processing' },
      })
      .mockResolvedValueOnce({
        status: { video_status: 'ready' },
        picture: 'https://example.com/thumb.jpg',
      })

    const uploadPromise = uploadVideoFromUrl({
      accountId: '123',
      token: 'token',
      videoUrl: 'https://example.com/video.mp4',
    })

    await jest.advanceTimersByTimeAsync(0)
    expect(facebookClient.get).toHaveBeenCalledTimes(1)

    await jest.advanceTimersByTimeAsync(3000)
    await expect(uploadPromise).resolves.toMatchObject({
      success: true,
      id: 'video_1',
      thumbnailUrl: 'https://example.com/thumb.jpg',
    })
    expect(facebookClient.get).toHaveBeenCalledTimes(2)
    expect(facebookClient.get).toHaveBeenLastCalledWith('/video_1', {
      access_token: 'token',
      fields: 'status,thumbnails,picture',
    })
  })

  it('does not return a usable video id when Meta reports processing failure', async () => {
    ;(facebookClient.post as jest.Mock).mockResolvedValue({ id: 'video_1' })
    ;(facebookClient.get as jest.Mock).mockResolvedValue({
      status: {
        video_status: 'error',
        processing_phase: { status: 'error', errors: [{ message: 'Unsupported video' }] },
      },
    })

    await expect(uploadVideoFromUrl({
      accountId: '123',
      token: 'token',
      videoUrl: 'https://example.com/video.mp4',
    })).resolves.toMatchObject({
      success: false,
      error: {
        code: 'VIDEO_PROCESSING_FAILED',
      },
    })
  })

  it('stops waiting after five minutes instead of creating a creative with an unready video', async () => {
    ;(facebookClient.post as jest.Mock).mockResolvedValue({ id: 'video_1' })
    ;(facebookClient.get as jest.Mock).mockResolvedValue({
      status: { video_status: 'processing' },
    })

    const uploadPromise = uploadVideoFromUrl({
      accountId: '123',
      token: 'token',
      videoUrl: 'https://example.com/video.mp4',
    })

    await jest.advanceTimersByTimeAsync(5 * 60 * 1000)
    await expect(uploadPromise).resolves.toMatchObject({
      success: false,
      error: {
        code: 'VIDEO_PROCESSING_TIMEOUT',
      },
    })
  })
})
