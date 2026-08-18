import {
  buildLegacyCoverageOperation,
  buildLegacyFactOperation,
} from '../src/scripts/backfillMetaInsightsPersistence'

describe('Meta insights persistence baseline backfill', () => {
  const now = new Date('2026-08-18T04:00:00.000Z')

  it('inserts legacy campaign totals at an explicit ALL-country grain', () => {
    const operation = buildLegacyFactOperation(
      {
        date: '2026-08-10',
        accountId: 'act_101',
        accountName: 'Account 101',
        campaignId: 'cmp-1',
        campaignName: 'alice_campaign',
        optimizer: 'alice',
        spend: 12.345,
        revenue: 24.685,
        impressions: 1000,
        clicks: 50,
        installs: 4,
        updatedAt: new Date('2026-08-10T20:00:00.000Z'),
      },
      now,
    )

    expect(operation.updateOne.filter).toEqual({
      provider: 'facebook',
      date: '2026-08-10',
      accountId: '101',
      campaignId: 'cmp-1',
      country: 'ALL',
    })
    expect(operation.updateOne.update.$setOnInsert).toMatchObject({
      spend: 12.35,
      revenue: 24.69,
      sourceApiVersion: 'legacy-aggregate-v1',
    })
  })

  it('freezes only fresh mature coverage and never overwrites existing ledger rows', () => {
    const operation = buildLegacyCoverageOperation(
      {
        date: '2026-08-10',
        accountId: 'act_101',
        dataStatus: 'fresh',
        lastSyncedAt: new Date('2026-08-10T20:00:00.000Z'),
      },
      3,
      now,
    )

    expect(operation.updateOne.filter).toEqual({
      provider: 'facebook',
      date: '2026-08-10',
      accountId: '101',
    })
    expect(operation.updateOne.update).toEqual({
      $setOnInsert: expect.objectContaining({
        status: 'fresh',
        hasSnapshot: true,
        factRows: 3,
        frozenAt: now,
      }),
    })
    expect(operation.updateOne.upsert).toBe(true)
  })
})
