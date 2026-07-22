const mockDownloadRemoteMedia = jest.fn()
const mockUploadBufferToR2 = jest.fn()
const mockDeleteR2Object = jest.fn()
const mockMaterialFindOne = jest.fn()
const mockMaterialFindOneAndUpdate = jest.fn()
const mockMaterialCreate = jest.fn()
const mockOriginFindOne = jest.fn()
const mockOriginFindOneAndUpdate = jest.fn()

jest.mock('../src/services/remoteMediaDownload.service', () => ({
  downloadRemoteMedia: mockDownloadRemoteMedia,
}))

jest.mock('../src/services/r2Storage.service', () => ({
  uploadBufferToR2: mockUploadBufferToR2,
  deleteR2Object: mockDeleteR2Object,
}))

jest.mock('../src/models/Material', () => ({
  __esModule: true,
  default: {
    findOne: mockMaterialFindOne,
    findOneAndUpdate: mockMaterialFindOneAndUpdate,
    create: mockMaterialCreate,
  },
}))

jest.mock('../src/models/MaterialOriginMapping', () => ({
  __esModule: true,
  default: {
    findOne: mockOriginFindOne,
    findOneAndUpdate: mockOriginFindOneAndUpdate,
  },
}))

import {
  ingestExternalMaterial,
  ingestExternalMaterials,
} from '../src/services/externalMaterialIngestion.service'
import type { NormalizedGuangdadaAsset } from '../src/integration/guangdada/types'

const candidate = (
  providerAssetKey: string,
  overrides: Partial<NormalizedGuangdadaAsset> = {},
): NormalizedGuangdadaAsset => ({
  provider: 'guangdada',
  providerAssetKey,
  recordId: `record-${providerAssetKey}`,
  packageKey: 'pkg_0123456789abcdef',
  packageName: 'Example Game',
  productName: 'Example Product',
  advertiserName: 'Example Studio',
  mediaType: 'video',
  mediaRole: 'primary',
  mediaIndex: 0,
  mediaUrl: `https://cdn.example/${providerAssetKey}.mp4?signature=private-${providerAssetKey}`,
  heat: 80,
  estimatedValue: 120,
  sourcePageUrl: 'https://provider.example/detail/record',
  ...overrides,
})

const material = (id: string, overrides: Record<string, unknown> = {}) => ({
  _id: { toString: () => id },
  status: 'ready',
  organizationId: undefined,
  storage: {
    key: `global/${id}.mp4`,
    url: `https://r2.example/global/${id}.mp4`,
  },
  fingerprint: { sha256: 'existing-sha', md5: 'existing-md5' },
  source: { platform: 'guangdada' },
  ...overrides,
})

const duplicateKeyError = () => {
  const error: any = new Error('duplicate key with secret provider payload')
  error.code = 11000
  return error
}

