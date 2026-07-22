const mockFetchVideoSource = jest.fn()
const mockFetchImageByHash = jest.fn()
const mockUploadToR2 = jest.fn()
const mockDeleteFromR2 = jest.fn()
const mockMaterialFindOne = jest.fn()
const mockMaterialFindOneAndUpdate = jest.fn()
const mockMaterialUpdateOne = jest.fn()
const mockCreativeFindOneAndUpdate = jest.fn()

jest.mock('../src/integration/facebook/ads.api', () => ({
  fetchVideoSource: mockFetchVideoSource,
  fetchImageByHash: mockFetchImageByHash,
}))

jest.mock('../src/services/r2Storage.service', () => ({
  uploadToR2: mockUploadToR2,
  deleteFromR2: mockDeleteFromR2,
}))

jest.mock('../src/models/Material', () => ({
  __esModule: true,
  default: {
    findOne: mockMaterialFindOne,
    findOneAndUpdate: mockMaterialFindOneAndUpdate,
    updateOne: mockMaterialUpdateOne,
  },
}))

jest.mock('../src/models/Creative', () => ({
  __esModule: true,
  default: {
    findOneAndUpdate: mockCreativeFindOneAndUpdate,
  },
}))

import {
  extractCreativeAssets,
  ingestCreativeAssets,
} from '../src/services/facebookMaterialIngestion.service'

const materialDocument = (id = 'material-1') => ({
  _id: { toString: () => id },
  status: 'ready',
  storage: { key: 'key', url: 'https://r2.example/key' },
})

