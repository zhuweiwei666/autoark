import {
  detectDevicePlatform,
  mergeForwardedQuery,
  pickWeightedDestination,
} from '../src/services/productLinkRouting.service'

const destinations = [
  {
    _id: 'ios-a',
    name: 'iOS A',
    platform: 'ios' as const,
    url: 'https://apps.apple.com/app/a?source=pool',
    weight: 6,
    enabled: true,
  },
  {
    _id: 'ios-b',
    name: 'iOS B',
    platform: 'ios' as const,
    url: 'https://apps.apple.com/app/b',
    weight: 3,
    enabled: true,
  },
  {
    _id: 'ios-c',
    name: 'iOS C',
    platform: 'ios' as const,
    url: 'https://apps.apple.com/app/c',
    weight: 1,
    enabled: true,
  },
]

describe('product link routing', () => {
  it.each([
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      undefined,
      'ios',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit Mobile/15E148',
      undefined,
      'ios',
    ],
    ['Mozilla/5.0 (Linux; Android 15; Pixel 9)', undefined, 'android'],
    ['Mozilla/5.0 (X11; Linux x86_64)', '"Android"', 'android'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', undefined, 'unknown'],
  ])('detects %s as %s', (userAgent, clientPlatform, expected) => {
    expect(detectDevicePlatform(userAgent, clientPlatform)).toBe(expected)
  })

  it('distributes a full cycle using configured weights instead of equal or random traffic', () => {
    const selected = Array.from(
      { length: 10 },
      (_, cursor) => pickWeightedDestination(destinations, cursor)?._id,
    )

    expect(selected.filter((id) => id === 'ios-a')).toHaveLength(6)
    expect(selected.filter((id) => id === 'ios-b')).toHaveLength(3)
    expect(selected.filter((id) => id === 'ios-c')).toHaveLength(1)
    expect(selected.slice(0, 6)).not.toEqual(Array(6).fill('ios-a'))
  })

  it('ignores disabled and zero-weight links', () => {
    const selected = pickWeightedDestination(
      [
        ...destinations,
        {
          _id: 'disabled',
          name: 'Disabled',
          platform: 'ios',
          url: 'https://apps.apple.com/app/disabled',
          weight: 100,
          enabled: false,
        },
        {
          _id: 'zero',
          name: 'Zero',
          platform: 'ios',
          url: 'https://apps.apple.com/app/zero',
          weight: 0,
          enabled: true,
        },
      ],
      3,
    )

    expect(selected?._id).not.toBe('disabled')
    expect(selected?._id).not.toBe('zero')
  })

  it('preserves the destination query and forwards incoming campaign parameters', () => {
    expect(
      mergeForwardedQuery('https://apps.apple.com/app/a?source=pool', {
        fbclid: 'fb-click-1',
        campaign: 'summer',
        tags: ['one', 'two'],
        unsafe: { $ne: 'ignored' },
      }),
    ).toBe(
      'https://apps.apple.com/app/a?source=pool&fbclid=fb-click-1&campaign=summer&tags=one&tags=two',
    )
  })
})
