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
    expect(first.providerAssetKey).toBe('video:native-video-1')
    expect(first.providerAssetKey).not.toContain('cdn.example')
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
