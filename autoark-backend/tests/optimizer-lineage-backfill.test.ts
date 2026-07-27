import mongoose from 'mongoose'
import {
  buildAccountLineage,
  buildLineageOperation,
} from '../src/scripts/backfillOptimizerLineage'

describe('optimizer lineage backfill', () => {
  it('deduplicates identical account ownership and builds an idempotent update', () => {
    const organizationId = new mongoose.Types.ObjectId()
    const tokenId = new mongoose.Types.ObjectId()
    const lineage = buildAccountLineage([
      {
        accountId: 'act_123',
        operator: 'buyer-a',
        organizationId,
        tokenId,
      },
      {
        accountId: 'act_123',
        operator: 'buyer-a',
        organizationId,
        tokenId,
      },
    ])

    expect(lineage).toHaveLength(1)
    expect(buildLineageOperation(lineage[0])).toEqual({
      updateMany: {
        filter: { accountId: 'act_123' },
        update: [
          {
            $set: {
              optimizer: { $literal: 'buyer-a' },
              channel: { $literal: 'facebook' },
              organizationId: { $literal: organizationId },
              tokenId: { $literal: tokenId },
              sourceSyncedAt: {
                $ifNull: [
                  '$sourceSyncedAt',
                  { $ifNull: ['$updatedAt', '$createdAt'] },
                ],
              },
            },
          },
        ],
      },
    })
  })

  it('fails closed when one account resolves to conflicting ownership', () => {
    expect(() =>
      buildAccountLineage([
        { accountId: 'act_123', operator: 'buyer-a' },
        { accountId: 'act_123', operator: 'buyer-b' },
      ]),
    ).toThrow('冲突')
  })
})
