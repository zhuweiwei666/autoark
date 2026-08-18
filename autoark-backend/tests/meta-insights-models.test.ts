import MetaInsightsCoverage from '../src/models/MetaInsightsCoverage'
import MetaInsightsFact from '../src/models/MetaInsightsFact'

describe('permanent Meta insights models', () => {
  it('uses unique account-day fact and coverage keys without TTL indexes', () => {
    const factIndexes = MetaInsightsFact.schema.indexes()
    const coverageIndexes = MetaInsightsCoverage.schema.indexes()

    expect(factIndexes).toEqual(
      expect.arrayContaining([
        [
          { provider: 1, date: 1, accountId: 1, campaignId: 1, country: 1 },
          expect.objectContaining({ unique: true }),
        ],
      ]),
    )
    expect(coverageIndexes).toEqual(
      expect.arrayContaining([
        [
          { provider: 1, date: 1, accountId: 1 },
          expect.objectContaining({ unique: true }),
        ],
      ]),
    )
    expect(
      [...factIndexes, ...coverageIndexes].some(([, options]) =>
        Object.prototype.hasOwnProperty.call(options, 'expireAfterSeconds'),
      ),
    ).toBe(false)
  })
})
