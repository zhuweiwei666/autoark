import ProductLinkPool from '../src/models/ProductLinkPool'

describe('ProductLinkPool model', () => {
  it('accepts platform-specific weighted app links', () => {
    const pool = new ProductLinkPool({
      name: 'Creative Studio',
      shortCode: 'aB3kP9xQ',
      shortLinkDomain: 'go.remixhub.app',
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
    expect(pool.shortLinkDomain).toBe('go.remixhub.app')
    expect(pool.destinations[0].enabled).toBe(true)
  })

  it('defaults product pools to the recommended Cloudflare domain', () => {
    const pool = new ProductLinkPool({
      name: 'Legacy Pool',
      shortCode: 'legacy01',
    })

    expect(pool.validateSync()).toBeUndefined()
    expect(pool.shortLinkDomain).toBe('go.remixhub.app')
  })

  it('rejects a short-link domain outside the verified allowlist', () => {
    const pool = new ProductLinkPool({
      name: 'Unsafe Pool',
      shortCode: 'unsafe01',
      shortLinkDomain: 'evil.example',
    })

    expect(pool.validateSync()).toBeDefined()
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
