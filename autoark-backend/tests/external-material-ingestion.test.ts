import { createHash } from 'crypto'
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
import { buildMaterialFingerprintKey } from '../src/utils/materialContentIdentity'

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

const plannedExternalKey = (providerAssetKey: string, bytes: Buffer) => {
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const assetHash = createHash('sha256')
    .update(`guangdada:${providerAssetKey}`)
    .digest('hex')
    .slice(0, 24)
  return `global/external/guangdada/${sha256}/${assetHash}`
}

describe('external material ingestion', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    let defaultCreatedMaterial: any = null
    mockOriginFindOne.mockResolvedValue(null)
    mockOriginFindOneAndUpdate.mockImplementation(
      async (_filter: any, update: any) => ({
        ...update.$setOnInsert,
        ...update.$set,
      }),
    )
    mockMaterialFindOne.mockImplementation(async (query: any) => {
      if (
        query?._id &&
        defaultCreatedMaterial &&
        String(query._id) === String(defaultCreatedMaterial._id)
      ) {
        return defaultCreatedMaterial
      }
      return null
    })
    mockMaterialFindOneAndUpdate.mockResolvedValue(null)
    mockDownloadRemoteMedia.mockResolvedValue({
      buffer: Buffer.from('shared-video-bytes'),
      mimeType: 'video/mp4',
      filename: 'download.mp4',
      host: 'cdn.example',
    })
    mockUploadBufferToR2.mockImplementation(async (params: any) => ({
      success: true,
      key: params.key,
      url: `https://r2.example/${params.key}`,
    }))
    mockDeleteR2Object.mockResolvedValue({ success: true })
    mockMaterialCreate.mockImplementation(async (fields: any) => {
      defaultCreatedMaterial = {
        ...fields,
        _id: { toString: () => 'material-created' },
      }
      return defaultCreatedMaterial
    })
  })

  it('reports no download for invalid candidates, database lookup failures, and download errors', async () => {
    const invalid = await ingestExternalMaterial(
      candidate('asset-invalid-before-download', {
        mediaUrl: 'http://private.invalid/media.mp4',
      }),
    )

    mockOriginFindOne.mockRejectedValueOnce(new Error('database unavailable'))
    const lookupFailed = await ingestExternalMaterial(
      candidate('asset-lookup-before-download'),
    )

    mockDownloadRemoteMedia.mockRejectedValueOnce(
      Object.assign(new Error('network unavailable'), { category: 'network' }),
    )
    const downloadFailed = await ingestExternalMaterial(
      candidate('asset-download-error'),
    )

    expect(invalid).toMatchObject({
      kind: 'invalid',
      reason: 'invalid_candidate',
      downloaded: false,
    })
    expect(lookupFailed).toMatchObject({
      kind: 'failed',
      category: 'database_lookup_failed',
      downloaded: false,
    })
    expect(downloadFailed).toMatchObject({
      kind: 'failed',
      category: 'download_network',
      downloaded: false,
    })
  })

  it('reports a download after remote content returns even when later processing rejects it', async () => {
    mockDownloadRemoteMedia.mockResolvedValueOnce({
      buffer: Buffer.alloc(0),
      mimeType: 'video/mp4',
      filename: 'empty.mp4',
      host: 'cdn.example',
    })

    const result = await ingestExternalMaterial(
      candidate('asset-invalid-after-download'),
    )

    mockMaterialFindOne.mockRejectedValueOnce(
      new Error('database unavailable after download'),
    )
    const lookupFailed = await ingestExternalMaterial(
      candidate('asset-lookup-after-download'),
    )

    expect(result).toEqual({
      kind: 'invalid',
      reason: 'invalid_media',
      downloaded: true,
    })
    expect(lookupFailed).toMatchObject({
      kind: 'failed',
      category: 'database_lookup_failed',
      downloaded: true,
    })
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
      downloaded: expect.any(Boolean),
      kind: 'alreadySeen',
      materialId: 'material-already-seen',
    })
    expect(result.downloaded).toBe(false)
    expect(mockDownloadRemoteMedia).not.toHaveBeenCalled()
    expect(mockUploadBufferToR2).not.toHaveBeenCalled()
    expect(mockOriginFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'guangdada',
        providerAssetKey: 'asset-existing',
        $or: expect.any(Array),
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          heat: 99,
          estimatedValue: 250,
          lastMediaUrl: 'https://cdn.example/refreshed.mp4',
          lastSeenAt: expect.any(Date),
        }),
      }),
      expect.objectContaining({ new: true, upsert: true }),
    )
  })

  it('downloads with the original signed URL but persists redacted origin URLs and errors', async () => {
    const secretSentinel = 'SECRET_SENTINEL_QUERY_AND_FRAGMENT'
    const signedMediaUrl =
      `https://cdn.example/assets/video.mp4?signature=${secretSentinel}` +
      `&X-Amz-Credential=${secretSentinel}#${secretSentinel}`
    const signedSourcePageUrl =
      `https://provider.example/detail/record?token=${secretSentinel}` +
      `#${secretSentinel}`
    mockOriginFindOneAndUpdate.mockRejectedValue(
      new Error(`database failure ${secretSentinel}`),
    )

    const result = await ingestExternalMaterial(
      candidate('asset-redacted-observation', {
        mediaUrl: signedMediaUrl,
        sourcePageUrl: signedSourcePageUrl,
      }),
    )

    expect(mockDownloadRemoteMedia).toHaveBeenCalledWith(signedMediaUrl)
    expect(mockOriginFindOneAndUpdate).toHaveBeenCalledTimes(3)
    expect(mockOriginFindOneAndUpdate).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $set: expect.objectContaining({
          lastMediaUrl: 'https://cdn.example/assets/video.mp4',
          sourcePageUrl: 'https://provider.example/detail/record',
        }),
      }),
      expect.any(Object),
    )
    expect(JSON.stringify(mockOriginFindOneAndUpdate.mock.calls)).not.toContain(
      secretSentinel,
    )
    expect(JSON.stringify(result)).not.toContain(secretSentinel)
    expect(result).toEqual({
      downloaded: expect.any(Boolean),
      kind: 'failed',
      retryable: true,
      category: 'origin_mapping_failed',
    })
  })

  it.each([
    'https://SECRET_SENTINEL_USER:SECRET_SENTINEL_PASSWORD@cdn.example/video.mp4',
    'http://cdn.example/SECRET_SENTINEL_HTTP.mp4',
    'SECRET_SENTINEL_MALFORMED',
  ])(
    'rejects an unsafe lastMediaUrl candidate without persisting it: %s',
    async (mediaUrl) => {
      const result = await ingestExternalMaterial(
        candidate('asset-invalid-media-origin', { mediaUrl }),
      )

      expect(result).toEqual({
        downloaded: expect.any(Boolean),
        kind: 'invalid',
        reason: 'invalid_candidate',
      })
      expect(mockDownloadRemoteMedia).not.toHaveBeenCalled()
      expect(mockOriginFindOneAndUpdate).not.toHaveBeenCalled()
      expect(JSON.stringify(result)).not.toContain('SECRET_SENTINEL')
    },
  )

  it.each([
    'https://SECRET_SENTINEL_USER:SECRET_SENTINEL_PASSWORD@provider.example/detail',
    'http://provider.example/SECRET_SENTINEL_HTTP',
    'SECRET_SENTINEL_MALFORMED',
  ])(
    'omits an unsafe sourcePageUrl from persisted metadata: %s',
    async (sourcePageUrl) => {
      const result = await ingestExternalMaterial(
        candidate('asset-invalid-source-origin', { sourcePageUrl }),
      )

      expect(result).toEqual({
        downloaded: expect.any(Boolean),
        kind: 'created',
        materialId: 'material-created',
      })
      expect(mockOriginFindOneAndUpdate).toHaveBeenCalledTimes(1)
      const persistedArguments = JSON.stringify(
        mockOriginFindOneAndUpdate.mock.calls,
      )
      expect(persistedArguments).not.toContain('sourcePageUrl')
      expect(persistedArguments).not.toContain('SECRET_SENTINEL')
      expect(JSON.stringify(result)).not.toContain('SECRET_SENTINEL')
    },
  )

  it('remaps a deleted origin directly to an active global canonical with the same SHA', async () => {
    const deleted = material('material-deleted', { status: 'deleted' })
    const winner = material('material-global-winner')
    mockOriginFindOne.mockResolvedValue({ materialId: deleted._id })
    mockMaterialFindOne.mockImplementation(async (query: any) => {
      if (query?._id) {
        if (String(query._id) === 'material-global-winner') return winner
        return query.status ? null : deleted
      }
      if (query?.['fingerprint.sha256'] === 'existing-sha') return winner
      return null
    })

    const result = await ingestExternalMaterial(candidate('asset-stale-origin'))

    expect(result).toEqual({
      downloaded: expect.any(Boolean),
      kind: 'contentReused',
      materialId: 'material-global-winner',
    })
    expect(mockDownloadRemoteMedia).not.toHaveBeenCalled()
    expect(mockUploadBufferToR2).not.toHaveBeenCalled()
    expect(mockOriginFindOneAndUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        provider: 'guangdada',
        providerAssetKey: 'asset-stale-origin',
        $or: expect.any(Array),
      }),
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
      if (query?._id) {
        if (String(query._id) === 'material-downloaded-winner') return winner
        return query.status ? null : deleted
      }
      if (query?.['fingerprint.sha256']) return winner
      return null
    })

    const result = await ingestExternalMaterial(
      candidate('asset-deleted-download'),
    )

    expect(mockDownloadRemoteMedia).toHaveBeenCalledTimes(1)
    expect(mockUploadBufferToR2).not.toHaveBeenCalled()
    expect(result).toEqual({
      downloaded: expect.any(Boolean),
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
      downloaded: expect.any(Boolean),
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
            key: plannedExternalKey(
              'asset-deleted-rehydrate',
              Buffer.from('shared-video-bytes'),
            ),
          }),
        }),
      }),
      { new: true },
    )
    expect(mockMaterialCreate).not.toHaveBeenCalled()
    expect(mockDeleteR2Object).not.toHaveBeenCalled()
  })

  it('prefers and restores the deleted exact fingerprint holder when multiple deleted rows share SHA', async () => {
    const bytes = Buffer.from('shared-video-bytes')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const fingerprintKey = buildMaterialFingerprintKey(undefined, sha256)
    const firstDeleted = material('material-deleted-d1', {
      status: 'deleted',
      fingerprint: { sha256 },
      fingerprintKey: 'legacy:deleted-d1',
    })
    const exactDeleted = material('material-deleted-d2-exact', {
      status: 'deleted',
      fingerprint: { sha256 },
      fingerprintKey,
      deduplicatedInto: firstDeleted._id,
    })
    const restored = material('material-deleted-d2-exact', {
      status: 'ready',
      fingerprint: { sha256 },
      fingerprintKey,
    })
    mockMaterialFindOne.mockImplementation(async (query: any) => {
      if (query?._id && String(query._id) === 'material-deleted-d2-exact') {
        return restored
      }
      if (query?.fingerprintKey === fingerprintKey) {
        return query.status === 'deleted' ? exactDeleted : null
      }
      if (
        query?.status === 'deleted' &&
        query?.['fingerprint.sha256'] === sha256
      ) {
        return firstDeleted
      }
      return null
    })
    mockMaterialFindOneAndUpdate.mockResolvedValue(restored)

    const result = await ingestExternalMaterial(
      candidate('asset-multiple-deleted-holders'),
    )

    expect(result).toEqual({
      downloaded: expect.any(Boolean),
      kind: 'created',
      materialId: 'material-deleted-d2-exact',
    })
    const holderQueries = mockMaterialFindOne.mock.calls
      .map(([query]) => query)
      .filter((query) => query?.fingerprintKey === fingerprintKey)
    expect(holderQueries.slice(0, 2)).toEqual([
      expect.objectContaining({
        organizationId: { $in: [null] },
        status: { $in: ['uploaded', 'ready'] },
        fingerprintKey,
      }),
      expect.objectContaining({
        organizationId: { $in: [null] },
        status: 'deleted',
        fingerprintKey,
      }),
    ])
    expect(mockMaterialFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: exactDeleted._id,
        status: 'deleted',
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'ready',
          fingerprintKey,
          storage: expect.objectContaining({
            key: plannedExternalKey(
              'asset-multiple-deleted-holders',
              Buffer.from('shared-video-bytes'),
            ),
          }),
        }),
        $unset: expect.objectContaining({ deduplicatedInto: 1 }),
      }),
      { new: true },
    )
    expect(mockMaterialCreate).not.toHaveBeenCalled()
    expect(mockDeleteR2Object).not.toHaveBeenCalled()
  })

  it('boundedly rechecks holder visibility after E11000 and restores a newly visible deleted exact holder', async () => {
    const bytes = Buffer.from('shared-video-bytes')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const fingerprintKey = buildMaterialFingerprintKey(undefined, sha256)
    const exactDeleted = material('material-visible-after-race', {
      status: 'deleted',
      fingerprint: { sha256 },
      fingerprintKey,
      deduplicatedInto: material('old-canonical')._id,
    })
    const restored = material('material-visible-after-race', {
      status: 'ready',
      fingerprint: { sha256 },
      fingerprintKey,
    })
    let activeExactLookups = 0
    let deletedExactLookups = 0
    mockMaterialFindOne.mockImplementation(async (query: any) => {
      if (query?._id && String(query._id) === 'material-visible-after-race') {
        return restored
      }
      if (query?.fingerprintKey !== fingerprintKey) return null
      if (query?.status === 'deleted') {
        deletedExactLookups += 1
        return deletedExactLookups >= 2 ? exactDeleted : null
      }
      activeExactLookups += 1
      return null
    })
    mockMaterialCreate.mockRejectedValue(duplicateKeyError())
    mockMaterialFindOneAndUpdate.mockResolvedValue(restored)

    const result = await ingestExternalMaterial(
      candidate('asset-holder-visibility-race'),
    )

    expect(result).toEqual({
      downloaded: expect.any(Boolean),
      kind: 'created',
      materialId: 'material-visible-after-race',
    })
    expect(activeExactLookups).toBeGreaterThanOrEqual(2)
    expect(activeExactLookups).toBeLessThanOrEqual(3)
    expect(deletedExactLookups).toBe(2)
    expect(mockMaterialFindOneAndUpdate).toHaveBeenCalledTimes(1)
    expect(mockDeleteR2Object).not.toHaveBeenCalled()
  })

  it('shares one global material and one R2 object across provider asset IDs with identical bytes', async () => {
    let canonical: any = null
    mockMaterialFindOne.mockImplementation(async (query: any) => {
      if (
        query?._id &&
        canonical &&
        String(query._id) === String(canonical._id)
      ) {
        return canonical
      }
      if (query?.fingerprintKey) return canonical
      if (query?.['fingerprint.sha256']) return canonical
      return null
    })
    mockMaterialCreate.mockImplementation(async (fields: any) => {
      canonical = material('material-shared', fields)
      return canonical
    })

    const first = await ingestExternalMaterial(candidate('asset-a'))
    const second = await ingestExternalMaterial(candidate('asset-b'))

    expect(first).toEqual({
      downloaded: expect.any(Boolean),
      kind: 'created',
      materialId: 'material-shared',
    })
    expect(second).toEqual({
      downloaded: expect.any(Boolean),
      kind: 'contentReused',
      materialId: 'material-shared',
    })
    expect(mockDownloadRemoteMedia).toHaveBeenCalledTimes(2)
    expect(mockUploadBufferToR2).toHaveBeenCalledTimes(1)
    expect(mockMaterialCreate).toHaveBeenCalledTimes(1)
  })

  it('creates the exact global canonical identity from downloaded bytes and the external R2 prefix', async () => {
    const bytes = Buffer.from('fixed-canonical-byte-payload-v1')
    const expectedSha256 = createHash('sha256').update(bytes).digest('hex')
    const expectedMd5 = createHash('md5').update(bytes).digest('hex')
    const expectedFingerprintKey = buildMaterialFingerprintKey(
      undefined,
      expectedSha256,
    )
    const expectedStorageKey = plannedExternalKey(
      'asset-exact-canonical',
      bytes,
    )
    mockDownloadRemoteMedia.mockResolvedValue({
      buffer: bytes,
      mimeType: 'video/mp4',
      filename: 'fixed-canonical.mp4',
      host: 'cdn.example',
    })
    mockUploadBufferToR2.mockResolvedValue({
      success: true,
      key: expectedStorageKey,
      url: `https://r2.example/${expectedStorageKey}`,
    })

    const result = await ingestExternalMaterial(
      candidate('asset-exact-canonical'),
    )

    expect(result).toEqual({
      downloaded: expect.any(Boolean),
      kind: 'created',
      materialId: 'material-created',
    })
    expect(result.downloaded).toBe(true)
    expect(mockUploadBufferToR2).toHaveBeenCalledWith(
      expect.objectContaining({
        buffer: bytes,
        folder: 'global/external/guangdada',
      }),
    )
    expect(mockMaterialFindOne).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: { $in: [null] },
        status: { $in: ['uploaded', 'ready'] },
        'fingerprint.sha256': expectedSha256,
      }),
    )
    expect(mockMaterialCreate).toHaveBeenCalledTimes(1)
    const createdPayload = mockMaterialCreate.mock.calls[0][0]
    expect(createdPayload).toMatchObject({
      status: 'ready',
      fingerprint: {
        sha256: expectedSha256,
        md5: expectedMd5,
      },
      fingerprintKey: expectedFingerprintKey,
      storage: {
        key: expectedStorageKey,
      },
    })
    expect(createdPayload.fingerprint.md5).not.toBe(expectedSha256)
    expect(createdPayload.fingerprintKey).toBe(
      buildMaterialFingerprintKey(undefined, expectedSha256),
    )
    expect(
      createdPayload.storage.key.startsWith('global/external/guangdada/'),
    ).toBe(true)
    expect(createdPayload).not.toHaveProperty('organizationId')
    expect(createdPayload).not.toHaveProperty('folder')
    expect(createdPayload.source).not.toHaveProperty('externalCreativeId')
  })

  it('plans a stable R2 key before upload and separates provider assets with identical bytes', async () => {
    const bytes = Buffer.from('shared-video-bytes')
    mockDownloadRemoteMedia
      .mockResolvedValueOnce({
        buffer: bytes,
        mimeType: 'video/mp4',
        filename: 'first-name.mp4',
        host: 'cdn.example',
      })
      .mockResolvedValueOnce({
        buffer: bytes,
        mimeType: 'video/mp4',
        filename: 'renamed-on-retry.mov',
        host: 'cdn.example',
      })
      .mockResolvedValueOnce({
        buffer: bytes,
        mimeType: 'video/mp4',
        filename: 'other-asset.avi',
        host: 'cdn.example',
      })
    mockUploadBufferToR2.mockRejectedValue(
      new Error('ambiguous put result with private provider detail'),
    )

    const first = await ingestExternalMaterial(candidate('asset-stable-key'))
    const retry = await ingestExternalMaterial(candidate('asset-stable-key'))
    const otherAsset = await ingestExternalMaterial(
      candidate('asset-other-key'),
    )

    expect(first).toEqual({
      downloaded: expect.any(Boolean),
      kind: 'failed',
      retryable: true,
      category: 'storage_upload_failed',
    })
    expect(retry).toEqual(first)
    expect(otherAsset).toEqual(first)
    const plannedKeys = mockUploadBufferToR2.mock.calls.map(
      ([params]) => params.key,
    )
    expect(plannedKeys).toEqual([
      plannedExternalKey('asset-stable-key', bytes),
      plannedExternalKey('asset-stable-key', bytes),
      plannedExternalKey('asset-other-key', bytes),
    ])
    expect(plannedKeys[0]).toBe(plannedKeys[1])
    expect(plannedKeys[0]).not.toBe(plannedKeys[2])
    expect(
      plannedKeys.every((key) => key.startsWith('global/external/guangdada/')),
    ).toBe(true)
    expect(mockDeleteR2Object).not.toHaveBeenCalled()
  })

  it('reuses the same planned key after an ambiguous PutObject result', async () => {
    const bytes = Buffer.from('shared-video-bytes')
    let uploadAttempt = 0
    mockUploadBufferToR2.mockImplementation(async (params: any) => {
      uploadAttempt += 1
      if (uploadAttempt === 1) {
        throw new Error('PutObject may have committed before disconnect')
      }
      return {
        success: true,
        key: params.key,
        url: `https://r2.example/${params.key}`,
      }
    })

    const first = await ingestExternalMaterial(candidate('asset-put-retry'))
    const second = await ingestExternalMaterial(candidate('asset-put-retry'))

    expect(first).toEqual({
      downloaded: expect.any(Boolean),
      kind: 'failed',
      retryable: true,
      category: 'storage_upload_failed',
    })
    expect(second).toEqual({
      downloaded: expect.any(Boolean),
      kind: 'created',
      materialId: 'material-created',
    })
    const keys = mockUploadBufferToR2.mock.calls.map(([params]) => params.key)
    expect(keys).toEqual([
      plannedExternalKey('asset-put-retry', bytes),
      plannedExternalKey('asset-put-retry', bytes),
    ])
    expect(mockDeleteR2Object).not.toHaveBeenCalled()
  })

  it('reconciles a server-committed Material after the client receives a write error', async () => {
    const bytes = Buffer.from('shared-video-bytes')
    const plannedKey = plannedExternalKey('asset-db-committed', bytes)
    const committed = material('material-db-committed', {
      fingerprintKey: buildMaterialFingerprintKey(
        undefined,
        createHash('sha256').update(bytes).digest('hex'),
      ),
      storage: {
        key: plannedKey,
        url: `https://r2.example/${plannedKey}`,
      },
    })
    let createAttempted = false
    mockMaterialCreate.mockImplementation(async () => {
      createAttempted = true
      throw new Error('client disconnected after server commit')
    })
    mockMaterialFindOne.mockImplementation(async (query: any) => {
      if (query?._id && String(query._id) === 'material-db-committed') {
        return committed
      }
      if (createAttempted && query?.['storage.key'] === plannedKey) {
        return committed
      }
      return null
    })

    const result = await ingestExternalMaterial(candidate('asset-db-committed'))

    expect(result).toEqual({
      downloaded: expect.any(Boolean),
      kind: 'created',
      materialId: 'material-db-committed',
    })
    expect(mockMaterialFindOne).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: { $in: [null] },
        status: { $in: ['uploaded', 'ready'] },
        fingerprintKey: expect.any(String),
        'storage.key': plannedKey,
      }),
    )
    expect(mockDeleteR2Object).not.toHaveBeenCalled()
  })

  it('keeps the planned object when an ambiguous Material write has no visible winner', async () => {
    mockMaterialCreate.mockRejectedValue(
      new Error('write result unknown after request dispatch'),
    )
    mockMaterialFindOne.mockResolvedValue(null)

    const result = await ingestExternalMaterial(
      candidate('asset-db-ambiguous-no-winner'),
    )

    expect(result).toEqual({
      downloaded: expect.any(Boolean),
      kind: 'failed',
      retryable: true,
      category: 'canonical_write_failed',
    })
    expect(mockDeleteR2Object).not.toHaveBeenCalled()
  })

  it('keeps the planned object when the canonical commits after the final reconciliation query', async () => {
    const bytes = Buffer.from('shared-video-bytes')
    const plannedKey = plannedExternalKey('asset-db-commit-after-query', bytes)
    const fingerprintKey = buildMaterialFingerprintKey(
      undefined,
      createHash('sha256').update(bytes).digest('hex'),
    )
    let createAttempted = false
    let canonical: any = null
    let markFinalLookupStarted: (() => void) | undefined
    let releaseFinalLookup: (() => void) | undefined
    const finalLookupStarted = new Promise<void>((resolve) => {
      markFinalLookupStarted = resolve
    })
    const finalLookupReleased = new Promise<void>((resolve) => {
      releaseFinalLookup = resolve
    })
    mockMaterialCreate.mockImplementation(async () => {
      createAttempted = true
      throw new Error('client disconnected while Material write was in flight')
    })
    mockMaterialFindOne.mockImplementation(async (query: any) => {
      if (
        query?._id &&
        canonical &&
        String(query._id) === String(canonical._id)
      ) {
        return canonical
      }
      if (!createAttempted) return null
      if (query?.['storage.key'] === plannedKey) return null
      if (query?.fingerprintKey === fingerprintKey) {
        const snapshot = canonical
        markFinalLookupStarted?.()
        await finalLookupReleased
        return snapshot
      }
      return null
    })

    const firstResultPromise = ingestExternalMaterial(
      candidate('asset-db-commit-after-query'),
    )
    await finalLookupStarted
    canonical = material('material-committed-after-query', {
      fingerprintKey,
      storage: {
        key: plannedKey,
        url: `https://r2.example/${plannedKey}`,
      },
    })
    releaseFinalLookup?.()
    const firstResult = await firstResultPromise
    const retryResult = await ingestExternalMaterial(
      candidate('asset-db-commit-after-query'),
    )

    expect(firstResult).toEqual({
      downloaded: expect.any(Boolean),
      kind: 'failed',
      retryable: true,
      category: 'canonical_write_failed',
    })
    expect(retryResult).toEqual({
      downloaded: expect.any(Boolean),
      kind: 'contentReused',
      materialId: 'material-committed-after-query',
    })
    expect(mockDeleteR2Object).not.toHaveBeenCalled()
    expect(mockUploadBufferToR2).toHaveBeenCalledTimes(1)
  })

  it('keeps the planned object when database reconciliation is unavailable', async () => {
    let createAttempted = false
    mockMaterialCreate.mockImplementation(async () => {
      createAttempted = true
      throw new Error('client-visible database write failure')
    })
    mockMaterialFindOne.mockImplementation(async () => {
      if (createAttempted) throw new Error('database still unavailable')
      return null
    })

    const result = await ingestExternalMaterial(
      candidate('asset-db-reconcile-unavailable'),
    )

    expect(result).toEqual({
      downloaded: expect.any(Boolean),
      kind: 'failed',
      retryable: true,
      category: 'canonical_reconciliation_failed',
    })
    expect(mockDeleteR2Object).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('database')
  })

  it('deletes only its planned key after reconciling a different canonical winner', async () => {
    const bytes = Buffer.from('shared-video-bytes')
    const plannedKey = plannedExternalKey('asset-other-winner', bytes)
    const winner = material('material-other-winner', {
      fingerprintKey: buildMaterialFingerprintKey(
        undefined,
        createHash('sha256').update(bytes).digest('hex'),
      ),
      storage: {
        key: 'global/external/guangdada/existing-winner.mp4',
        url: 'https://r2.example/global/external/guangdada/existing-winner.mp4',
      },
    })
    let createAttempted = false
    mockMaterialCreate.mockImplementation(async () => {
      createAttempted = true
      throw new Error('write result unknown')
    })
    mockMaterialFindOne.mockImplementation(async (query: any) => {
      if (query?._id && String(query._id) === 'material-other-winner') {
        return winner
      }
      if (!createAttempted) return null
      if (query?.['storage.key'] === plannedKey) return null
      if (query?.fingerprintKey) return winner
      return null
    })

    const result = await ingestExternalMaterial(candidate('asset-other-winner'))

    expect(result).toEqual({
      downloaded: expect.any(Boolean),
      kind: 'contentReused',
      materialId: 'material-other-winner',
    })
    expect(mockDeleteR2Object).toHaveBeenCalledTimes(1)
    expect(mockDeleteR2Object).toHaveBeenCalledWith(plannedKey)
    expect(mockDeleteR2Object).not.toHaveBeenCalledWith(winner.storage.key)
  })

  it('retries a failed loser cleanup before mapping to an active downloaded-content winner', async () => {
    const bytes = Buffer.from('shared-video-bytes')
    const plannedKey = plannedExternalKey('asset-cleanup-retry', bytes)
    const fingerprintKey = buildMaterialFingerprintKey(
      undefined,
      createHash('sha256').update(bytes).digest('hex'),
    )
    const winner = material('material-cleanup-retry-winner', {
      fingerprintKey,
      storage: {
        key: 'global/external/guangdada/existing-cleanup-winner',
        url: 'https://r2.example/global/external/guangdada/existing-cleanup-winner',
      },
    })
    let createAttempted = false
    mockMaterialCreate.mockImplementation(async () => {
      createAttempted = true
      throw duplicateKeyError()
    })
    mockMaterialFindOne.mockImplementation(async (query: any) => {
      if (query?._id && String(query._id) === 'material-cleanup-retry-winner') {
        return winner
      }
      if (query?.['storage.key'] === plannedKey) return null
      if (
        createAttempted &&
        query?.fingerprintKey === fingerprintKey &&
        Array.isArray(query?.status?.$in)
      ) {
        return winner
      }
      return null
    })
    mockDeleteR2Object
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: true })

    const first = await ingestExternalMaterial(candidate('asset-cleanup-retry'))
    const second = await ingestExternalMaterial(
      candidate('asset-cleanup-retry'),
    )

    expect(first).toEqual({
      downloaded: expect.any(Boolean),
      kind: 'failed',
      retryable: true,
      category: 'storage_cleanup_failed',
    })
    expect(second).toEqual({
      downloaded: expect.any(Boolean),
      kind: 'contentReused',
      materialId: 'material-cleanup-retry-winner',
    })
    expect(mockDeleteR2Object).toHaveBeenCalledTimes(3)
    expect(mockDeleteR2Object).toHaveBeenNthCalledWith(3, plannedKey)
    expect(mockUploadBufferToR2).toHaveBeenCalledTimes(1)
    expect(mockMaterialCreate).toHaveBeenCalledTimes(1)
  })

  it('does not delete a planned key referenced by another active material', async () => {
    const bytes = Buffer.from('shared-video-bytes')
    const plannedKey = plannedExternalKey('asset-referenced-key', bytes)
    const fingerprintKey = buildMaterialFingerprintKey(
      undefined,
      createHash('sha256').update(bytes).digest('hex'),
    )
    const winner = material('material-referenced-key-winner', {
      fingerprintKey,
      storage: {
        key: 'global/external/guangdada/other-winner-key',
        url: 'https://r2.example/global/external/guangdada/other-winner-key',
      },
    })
    const privateReference = material('material-private-key-reference', {
      organizationId: '665000000000000000000001',
      storage: {
        key: plannedKey,
        url: `https://r2.example/${plannedKey}`,
      },
    })
    mockMaterialFindOne.mockImplementation(async (query: any) => {
      if (
        query?._id &&
        String(query._id) === 'material-referenced-key-winner'
      ) {
        return winner
      }
      if (query?.['storage.key'] === plannedKey) return privateReference
      if (
        query?.fingerprintKey === fingerprintKey &&
        Array.isArray(query?.status?.$in)
      ) {
        return winner
      }
      return null
    })

    const result = await ingestExternalMaterial(
      candidate('asset-referenced-key'),
    )

    expect(result).toEqual({
      downloaded: expect.any(Boolean),
      kind: 'contentReused',
      materialId: 'material-referenced-key-winner',
    })
    expect(mockMaterialFindOne).toHaveBeenCalledWith({
      status: { $in: ['uploaded', 'ready'] },
      'storage.key': plannedKey,
    })
    expect(mockDeleteR2Object).not.toHaveBeenCalled()
    expect(mockUploadBufferToR2).not.toHaveBeenCalled()
  })

  it('reuses an existing global Facebook material when downloaded bytes match', async () => {
    const facebook = material('material-facebook', {
      source: { platform: 'facebook', isOriginal: true },
    })
    mockMaterialFindOne.mockImplementation(async (query: any) => {
      if (query?._id && String(query._id) === 'material-facebook') {
        return facebook
      }
      return query?.['fingerprint.sha256'] ? facebook : null
    })

    const result = await ingestExternalMaterial(
      candidate('asset-facebook-match'),
    )

    expect(result).toEqual({
      downloaded: expect.any(Boolean),
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
    let created: any = null
    mockMaterialCreate.mockImplementation(async (fields: any) => {
      created = material('material-created', fields)
      return created
    })
    mockMaterialFindOne.mockImplementation(async (query: any) => {
      if (query?._id && created && String(query._id) === String(created._id)) {
        return created
      }
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

    expect(result).toEqual({
      downloaded: expect.any(Boolean),
      kind: 'created',
      materialId: 'material-created',
    })
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
    let canonicalLookupCount = 0
    let releaseInitialLookups: (() => void) | undefined
    const initialLookupsComplete = new Promise<void>((resolve) => {
      releaseInitialLookups = resolve
    })
    let winner: any = null

    mockMaterialFindOne.mockImplementation(async (query: any) => {
      if (query?._id && winner && String(query._id) === String(winner._id)) {
        return winner
      }
      if (!query?.['fingerprint.sha256']) return null
      canonicalLookupCount += 1
      if (canonicalLookupCount <= 2) {
        if (canonicalLookupCount === 2) releaseInitialLookups?.()
        await initialLookupsComplete
        return null
      }
      return winner
    })
    mockUploadBufferToR2.mockImplementation(async (params: any) => {
      const key = params.key
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

  it('returns contentReused for the same-key loser when identical provider candidates race', async () => {
    const bytes = Buffer.from('shared-video-bytes')
    const fingerprintKey = buildMaterialFingerprintKey(
      undefined,
      createHash('sha256').update(bytes).digest('hex'),
    )
    let shaLookupCount = 0
    let releaseInitialShaLookups: (() => void) | undefined
    const initialShaLookupsComplete = new Promise<void>((resolve) => {
      releaseInitialShaLookups = resolve
    })
    let winner: any = null
    mockMaterialFindOne.mockImplementation(async (query: any) => {
      if (query?._id && winner && String(query._id) === String(winner._id)) {
        return winner
      }
      if (
        query?.fingerprintKey === fingerprintKey &&
        Array.isArray(query?.status?.$in)
      ) {
        return winner
      }
      if (!query?.['fingerprint.sha256']) return null
      shaLookupCount += 1
      if (shaLookupCount <= 2) {
        if (shaLookupCount === 2) releaseInitialShaLookups?.()
        await initialShaLookupsComplete
        return null
      }
      return winner
    })
    mockMaterialCreate.mockImplementation(async (fields: any) => {
      if (!winner) {
        winner = material('material-same-key-race-winner', fields)
        return winner
      }
      throw duplicateKeyError()
    })

    const outcomes = await Promise.all([
      ingestExternalMaterial(candidate('asset-same-key-race')),
      ingestExternalMaterial(candidate('asset-same-key-race')),
    ])

    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual([
      'contentReused',
      'created',
    ])
    expect(
      outcomes.every(
        (outcome: any) =>
          outcome.materialId === 'material-same-key-race-winner',
      ),
    ).toBe(true)
    expect(mockMaterialCreate).toHaveBeenCalledTimes(2)
    expect(mockDeleteR2Object).not.toHaveBeenCalled()
  })

  it('retries only loser cleanup and reports a redacted failure when cleanup stays broken', async () => {
    const winner = material('material-cleanup-winner')
    let activeExactLookups = 0
    mockMaterialCreate.mockRejectedValue(duplicateKeyError())
    mockMaterialFindOne.mockImplementation(async (query: any) => {
      if (query?.fingerprintKey && Array.isArray(query?.status?.$in)) {
        activeExactLookups += 1
        return activeExactLookups > 1 ? winner : null
      }
      return null
    })
    mockDeleteR2Object.mockResolvedValue({
      success: false,
      error: 'https://signed.example/object?secret=must-not-escape',
    })

    const result = await ingestExternalMaterial(
      candidate('asset-cleanup-failure'),
    )

    expect(result).toEqual({
      downloaded: expect.any(Boolean),
      kind: 'failed',
      retryable: true,
      category: 'storage_cleanup_failed',
    })
    expect(mockDeleteR2Object).toHaveBeenCalledTimes(2)
    expect(mockDeleteR2Object).toHaveBeenNthCalledWith(
      1,
      plannedExternalKey(
        'asset-cleanup-failure',
        Buffer.from('shared-video-bytes'),
      ),
    )
    expect(mockDeleteR2Object).toHaveBeenNthCalledWith(
      2,
      plannedExternalKey(
        'asset-cleanup-failure',
        Buffer.from('shared-video-bytes'),
      ),
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
      query?._id && String(query._id) === 'material-origin-race'
        ? facebook
        : query?.['fingerprint.sha256']
          ? facebook
          : null,
    )
    mockOriginFindOneAndUpdate
      .mockRejectedValueOnce(duplicateKeyError())
      .mockResolvedValueOnce({ materialId: facebook._id })

    const result = await ingestExternalMaterial(candidate('asset-origin-race'))

    expect(result).toEqual({
      downloaded: expect.any(Boolean),
      kind: 'contentReused',
      materialId: 'material-origin-race',
    })
    expect(mockOriginFindOneAndUpdate).toHaveBeenCalledTimes(2)
    expect(mockDownloadRemoteMedia).toHaveBeenCalledTimes(1)
    expect(mockUploadBufferToR2).not.toHaveBeenCalled()
  })

  it('keeps a newer origin observation when an older writer resumes later', async () => {
    jest.useFakeTimers()
    try {
      const oldBytes = Buffer.from('old-observation-bytes')
      const newBytes = Buffer.from('new-observation-bytes')
      const oldFingerprintKey = buildMaterialFingerprintKey(
        undefined,
        createHash('sha256').update(oldBytes).digest('hex'),
      )
      const newFingerprintKey = buildMaterialFingerprintKey(
        undefined,
        createHash('sha256').update(newBytes).digest('hex'),
      )
      const oldCanonical = material('material-old-observation')
      const newCanonical = material('material-new-observation')
      let storedMapping: any = null
      let releaseOldWriter: (() => void) | undefined
      let markOldWriterEntered: (() => void) | undefined
      const oldWriterEntered = new Promise<void>((resolve) => {
        markOldWriterEntered = resolve
      })
      const oldWriterReleased = new Promise<void>((resolve) => {
        releaseOldWriter = resolve
      })

      mockOriginFindOne.mockImplementation(async () => storedMapping)
      mockDownloadRemoteMedia.mockImplementation(async (url: string) => ({
        buffer: url.includes('/old-observation.mp4') ? oldBytes : newBytes,
        mimeType: 'video/mp4',
        filename: 'observation.mp4',
        host: 'cdn.example',
      }))
      mockMaterialFindOne.mockImplementation(async (query: any) => {
        if (query?._id) {
          const id = String(query._id)
          if (id === 'material-old-observation') return oldCanonical
          if (id === 'material-new-observation') return newCanonical
        }
        if (query?.fingerprintKey === oldFingerprintKey) return oldCanonical
        if (query?.fingerprintKey === newFingerprintKey) return newCanonical
        return null
      })
      mockOriginFindOneAndUpdate.mockImplementation(
        async (filter: any, update: any) => {
          const fields = update.$set
          if (fields.packageName === 'Old package') {
            markOldWriterEntered?.()
            await oldWriterReleased
          }
          if (
            storedMapping &&
            filter?.$or &&
            storedMapping.lastSeenAt > fields.lastSeenAt
          ) {
            throw duplicateKeyError()
          }
          storedMapping = {
            ...(storedMapping || update.$setOnInsert),
            ...fields,
          }
          return storedMapping
        },
      )

      jest.setSystemTime(new Date('2026-07-22T01:00:00.000Z'))
      const oldResultPromise = ingestExternalMaterial(
        candidate('asset-versioned-observation', {
          packageName: 'Old package',
          productName: 'Old product',
          heat: 10,
          mediaUrl: 'https://cdn.example/old-observation.mp4?secret=old',
        }),
      )
      await oldWriterEntered

      jest.setSystemTime(new Date('2026-07-22T02:00:00.000Z'))
      const newResult = await ingestExternalMaterial(
        candidate('asset-versioned-observation', {
          packageName: 'New package',
          productName: 'New product',
          heat: 99,
          mediaUrl: 'https://cdn.example/new-observation.mp4?secret=new',
        }),
      )
      releaseOldWriter?.()
      const oldResult = await oldResultPromise

      expect(newResult).toEqual({
        downloaded: expect.any(Boolean),
        kind: 'contentReused',
        materialId: 'material-new-observation',
      })
      expect(oldResult).toEqual({
        downloaded: expect.any(Boolean),
        kind: 'contentReused',
        materialId: 'material-new-observation',
      })
      expect(storedMapping).toEqual(
        expect.objectContaining({
          materialId: newCanonical._id,
          packageName: 'New package',
          productName: 'New product',
          heat: 99,
          lastMediaUrl: 'https://cdn.example/new-observation.mp4',
          lastSeenAt: new Date('2026-07-22T02:00:00.000Z'),
        }),
      )
      expect(mockUploadBufferToR2).not.toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
  })

  it('retries the full newer observation after its insert loses to an older origin row', async () => {
    jest.useFakeTimers()
    try {
      const attempted = material('material-newer-origin-observation')
      const older = material('material-older-origin-observation')
      const observedAt = new Date('2026-07-22T04:00:00.000Z')
      let storedMapping: any = {
        provider: 'guangdada',
        providerAssetKey: 'asset-newer-origin-insert-race',
        materialId: older._id,
        packageName: 'Older package',
        productName: 'Older product',
        heat: 1,
        lastMediaUrl: 'https://cdn.example/older.mp4',
        lastSeenAt: new Date('2026-07-22T03:00:00.000Z'),
      }
      let writeAttempts = 0
      mockOriginFindOne
        .mockResolvedValueOnce(null)
        .mockImplementation(async () => storedMapping)
      mockOriginFindOneAndUpdate.mockImplementation(
        async (_filter: any, update: any) => {
          writeAttempts += 1
          if (writeAttempts === 1) throw duplicateKeyError()
          storedMapping = { ...storedMapping, ...update.$set }
          return storedMapping
        },
      )
      mockMaterialFindOne.mockImplementation(async (query: any) => {
        if (query?._id) {
          if (String(query._id) === String(attempted._id)) return attempted
          if (String(query._id) === String(older._id)) return older
        }
        if (query?.fingerprintKey && Array.isArray(query?.status?.$in)) {
          return attempted
        }
        return null
      })

      jest.setSystemTime(observedAt)
      const result = await ingestExternalMaterial(
        candidate('asset-newer-origin-insert-race', {
          packageName: 'Newer package',
          productName: 'Newer product',
          heat: 99,
          mediaUrl: 'https://cdn.example/newer.mp4?secret=newer',
        }),
      )

      expect(result).toEqual({
        downloaded: expect.any(Boolean),
        kind: 'contentReused',
        materialId: 'material-newer-origin-observation',
      })
      expect(writeAttempts).toBe(2)
      expect(storedMapping).toEqual(
        expect.objectContaining({
          materialId: attempted._id,
          packageName: 'Newer package',
          productName: 'Newer product',
          heat: 99,
          lastMediaUrl: 'https://cdn.example/newer.mp4',
          lastSeenAt: observedAt,
        }),
      )
    } finally {
      jest.useRealTimers()
    }
  })

  it('returns a retryable failure when the mapped material is deleted immediately after the origin write', async () => {
    const canonical = material('material-deleted-after-origin-write')
    mockMaterialFindOne.mockImplementation(async (query: any) => {
      if (query?.fingerprintKey) return canonical
      if (query?._id) return null
      return null
    })
    mockOriginFindOneAndUpdate.mockImplementation(
      async (_filter: any, update: any) => ({
        provider: 'guangdada',
        providerAssetKey: 'asset-deleted-after-origin-write',
        ...update.$set,
      }),
    )

    const result = await ingestExternalMaterial(
      candidate('asset-deleted-after-origin-write'),
    )

    expect(result).toEqual({
      downloaded: expect.any(Boolean),
      kind: 'failed',
      retryable: true,
      category: 'origin_mapping_stale',
    })
    expect(mockUploadBufferToR2).not.toHaveBeenCalled()
  })

  it('rereads the winning origin mapping after a unique upsert race', async () => {
    jest.useFakeTimers()
    try {
      const attempted = material('material-origin-attempt')
      const winner = material('material-origin-winner')
      const winningMapping = {
        provider: 'guangdada',
        providerAssetKey: 'asset-origin-unique-race',
        materialId: winner._id,
        packageName: 'Winning package',
        lastSeenAt: new Date('2026-07-22T03:00:00.000Z'),
      }
      mockOriginFindOne
        .mockResolvedValueOnce(null)
        .mockResolvedValue(winningMapping)
      mockOriginFindOneAndUpdate.mockRejectedValue(duplicateKeyError())
      mockMaterialFindOne.mockImplementation(async (query: any) => {
        if (query?._id && String(query._id) === 'material-origin-winner') {
          return winner
        }
        if (query?.fingerprintKey) return attempted
        return null
      })

      jest.setSystemTime(new Date('2026-07-22T02:00:00.000Z'))
      const result = await ingestExternalMaterial(
        candidate('asset-origin-unique-race'),
      )

      expect(result).toEqual({
        downloaded: expect.any(Boolean),
        kind: 'contentReused',
        materialId: 'material-origin-winner',
      })
      expect(mockOriginFindOneAndUpdate).toHaveBeenCalledTimes(1)
      expect(mockDownloadRemoteMedia).toHaveBeenCalledTimes(1)
      expect(mockUploadBufferToR2).not.toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
  })

  it('retries only the mapping after creating a canonical material', async () => {
    mockOriginFindOneAndUpdate
      .mockRejectedValueOnce(new Error('temporary database detail'))
      .mockRejectedValueOnce(new Error('temporary database detail'))
      .mockResolvedValueOnce({
        materialId: { toString: () => 'material-created' },
      })

    const result = await ingestExternalMaterial(
      candidate('asset-mapping-retry'),
    )

    expect(result).toEqual({
      downloaded: expect.any(Boolean),
      kind: 'created',
      materialId: 'material-created',
    })
    expect(mockOriginFindOneAndUpdate).toHaveBeenCalledTimes(3)
    expect(mockDownloadRemoteMedia).toHaveBeenCalledTimes(1)
    expect(mockUploadBufferToR2).toHaveBeenCalledTimes(1)
    expect(mockMaterialCreate).toHaveBeenCalledTimes(1)
    expect(mockDeleteR2Object).not.toHaveBeenCalled()
  })

  it('keeps a canonical object after mapping failure and reuses it on the next call', async () => {
    let canonical: any = null
    mockMaterialFindOne.mockImplementation(async (query: any) => {
      if (
        query?._id &&
        canonical &&
        String(query._id) === String(canonical._id)
      ) {
        return canonical
      }
      if (query?.['fingerprint.sha256']) return canonical
      return null
    })
    mockMaterialCreate.mockImplementation(async (fields: any) => {
      canonical = material('material-mapping-failure', fields)
      return canonical
    })
    mockOriginFindOneAndUpdate
      .mockRejectedValueOnce(new Error('db unavailable with signed URL'))
      .mockRejectedValueOnce(new Error('db unavailable with signed URL'))
      .mockRejectedValueOnce(new Error('db unavailable with signed URL'))
      .mockResolvedValueOnce({
        materialId: { toString: () => 'material-mapping-failure' },
      })

    const first = await ingestExternalMaterial(
      candidate('asset-mapping-failure'),
    )
    const second = await ingestExternalMaterial(
      candidate('asset-mapping-failure'),
    )

    expect(first).toEqual({
      downloaded: expect.any(Boolean),
      kind: 'failed',
      retryable: true,
      category: 'origin_mapping_failed',
    })
    expect(second).toEqual({
      downloaded: expect.any(Boolean),
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
        if (idLookupCount === 1) return initiallyActive
        if (
          mockDownloadRemoteMedia.mock.calls.length &&
          String(query._id) === String(replacement._id)
        ) {
          return replacement
        }
        return null
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
      downloaded: expect.any(Boolean),
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
      {
        kind: 'invalid',
        reason: 'invalid_candidate',
        downloaded: false,
      },
      {
        kind: 'failed',
        retryable: true,
        category: 'download_network',
        downloaded: false,
      },
      {
        kind: 'created',
        materialId: 'material-created',
        downloaded: true,
      },
    ])
    expect(mockDownloadRemoteMedia).toHaveBeenCalledTimes(2)
    expect(mockUploadBufferToR2).toHaveBeenCalledTimes(1)
    expect(mockMaterialCreate).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(results)).not.toContain('signed provider URL')
    expect(JSON.stringify(results)).not.toContain('private-asset')
  })
})