describe('external material ingestion', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockOriginFindOne.mockResolvedValue(null)
    mockOriginFindOneAndUpdate.mockResolvedValue({})
    mockMaterialFindOne.mockResolvedValue(null)
    mockMaterialFindOneAndUpdate.mockResolvedValue(null)
    mockDownloadRemoteMedia.mockResolvedValue({
      buffer: Buffer.from('shared-video-bytes'),
      mimeType: 'video/mp4',
      filename: 'download.mp4',
      host: 'cdn.example',
    })
    mockUploadBufferToR2.mockResolvedValue({
      success: true,
      key: 'global/external/guangdada/new-object.mp4',
      url: 'https://r2.example/global/external/guangdada/new-object.mp4',
    })
    mockDeleteR2Object.mockResolvedValue({ success: true })
    mockMaterialCreate.mockImplementation(async (fields: any) => ({
      ...fields,
      _id: { toString: () => 'material-created' },
    }))
  })

  it('updates an active provider observation without downloading or uploading again', async () => {
    const existing = material('material-already-seen')
    mockOriginFindOne.mockResolvedValue({
      provider: 'guangdada',
      providerAssetKey: 'asset-existing',
      materialId: existing._id,
    })
    mockMaterialFindOne.mockResolvedValue(existing)

    const result = await ingestExternalMaterial(
      candidate('asset-existing', {
        heat: 99,
        estimatedValue: 250,
        mediaUrl: 'https://cdn.example/refreshed.mp4?signature=rotated',
      }),
    )

    expect(result).toEqual({
      kind: 'alreadySeen',
      materialId: 'material-already-seen',
    })
    expect(mockDownloadRemoteMedia).not.toHaveBeenCalled()
    expect(mockUploadBufferToR2).not.toHaveBeenCalled()
    expect(mockOriginFindOneAndUpdate).toHaveBeenCalledWith(
      { provider: 'guangdada', providerAssetKey: 'asset-existing' },
      expect.objectContaining({
        $set: expect.objectContaining({
          heat: 99,
          estimatedValue: 250,
          lastMediaUrl: 'https://cdn.example/refreshed.mp4?signature=rotated',
          lastSeenAt: expect.any(Date),
        }),
      }),
      expect.objectContaining({ new: true, upsert: true }),
    )
  })

  it('remaps a deleted origin directly to an active global canonical with the same SHA', async () => {
    const deleted = material('material-deleted', { status: 'deleted' })
    const winner = material('material-global-winner')
    mockOriginFindOne.mockResolvedValue({ materialId: deleted._id })
    mockMaterialFindOne.mockImplementation(async (query: any) => {
      if (query?._id) return deleted
      if (query?.['fingerprint.sha256'] === 'existing-sha') return winner
      return null
    })

    const result = await ingestExternalMaterial(candidate('asset-stale-origin'))

    expect(result).toEqual({
      kind: 'contentReused',
      materialId: 'material-global-winner',
    })
    expect(mockDownloadRemoteMedia).not.toHaveBeenCalled()
    expect(mockUploadBufferToR2).not.toHaveBeenCalled()
    expect(mockOriginFindOneAndUpdate).toHaveBeenLastCalledWith(
      { provider: 'guangdada', providerAssetKey: 'asset-stale-origin' },
      expect.objectContaining({
        $set: expect.objectContaining({ materialId: winner._id }),
      }),
      expect.objectContaining({ upsert: true }),
    )
  })

  it('downloads a deleted origin without a reusable fingerprint and remaps by downloaded content', async () => {
    const deleted = material('material-deleted-no-sha', {
      status: 'deleted',
      fingerprint: {},
    })
    const winner = material('material-downloaded-winner')
    mockOriginFindOne.mockResolvedValue({ materialId: deleted._id })
    mockMaterialFindOne.mockImplementation(async (query: any) => {
      if (query?._id) return deleted
      if (query?.['fingerprint.sha256']) return winner
      return null
    })

    const result = await ingestExternalMaterial(
      candidate('asset-deleted-download'),
    )

    expect(mockDownloadRemoteMedia).toHaveBeenCalledTimes(1)
    expect(mockUploadBufferToR2).not.toHaveBeenCalled()
    expect(result).toEqual({
      kind: 'contentReused',
      materialId: 'material-downloaded-winner',
    })
  })

  it('rehydrates a deleted global content record instead of conflicting with its fingerprint key', async () => {
    const deleted = material('material-deleted-content', { status: 'deleted' })
    const rehydrated = material('material-deleted-content', { status: 'ready' })
    mockOriginFindOne.mockResolvedValue({ materialId: deleted._id })
    mockMaterialFindOne.mockImplementation(async (query: any) => {
      if (query?._id) return deleted
      if (query?.status === 'deleted') return deleted
      return null
    })
    mockMaterialFindOneAndUpdate.mockResolvedValue(rehydrated)
    mockMaterialCreate.mockRejectedValue(duplicateKeyError())

    const result = await ingestExternalMaterial(
      candidate('asset-deleted-rehydrate'),
    )

    expect(result).toEqual({
      kind: 'created',
      materialId: 'material-deleted-content',
    })
    expect(mockUploadBufferToR2).toHaveBeenCalledTimes(1)
    expect(mockMaterialFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: deleted._id,
        organizationId: { $in: [null] },
        status: 'deleted',
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'ready',
          fingerprintKey: expect.stringMatching(
            /^content:[a-f0-9]{16}:sha256:/,
          ),
          storage: expect.objectContaining({
            key: 'global/external/guangdada/new-object.mp4',
          }),
        }),
      }),
      { new: true },
    )
    expect(mockMaterialCreate).not.toHaveBeenCalled()
    expect(mockDeleteR2Object).not.toHaveBeenCalled()
  })

  it('shares one global material and one R2 object across provider asset IDs with identical bytes', async () => {
    let canonical: any = null
    mockMaterialFindOne.mockImplementation(async (query: any) => {
      if (query?.['fingerprint.sha256']) return canonical
      return null
    })
    mockMaterialCreate.mockImplementation(async (fields: any) => {
      canonical = material('material-shared', fields)
      return canonical
    })

    const first = await ingestExternalMaterial(candidate('asset-a'))
    const second = await ingestExternalMaterial(candidate('asset-b'))

    expect(first).toEqual({ kind: 'created', materialId: 'material-shared' })
    expect(second).toEqual({
      kind: 'contentReused',
      materialId: 'material-shared',
    })
    expect(mockDownloadRemoteMedia).toHaveBeenCalledTimes(2)
    expect(mockUploadBufferToR2).toHaveBeenCalledTimes(1)
    expect(mockMaterialCreate).toHaveBeenCalledTimes(1)
  })

  it('reuses an existing global Facebook material when downloaded bytes match', async () => {
    const facebook = material('material-facebook', {
      source: { platform: 'facebook', isOriginal: true },
    })
    mockMaterialFindOne.mockImplementation(async (query: any) =>
      query?.['fingerprint.sha256'] ? facebook : null,
    )

    const result = await ingestExternalMaterial(
      candidate('asset-facebook-match'),
    )

    expect(result).toEqual({
      kind: 'contentReused',
      materialId: 'material-facebook',
    })
    expect(mockUploadBufferToR2).not.toHaveBeenCalled()
    expect(mockMaterialCreate).not.toHaveBeenCalled()
  })

  it('never attaches a global origin to an organization-private material with the same SHA', async () => {
    const privateMaterial = material('material-private', {
      organizationId: '665000000000000000000001',
    })
    mockMaterialFindOne.mockImplementation(async (query: any) => {
      if (
        query?.organizationId === '665000000000000000000001' &&
        query?.['fingerprint.sha256']
      )
        return privateMaterial
      return null
    })

    const result = await ingestExternalMaterial(
      candidate('asset-private-match'),
    )

    expect(result).toEqual({ kind: 'created', materialId: 'material-created' })
    const canonicalQueries = mockMaterialFindOne.mock.calls
      .map(([query]) => query)
      .filter((query) => query?.['fingerprint.sha256'])
    expect(canonicalQueries).not.toHaveLength(0)
    expect(
      canonicalQueries.every(
        (query) =>
          JSON.stringify(query.organizationId) ===
          JSON.stringify({ $in: [null] }),
      ),
    ).toBe(true)
    expect(mockMaterialCreate).toHaveBeenCalledWith(
      expect.not.objectContaining({
        organizationId: expect.anything(),
      }),
    )
    expect(mockOriginFindOneAndUpdate).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $set: expect.objectContaining({
          materialId: expect.not.objectContaining(privateMaterial._id),
        }),
      }),
      expect.any(Object),
    )
  })

  it('keeps only the winner object when two concurrent candidates lose the same uniqueness race', async () => {
    const retainedKeys = new Set<string>()
    let uploadCount = 0
    let canonicalLookupCount = 0
    let releaseInitialLookups: (() => void) | undefined
    const initialLookupsComplete = new Promise<void>((resolve) => {
      releaseInitialLookups = resolve
    })
    let winner: any = null

    mockMaterialFindOne.mockImplementation(async (query: any) => {
      if (!query?.['fingerprint.sha256']) return null
      canonicalLookupCount += 1
      if (canonicalLookupCount <= 2) {
        if (canonicalLookupCount === 2) releaseInitialLookups?.()
        await initialLookupsComplete
        return null
      }
      return winner
    })
    mockUploadBufferToR2.mockImplementation(async () => {
      uploadCount += 1
      const key = `global/external/guangdada/race-${uploadCount}.mp4`
      retainedKeys.add(key)
      return { success: true, key, url: `https://r2.example/${key}` }
    })
    mockMaterialCreate.mockImplementation(async (fields: any) => {
      if (!winner) {
        winner = material('material-race-winner', fields)
        return winner
      }
      throw duplicateKeyError()
    })
    mockDeleteR2Object.mockImplementation(async (key: string) => {
      retainedKeys.delete(key)
      return { success: true }
    })

    const outcomes = await Promise.all([
      ingestExternalMaterial(candidate('asset-race-a')),
      ingestExternalMaterial(candidate('asset-race-b')),
    ])

    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual([
      'contentReused',
      'created',
    ])
    expect(
      outcomes.every(
        (outcome: any) => outcome.materialId === 'material-race-winner',
      ),
    ).toBe(true)
    expect(mockUploadBufferToR2).toHaveBeenCalledTimes(2)
    expect(mockMaterialCreate).toHaveBeenCalledTimes(2)
    expect(mockDeleteR2Object).toHaveBeenCalledTimes(1)
    expect(mockDeleteR2Object).not.toHaveBeenCalledWith(winner.storage.key)
    expect([...retainedKeys]).toEqual([winner.storage.key])
    expect(mockOriginFindOneAndUpdate).toHaveBeenCalledTimes(2)
  })

  it('retries only loser cleanup and reports a redacted failure when cleanup stays broken', async () => {
    const winner = material('material-cleanup-winner')
    mockMaterialCreate.mockRejectedValue(duplicateKeyError())
    mockMaterialFindOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner)
    mockDeleteR2Object.mockResolvedValue({
      success: false,
      error: 'https://signed.example/object?secret=must-not-escape',
    })

    const result = await ingestExternalMaterial(
      candidate('asset-cleanup-failure'),
    )

    expect(result).toEqual({
      kind: 'failed',
      retryable: true,
      category: 'storage_cleanup_failed',
    })
    expect(mockDeleteR2Object).toHaveBeenCalledTimes(2)
    expect(mockDeleteR2Object).toHaveBeenNthCalledWith(
      1,
      'global/external/guangdada/new-object.mp4',
    )
    expect(mockDeleteR2Object).toHaveBeenNthCalledWith(
      2,
      'global/external/guangdada/new-object.mp4',
    )
    expect(mockOriginFindOneAndUpdate).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('signed.example')
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('retries a duplicate origin upsert race without downloading or uploading again', async () => {
    const facebook = material('material-origin-race', {
      source: { platform: 'facebook' },
    })
    mockMaterialFindOne.mockImplementation(async (query: any) =>
      query?.['fingerprint.sha256'] ? facebook : null,
    )
    mockOriginFindOneAndUpdate
      .mockRejectedValueOnce(duplicateKeyError())
      .mockResolvedValueOnce({})

    const result = await ingestExternalMaterial(candidate('asset-origin-race'))

    expect(result).toEqual({
      kind: 'contentReused',
      materialId: 'material-origin-race',
    })
    expect(mockOriginFindOneAndUpdate).toHaveBeenCalledTimes(2)
    expect(mockDownloadRemoteMedia).toHaveBeenCalledTimes(1)
    expect(mockUploadBufferToR2).not.toHaveBeenCalled()
  })

  it('retries only the mapping after creating a canonical material', async () => {
    mockOriginFindOneAndUpdate
      .mockRejectedValueOnce(new Error('temporary database detail'))
      .mockRejectedValueOnce(new Error('temporary database detail'))
      .mockResolvedValueOnce({})

    const result = await ingestExternalMaterial(
      candidate('asset-mapping-retry'),
    )

    expect(result).toEqual({ kind: 'created', materialId: 'material-created' })
    expect(mockOriginFindOneAndUpdate).toHaveBeenCalledTimes(3)
    expect(mockDownloadRemoteMedia).toHaveBeenCalledTimes(1)
    expect(mockUploadBufferToR2).toHaveBeenCalledTimes(1)
    expect(mockMaterialCreate).toHaveBeenCalledTimes(1)
    expect(mockDeleteR2Object).not.toHaveBeenCalled()
  })

  it('keeps a canonical object after mapping failure and reuses it on the next call', async () => {
    const canonical = material('material-mapping-failure')
    let canonicalAvailable = false
    mockMaterialFindOne.mockImplementation(async (query: any) => {
      if (query?.['fingerprint.sha256'])
        return canonicalAvailable ? canonical : null
      return null
    })
    mockMaterialCreate.mockImplementation(async (fields: any) => {
      canonicalAvailable = true
      return { ...canonical, ...fields }
    })
    mockOriginFindOneAndUpdate
      .mockRejectedValueOnce(new Error('db unavailable with signed URL'))
      .mockRejectedValueOnce(new Error('db unavailable with signed URL'))
      .mockRejectedValueOnce(new Error('db unavailable with signed URL'))
      .mockResolvedValueOnce({})

    const first = await ingestExternalMaterial(
      candidate('asset-mapping-failure'),
    )
    const second = await ingestExternalMaterial(
      candidate('asset-mapping-failure'),
    )

    expect(first).toEqual({
      kind: 'failed',
      retryable: true,
      category: 'origin_mapping_failed',
    })
    expect(second).toEqual({
      kind: 'contentReused',
      materialId: 'material-mapping-failure',
    })
    expect(mockDownloadRemoteMedia).toHaveBeenCalledTimes(2)
    expect(mockUploadBufferToR2).toHaveBeenCalledTimes(1)
    expect(mockMaterialCreate).toHaveBeenCalledTimes(1)
    expect(mockDeleteR2Object).not.toHaveBeenCalled()
  })

  it('does not return alreadySeen when the mapped material is deleted during observation refresh', async () => {
    const initiallyActive = material('material-deleted-later')
    const replacement = material('material-active-replacement')
    mockOriginFindOne.mockResolvedValue({ materialId: initiallyActive._id })
    let idLookupCount = 0
    mockMaterialFindOne.mockImplementation(async (query: any) => {
      if (query?._id) {
        idLookupCount += 1
        return idLookupCount === 1 ? initiallyActive : null
      }
      if (query?.['fingerprint.sha256']) {
        return mockDownloadRemoteMedia.mock.calls.length ? replacement : null
      }
      return null
    })

    const result = await ingestExternalMaterial(
      candidate('asset-deleted-during-refresh'),
    )

    expect(result).toEqual({
      kind: 'contentReused',
      materialId: 'material-active-replacement',
    })
    expect(mockDownloadRemoteMedia).toHaveBeenCalledTimes(1)
    expect(mockUploadBufferToR2).not.toHaveBeenCalled()
  })

  it('isolates invalid and failed candidates so later batch records still succeed', async () => {
    const invalid = candidate('asset-invalid', {
      mediaUrl: 'http://private.invalid/media.mp4',
    })
    const failed = candidate('asset-failed')
    const valid = candidate('asset-valid')
    mockDownloadRemoteMedia
      .mockRejectedValueOnce(
        Object.assign(new Error('signed provider URL must stay private'), {
          category: 'network',
        }),
      )
      .mockResolvedValueOnce({
        buffer: Buffer.from('valid-video-bytes'),
        mimeType: 'video/mp4',
        filename: 'valid.mp4',
        host: 'cdn.example',
      })

    const results = await ingestExternalMaterials([invalid, failed, valid])

    expect(results).toEqual([
      { kind: 'invalid', reason: 'invalid_candidate' },
      { kind: 'failed', retryable: true, category: 'download_network' },
      { kind: 'created', materialId: 'material-created' },
    ])
    expect(mockDownloadRemoteMedia).toHaveBeenCalledTimes(2)
    expect(mockUploadBufferToR2).toHaveBeenCalledTimes(1)
    expect(mockMaterialCreate).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(results)).not.toContain('signed provider URL')
    expect(JSON.stringify(results)).not.toContain('private-asset')
  })
})