describe('facebook material ingestion', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockMaterialFindOne.mockResolvedValue(null)
    mockMaterialFindOneAndUpdate.mockResolvedValue(materialDocument())
    mockMaterialUpdateOne.mockResolvedValue({ modifiedCount: 1 })
    mockCreativeFindOneAndUpdate.mockResolvedValue({})
    mockUploadToR2.mockResolvedValue({
      success: true,
      key: 'tenant/facebook/video.mp4',
      url: 'https://r2.example/tenant/facebook/video.mp4',
    })
    mockDeleteFromR2.mockResolvedValue({ success: true })
    ;(global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => {
          if (name.toLowerCase() === 'content-type') return 'video/mp4'
          if (name.toLowerCase() === 'content-length') return '11'
          return null
        },
      },
      arrayBuffer: async () => Buffer.from('video-bytes'),
    })
  })

  it('extracts native assets from single, carousel, and dynamic creatives without duplicates', () => {
    const assets = extractCreativeAssets({
      image_hash: 'img-1',
      video_id: 'vid-1',
      object_story_spec: {
        link_data: {
          child_attachments: [
            { image_hash: 'img-2', picture: 'https://preview.example/img-2' },
            { video_id: 'vid-2', picture: 'https://preview.example/vid-2' },
            { image_hash: 'img-1' },
          ],
        },
      },
      asset_feed_spec: {
        images: [{ hash: 'img-3' }],
        videos: [{ video_id: 'vid-3' }],
      },
    })

    expect(assets.map((asset) => `${asset.type}:${asset.imageHash || asset.videoId}`)).toEqual([
      'image:img-1',
      'video:vid-1',
      'image:img-2',
      'video:vid-2',
      'image:img-3',
      'video:vid-3',
    ])
  })

  it('downloads the original video source, stores it in a tenant prefix, and maps it idempotently', async () => {
    mockFetchVideoSource.mockResolvedValue({
      success: true,
      source: 'https://video.example/original.mp4',
      picture: 'https://video.example/thumbnail.jpg',
      length: 8,
    })

    const result = await ingestCreativeAssets({
      creative: {
        creativeId: 'creative-1',
        name: 'Winning video',
        videoId: 'vid-1',
        thumbnailUrl: 'https://video.example/thumbnail.jpg',
      },
      accountId: '123',
      organizationId: '665000000000000000000001',
      token: 'TOKEN',
    })

    expect(mockFetchVideoSource).toHaveBeenCalledWith('vid-1', 'TOKEN')
    expect(global.fetch).toHaveBeenCalledWith(
      'https://video.example/original.mp4',
      expect.objectContaining({ signal: expect.anything() }),
    )
    expect(mockUploadToR2).toHaveBeenCalledWith(expect.objectContaining({
      mimeType: 'video/mp4',
      folder: expect.stringMatching(/^tenants\/[a-f0-9]{16}\/facebook-imports$/),
    }))
    expect(mockMaterialFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: '665000000000000000000001',
        fingerprintKey: expect.stringMatching(/^fb:[a-f0-9]{16}:sha256:/),
      }),
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          type: 'video',
          source: expect.objectContaining({
            type: 'import',
            platform: 'facebook',
          }),
        }),
      }),
      expect.objectContaining({ upsert: true, new: true }),
    )
    expect(mockCreativeFindOneAndUpdate).toHaveBeenLastCalledWith(
      { creativeId: 'creative-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          ingestionStatus: 'completed',
          downloaded: true,
          isOriginal: true,
          reusable: true,
        }),
        $addToSet: { materialIds: { $each: ['material-1'] } },
      }),
    )
    expect(result).toMatchObject({ success: true, materialIds: ['material-1'] })

    mockMaterialFindOne.mockResolvedValue(materialDocument('material-existing'))
    mockUploadToR2.mockClear()
    mockMaterialFindOneAndUpdate.mockClear()

    const duplicate = await ingestCreativeAssets({
      creative: { creativeId: 'creative-2', videoId: 'vid-1' },
      accountId: '123',
      organizationId: '665000000000000000000001',
      token: 'TOKEN',
    })

    expect(mockUploadToR2).not.toHaveBeenCalled()
    expect(mockMaterialFindOneAndUpdate).not.toHaveBeenCalled()
    expect(duplicate).toMatchObject({
      success: true,
      materialIds: ['material-existing'],
      reused: 1,
    })
  })

  it('uses one global content fingerprint for unowned Facebook accounts', async () => {
    mockFetchVideoSource.mockResolvedValue({
      success: true,
      source: 'https://video.example/shared.mp4',
      length: 8,
    })

    await ingestCreativeAssets({
      creative: { creativeId: 'creative-account-a', videoId: 'video-account-a' },
      accountId: 'account-a',
      token: 'TOKEN-A',
    })
    await ingestCreativeAssets({
      creative: { creativeId: 'creative-account-b', videoId: 'video-account-b' },
      accountId: 'account-b',
      token: 'TOKEN-B',
    })

    const firstQuery = mockMaterialFindOneAndUpdate.mock.calls[0][0]
    const secondQuery = mockMaterialFindOneAndUpdate.mock.calls[1][0]
    const firstUpload = mockUploadToR2.mock.calls[0][0]
    const secondUpload = mockUploadToR2.mock.calls[1][0]

    expect(firstQuery.fingerprintKey).toBe(secondQuery.fingerprintKey)
    expect(firstUpload.folder).toBe(secondUpload.folder)
  })

  it('reuses an original native Facebook asset before downloading it again', async () => {
    mockMaterialFindOne.mockResolvedValue({
      ...materialDocument('material-shared-native'),
      source: { platform: 'facebook', isOriginal: true },
    })

    const result = await ingestCreativeAssets({
      creative: { creativeId: 'creative-shared', videoId: 'video-shared' },
      accountId: 'account-b',
      token: 'TOKEN-B',
    })

    expect(mockFetchVideoSource).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(mockUploadToR2).not.toHaveBeenCalled()
    expect(mockMaterialFindOne).toHaveBeenCalledWith(expect.objectContaining({
      status: { $in: ['uploaded', 'ready'] },
      'source.platform': 'facebook',
      'source.isOriginal': true,
      $or: expect.arrayContaining([
        { 'facebookMappings.videoId': 'video-shared' },
        { 'facebook.videoId': 'video-shared' },
      ]),
    }))
    const reuseUpdate = mockMaterialUpdateOne.mock.calls[0][1]
    expect(reuseUpdate.$addToSet.facebookMappings).not.toHaveProperty('uploadedAt')
    expect(result).toMatchObject({
      success: true,
      materialIds: ['material-shared-native'],
      reused: 1,
    })
  })

  it('rehydrates a deleted material instead of linking to its removed R2 object', async () => {
    mockFetchVideoSource.mockResolvedValue({
      success: true,
      source: 'https://video.example/restored.mp4',
      length: 8,
    })
    const deleted = {
      ...materialDocument('material-deleted'),
      status: 'deleted',
      source: { platform: 'facebook', isOriginal: true },
    }
    mockMaterialFindOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(deleted)
    mockMaterialFindOneAndUpdate.mockResolvedValueOnce({
      ...materialDocument('material-deleted'),
      status: 'ready',
    })

    const result = await ingestCreativeAssets({
      creative: { creativeId: 'creative-restored', videoId: 'video-restored' },
      accountId: 'account-restored',
      token: 'TOKEN',
    })

    expect(mockUploadToR2).toHaveBeenCalled()
    expect(mockMaterialFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: deleted._id, status: 'deleted' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'ready',
          storage: expect.objectContaining({ provider: 'r2' }),
        }),
      }),
      { new: true },
    )
    expect(result).toMatchObject({
      success: true,
      materialIds: ['material-deleted'],
    })
  })

  it('resolves an image hash to the original image and labels preview fallback honestly', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => name.toLowerCase() === 'content-type' ? 'image/jpeg' : null,
      },
      arrayBuffer: async () => Buffer.from('image-bytes'),
    })
    mockFetchImageByHash.mockResolvedValue({
      success: true,
      url: 'https://image.example/original.jpg',
      width: 1200,
      height: 1200,
    })

    const original = await ingestCreativeAssets({
      creative: {
        creativeId: 'creative-image-original',
        imageHash: 'hash-original',
        imageUrl: 'https://image.example/preview.jpg',
      },
      accountId: '123',
      organizationId: '665000000000000000000001',
      token: 'TOKEN',
    })

    expect(mockFetchImageByHash).toHaveBeenCalledWith('act_123', 'hash-original', 'TOKEN')
    expect(global.fetch).toHaveBeenLastCalledWith(
      'https://image.example/original.jpg',
      expect.any(Object),
    )
    expect(original.success).toBe(true)
    expect(mockCreativeFindOneAndUpdate).toHaveBeenLastCalledWith(
      { creativeId: 'creative-image-original' },
      expect.objectContaining({
        $set: expect.objectContaining({ isOriginal: true, reusable: true }),
      }),
    )

    jest.clearAllMocks()
    mockMaterialFindOne.mockResolvedValue(null)
    mockMaterialFindOneAndUpdate.mockResolvedValue(materialDocument('material-preview'))
    mockCreativeFindOneAndUpdate.mockResolvedValue({})
    mockUploadToR2.mockResolvedValue({
      success: true,
      key: 'tenant/facebook/preview.jpg',
      url: 'https://r2.example/tenant/facebook/preview.jpg',
    })
    mockFetchImageByHash.mockResolvedValue({ success: false, error: 'original unavailable' })
    ;(global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (name: string) => name === 'content-type' ? 'image/jpeg' : null },
      arrayBuffer: async () => Buffer.from('preview-bytes'),
    })

    const preview = await ingestCreativeAssets({
      creative: {
        creativeId: 'creative-image-preview',
        imageHash: 'hash-preview',
        imageUrl: 'https://image.example/preview-only.jpg',
      },
      accountId: '123',
      organizationId: '665000000000000000000001',
      token: 'TOKEN',
    })

    expect(global.fetch).toHaveBeenLastCalledWith(
      'https://image.example/preview-only.jpg',
      expect.any(Object),
    )
    expect(mockMaterialFindOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          source: expect.objectContaining({ isOriginal: false }),
          tags: expect.arrayContaining(['preview']),
        }),
      }),
      expect.any(Object),
    )
    expect(mockCreativeFindOneAndUpdate).toHaveBeenLastCalledWith(
      { creativeId: 'creative-image-preview' },
      expect.objectContaining({
        $set: expect.objectContaining({ isOriginal: false, reusable: false }),
      }),
    )
    expect(preview.success).toBe(true)
  })

  it('never labels a video thumbnail as the original video', async () => {
    mockFetchVideoSource.mockResolvedValue({
      success: false,
      error: 'source unavailable',
    })

    const result = await ingestCreativeAssets({
      creative: {
        creativeId: 'creative-3',
        videoId: 'vid-3',
        thumbnailUrl: 'https://video.example/thumbnail.jpg',
      },
      accountId: '123',
      organizationId: '665000000000000000000001',
      token: 'TOKEN',
    })

    expect(global.fetch).not.toHaveBeenCalled()
    expect(mockUploadToR2).not.toHaveBeenCalled()
    expect(mockCreativeFindOneAndUpdate).toHaveBeenLastCalledWith(
      { creativeId: 'creative-3' },
      expect.objectContaining({
        $set: expect.objectContaining({
          ingestionStatus: 'failed',
          ingestionError: expect.stringContaining('original video'),
        }),
      }),
    )
    expect(result.success).toBe(false)
  })

  it('recovers a concurrent fingerprint upsert without leaving an orphaned R2 object', async () => {
    mockFetchVideoSource.mockResolvedValue({
      success: true,
      source: 'https://video.example/original.mp4',
      length: 8,
    })
    const duplicateKeyError: any = new Error('duplicate key')
    duplicateKeyError.code = 11000
    mockMaterialFindOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(materialDocument('material-race-winner'))
    mockMaterialFindOneAndUpdate.mockRejectedValueOnce(duplicateKeyError)

    const result = await ingestCreativeAssets({
      creative: { creativeId: 'creative-race', videoId: 'video-race' },
      accountId: '123',
      organizationId: '665000000000000000000001',
      token: 'TOKEN',
    })

    expect(mockDeleteFromR2).toHaveBeenCalledWith('tenant/facebook/video.mp4')
    expect(result).toMatchObject({
      success: true,
      materialIds: ['material-race-winner'],
      reused: 1,
    })
  })
})
