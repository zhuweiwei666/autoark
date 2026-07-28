import ProductLinkPool from '../src/models/ProductLinkPool'

describe('ProductLinkPool model', () => {
  it('accepts platform-specific weighted app links', () => {
    const pool = new ProductLinkPool({
      name: 'Creative Studio',
      shortCode: 'aB3kP9xQ',
      fallbackUrl: 'https://example.com/download',
      destinations: [
        {
          name: 'Studio iOS',
          platform: 'ios',
          url: 'https://apps.apple.com/app/studio',
          weight: 70,
        },
        {
          name: 'Studio Android',
          platform: 'android',
          url: 'https://play.google.com/store/apps/details?id=studio',
          weight: 30,
        },
      ],
    })

    expect(pool.validateSync()).toBeUndefined()
    expect(pool.destinations[0].enabled).toBe(true)
  })

  it.each([
    ['unsupported protocol', 'javascript:alert(1)', 10],
    ['negative weight', 'https://apps.apple.com/app/studio', -1],
    ['oversized weight', 'https://apps.apple.com/app/studio', 1001],
  ])('rejects %s', (_label, url, weight) => {
    const pool = new ProductLinkPool({
      name: 'Creative Studio',
      shortCode: 'aB3kP9xQ',
      destinations: [{ name: 'Studio', platform: 'ios', url, weight }],
    })

    expect(pool.validateSync()).toBeDefined()
  })
})
