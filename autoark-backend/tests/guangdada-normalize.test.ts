import MaterialOriginMapping from '../src/models/MaterialOriginMapping'
import {
  normalizeGuangdadaAds,
  normalizeHttpsMediaUrl,
} from '../src/integration/guangdada/normalize'

describe('Guangdada normalization', () => {
  it('extracts videos and compatible images while rejecting non-web media URLs', () => {
    const normalized = normalizeGuangdadaAds([{
      id: 'record-1',
      package_name: 'Example Game',
      videos: [
        { id: 'video-1', url: 'https://cdn.example/video.mp4', role: 'primary' },
        { id: 'video-http', url: 'http://cdn.example/insecure.mp4' },
        'ftp://cdn.example/private.mp4',
      ],
      images: [
        { image_id: 'image-1', image_url: 'https://cdn.example/image.jpg' },
        { url: 'javascript:alert(1)' },
      ],
    }])

    expect(normalized).toHaveLength(2)
    expect(normalized).toEqual(expect.arrayContaining([
      expect.objectContaining({
        mediaType: 'video',
        mediaRole: 'primary',
        mediaIndex: 0,
        mediaUrl: 'https://cdn.example/video.mp4',
      }),
      expect.objectContaining({
        mediaType: 'image',
        mediaIndex: 0,
        mediaUrl: 'https://cdn.example/image.jpg',
      }),
    ]))
  })

  it('ignores malformed media entries and does not turn missing metrics into zeroes', () => {
    const normalized = normalizeGuangdadaAds([{
      id: 'record-1',
      package_name: 'Example Game',
      heat: null,
      estimated_value: '',
      videos: [
        null,
        42,
        { id: 'video-1', url: 'https://cdn.example/video.mp4' },
      ],
    } as any])

    expect(normalized).toHaveLength(1)
    expect(normalized[0]).not.toHaveProperty('heat')
    expect(normalized[0]).not.toHaveProperty('estimatedValue')
  })

  it('normalizes HTTPS identity consistently', () => {
    expect(normalizeHttpsMediaUrl('HTTPS://CDN.Example:443/a.mp4?b=2&a=1#preview')).toBe(
      'https://cdn.example/a.mp4?a=1&b=2',
    )
    expect(normalizeHttpsMediaUrl('http://cdn.example/a.mp4')).toBeUndefined()
    expect(normalizeHttpsMediaUrl('file:///tmp/private.mp4')).toBeUndefined()
    expect(normalizeHttpsMediaUrl('not a url')).toBeUndefined()
  })

  it('keeps provider asset identity stable when a native media ID is present', () => {
    const first = normalizeGuangdadaAds([{
      id: 'record-1',
      package_name: 'Example Game',
      videos: [{ id: 'native-video-1', url: 'https://cdn.example/old.mp4' }],
    }])[0]
    const refreshed = normalizeGuangdadaAds([{
      id: 'record-1',
      package_name: 'Example Game',
      videos: [{ id: 'native-video-1', url: 'https://cdn.example/new.mp4' }],
    }])[0]

    expect(first.providerAssetKey).toBe(refreshed.providerAssetKey)
    expect(first.providerAssetKey).not.toContain('cdn.example')
  })

  it('scopes the same native media ID by record identity', () => {
    const [first, second] = normalizeGuangdadaAds([
      {
        id: 'record-1',
        package_name: 'Package One',
        videos: [{ id: 'shared-video', url: 'https://cdn.example/one.mp4' }],
      },
      {
        id: 'record-2',
        package_name: 'Package Two',
        videos: [{ id: 'shared-video', url: 'https://cdn.example/two.mp4' }],
      },
    ])

    expect(first.providerAssetKey).not.toBe(second.providerAssetKey)
  })

  it('hashes record identity, media position, and URL when no native media ID exists', () => {
    const normalized = normalizeGuangdadaAds([{
      ad_id: 'native-record-1',
      package_name: 'Example Game',
      videos: [
        { url: 'https://cdn.example/one.mp4' },
        { url: 'https://cdn.example/two.mp4' },
      ],
    }])
    const refreshed = normalizeGuangdadaAds([{
      ad_id: 'native-record-1',
      package_name: 'Example Game',
      videos: [
        { url: 'https://new-cdn.example/one.mp4' },
        { url: 'https://new-cdn.example/two.mp4' },
      ],
    }])

    expect(normalized.map((asset) => asset.providerAssetKey)).not.toEqual(
      refreshed.map((asset) => asset.providerAssetKey),
    )
    expect(normalized.every((asset) => /^sha256:[a-f0-9]{64}$/.test(asset.providerAssetKey))).toBe(true)
    expect(new Set(normalized.map((asset) => asset.providerAssetKey)).size).toBe(2)
  })

  it('hashes fallback identity from record context, media position, and normalized URL', () => {
    const first = normalizeGuangdadaAds([{
      package_name: 'Example Game',
      advertiser_name: 'Example Studio',
      videos: [{ url: 'HTTPS://CDN.example/video.mp4?b=2&a=1' }],
    }])[0]
    const equivalent = normalizeGuangdadaAds([{
      package_name: 'Example Game',
      advertiser_name: 'Example Studio',
      videos: [{ url: 'https://cdn.example/video.mp4?a=1&b=2' }],
    }])[0]

    expect(first.providerAssetKey).toBe(equivalent.providerAssetKey)
    expect(first.providerAssetKey).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it('keeps package labels separate from opaque stable package keys', () => {
    const [first, second, third] = normalizeGuangdadaAds([
      {
        id: 'record-a',
        package_name: '  Example Game  ',
        product_name: 'Example Product',
        advertiser_name: 'Example Studio',
        videos: [{ id: 'video-a', url: 'https://cdn.example/a.mp4' }],
      },
      {
        id: 'record-b',
        package_name: 'example game',
        videos: [{ id: 'video-b', url: 'https://cdn.example/b.mp4' }],
      },
      {
        id: 'record-c',
        package_name: 'Different Game',
        videos: [{ id: 'video-c', url: 'https://cdn.example/c.mp4' }],
      },
    ])

    expect(first).toMatchObject({
      packageName: 'Example Game',
      productName: 'Example Product',
      advertiserName: 'Example Studio',
    })
    expect(first.packageKey).toBe(second.packageKey)
    expect(first.packageKey).not.toContain('Example Game')
    expect(first.packageKey).toMatch(/^pkg_[a-f0-9]{64}$/)
    expect(third.packageKey).not.toBe(first.packageKey)
  })

  it('sorts estimated value first and heat second', () => {
    const normalized = normalizeGuangdadaAds([
      {
        id: 'low-value',
        package_name: 'Package',
        estimated_value: 10,
        heat: 100,
        videos: [{ id: 'low-value-video', url: 'https://cdn.example/low.mp4' }],
      },
      {
        id: 'high-low-heat',
        package_name: 'Package',
        estimated_value: '20',
        heat: '5',
        videos: [{ id: 'high-low-video', url: 'https://cdn.example/high-low.mp4' }],
      },
      {
        id: 'high-high-heat',
        package_name: 'Package',
        estimated_value: 20,
        heat: 8,
        videos: [{ id: 'high-high-video', url: 'https://cdn.example/high-high.mp4' }],
      },
    ])

    expect(normalized.map((asset) => asset.recordId)).toEqual([
      'high-high-heat',
      'high-low-heat',
      'low-value',
    ])
  })

  it('rejects invalid metrics and preserves input order for the resulting full tie', () => {
    const invalidMetrics = [true, [9], {}, Number.NaN, Number.POSITIVE_INFINITY, -1, '-2']
    const normalized = normalizeGuangdadaAds(invalidMetrics.map((value, index) => ({
      id: `record-${index}`,
      package_name: 'Package',
      heat: value,
      estimated_value: value,
      videos: [{ id: `video-${index}`, url: `https://cdn.example/${index}.mp4` }],
    })) as any)

    expect(normalized.map((asset) => asset.recordId)).toEqual(
      invalidMetrics.map((_, index) => `record-${index}`),
    )
    expect(normalized.every((asset) => !Object.hasOwn(asset, 'heat'))).toBe(true)
    expect(normalized.every((asset) => !Object.hasOwn(asset, 'estimatedValue'))).toBe(true)
  })

  it('preserves input order when estimated value and heat are fully tied', () => {
    const normalized = normalizeGuangdadaAds(['first', 'second', 'third'].map((id) => ({
      id,
      package_name: 'Package',
      heat: 10,
      estimated_value: 20,
      videos: [{ id: `${id}-video`, url: `https://cdn.example/${id}.mp4` }],
    })))

    expect(normalized.map((asset) => asset.recordId)).toEqual(['first', 'second', 'third'])
  })

  it('preserves the validated signed media URL while canonicalizing only its identity copy', () => {
    const originalUrl = 'https://CDN.example/video%2Fclip.mp4?z=last&signature=a%2Bb&first=one%20two'
    const reorderedUrl = 'https://cdn.example/video%2Fclip.mp4?first=one%20two&signature=a%2Bb&z=last'
    const first = normalizeGuangdadaAds([{
      id: 'signed-record',
      package_name: 'Package',
      videos: [{ url: originalUrl }],
    }])[0]
    const equivalent = normalizeGuangdadaAds([{
      id: 'signed-record',
      package_name: 'Package',
      videos: [{ url: reorderedUrl }],
    }])[0]

    expect(first.mediaUrl).toBe(originalUrl)
    expect(equivalent.mediaUrl).toBe(reorderedUrl)
    expect(first.providerAssetKey).toBe(equivalent.providerAssetKey)
  })

  it('keeps URL fallback identity stable across signed-query rotation while distinguishing paths', () => {
    const [first, rotated, differentPath] = [
      {
        mediaUrl:
          'https://cdn.example/assets/video.mp4?signature=first&expires=100',
        pageUrl: 'https://provider.example/ad/record?signature=first',
      },
      {
        mediaUrl:
          'https://cdn.example/assets/video.mp4?signature=second&expires=200',
        pageUrl: 'https://provider.example/ad/record?signature=second',
      },
      {
        mediaUrl:
          'https://cdn.example/assets/other.mp4?signature=first&expires=100',
        pageUrl: 'https://provider.example/ad/record?signature=third',
      },
    ].map(({ mediaUrl, pageUrl }) =>
      normalizeGuangdadaAds([
        {
          package_name: 'Package',
          source_page_url: pageUrl,
          videos: [{ url: mediaUrl }],
        },
      ])[0],
    )

    expect(first.providerAssetKey).toBe(rotated.providerAssetKey)
    expect(first.providerAssetKey).not.toBe(differentPath.providerAssetKey)
  })

  it('keeps unlabeled package grouping stable across signed-query rotation while distinguishing paths', () => {
    const [first, rotated, differentPath] = [
      'https://cdn.example/assets/video.mp4?signature=first&expires=100',
      'https://cdn.example/assets/video.mp4?signature=second&expires=200',
      'https://cdn.example/assets/other.mp4?signature=first&expires=100',
    ].map((url) =>
      normalizeGuangdadaAds([
        {
          videos: [{ url }],
        },
      ])[0],
    )

    expect(first.packageKey).toBe(rotated.packageKey)
    expect(first.packageKey).not.toBe(differentPath.packageKey)
  })

  it('distinguishes fallback provider identity by record, type, index, and path', () => {
    const baseline = normalizeGuangdadaAds([
      {
        id: 'record-a',
        videos: [{ url: 'https://cdn.example/assets/media.bin?signature=a' }],
      },
    ])[0]
    const differentRecord = normalizeGuangdadaAds([
      {
        id: 'record-b',
        videos: [{ url: 'https://cdn.example/assets/media.bin?signature=b' }],
      },
    ])[0]
    const differentType = normalizeGuangdadaAds([
      {
        id: 'record-a',
        images: [{ url: 'https://cdn.example/assets/media.bin?signature=c' }],
      },
    ])[0]
    const differentIndex = normalizeGuangdadaAds([
      {
        id: 'record-a',
        videos: [
          { url: 'https://cdn.example/assets/media.bin?signature=d' },
          { url: 'https://cdn.example/assets/media.bin?signature=e' },
        ],
      },
    ])[1]
    const differentPath = normalizeGuangdadaAds([
      {
        id: 'record-a',
        videos: [{ url: 'https://cdn.example/assets/other.bin?signature=f' }],
      },
    ])[0]

    expect(
      new Set([
        baseline.providerAssetKey,
        differentRecord.providerAssetKey,
        differentType.providerAssetKey,
        differentIndex.providerAssetKey,
        differentPath.providerAssetKey,
      ]).size,
    ).toBe(5)
  })
})

describe('MaterialOriginMapping model', () => {
  it('stores only the bounded origin fields with the required indexes', () => {
    const schema = MaterialOriginMapping.schema
    const applicationPaths = Object.keys(schema.paths).filter((path) => !['_id', '__v'].includes(path))

    expect(applicationPaths.sort()).toEqual([
      'advertiserName',
      'estimatedValue',
      'firstSeenAt',
      'heat',
      'lastMediaUrl',
      'lastSeenAt',
      'materialId',
      'mediaIndex',
      'mediaRole',
      'mediaType',
      'packageKey',
      'packageName',
      'productName',
      'provider',
      'providerAssetKey',
      'sourcePageUrl',
    ].sort())
    expect(schema.path('provider').options).toMatchObject({
      required: true,
      default: 'guangdada',
      enum: ['guangdada'],
    })
    expect(schema.path('mediaType').options.enum).toEqual(['image', 'video'])

    const indexes = schema.indexes()
    expect(indexes).toContainEqual([
      { provider: 1, providerAssetKey: 1 },
      expect.objectContaining({ unique: true }),
    ])
    expect(indexes).toContainEqual([
      { provider: 1, packageKey: 1, lastSeenAt: -1 },
      expect.any(Object),
    ])
    expect(indexes).toContainEqual([
      { materialId: 1, provider: 1 },
      expect.any(Object),
    ])
  })
})
