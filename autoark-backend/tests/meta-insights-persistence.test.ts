const mockFactBulkWrite = jest.fn()
const mockCoverageBulkWrite = jest.fn()
const mockCoverageFind = jest.fn()
const mockCoverageUpdateMany = jest.fn()

jest.mock('../src/models/MetaInsightsFact', () => ({
  __esModule: true,
  default: {
    bulkWrite: (...args: any[]) => mockFactBulkWrite(...args),
  },
}))

jest.mock('../src/models/MetaInsightsCoverage', () => ({
  __esModule: true,
  default: {
    bulkWrite: (...args: any[]) => mockCoverageBulkWrite(...args),
    find: (...args: any[]) => mockCoverageFind(...args),
    updateMany: (...args: any[]) => mockCoverageUpdateMany(...args),
  },
}))

import {
  beginMetaInsightsCoverageAttempts,
  buildMetaInsightsFactSnapshot,
  persistMetaInsightsCoverageOutcomes,
  persistMetaInsightsFactSnapshots,
} from '../src/services/metaInsightsPersistence.service'

describe('permanent Meta insights persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFactBulkWrite.mockResolvedValue({})
    mockCoverageBulkWrite.mockResolvedValue({})
    mockCoverageUpdateMany.mockResolvedValue({})
  })

  it('durably marks every selected account-day before calling Meta', async () => {
    const attemptedAt = new Date('2026-08-18T04:00:00.000Z')

    await beginMetaInsightsCoverageAttempts(
      '2026-08-18',
      ['act_101', '101', '102'],
      attemptedAt,
    )

    expect(mockCoverageUpdateMany).toHaveBeenCalledTimes(2)
    expect(mockCoverageUpdateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ hasSnapshot: true }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'stale',
          lastAttemptAt: attemptedAt,
        }),
        $inc: { attemptCount: 1 },
      }),
    )
    const operations = mockCoverageBulkWrite.mock.calls[0][0]
    expect(operations).toHaveLength(2)
    expect(operations[0].updateOne.update.$setOnInsert).toMatchObject({
      accountId: '101',
      status: 'unavailable',
      hasSnapshot: false,
      attemptCount: 1,
    })
  })

  it('normalizes duplicate campaign-country rows without retaining raw payloads', () => {
    const snapshot = buildMetaInsightsFactSnapshot({
      date: '2026-08-18',
      accountId: 'act_101',
      accountName: 'Account 101',
      campaignNameMap: new Map([['cmp-1', 'alice_product_web']]),
      authorization: {
        authorizationType: 'system_user',
        metaCredentialId: 'credential-1',
      },
      fetchedAt: new Date('2026-08-18T04:00:00.000Z'),
      insights: [
        {
          campaign_id: 'cmp-1',
          country: 'us',
          spend: '1.23',
          impressions: '100',
          clicks: '10',
          actions: [{ action_type: 'mobile_app_install', value: '2' }],
          action_values: [{ action_type: 'purchase', value: '4.56' }],
          raw_secret: 'must-not-be-stored',
        },
        {
          campaign_id: 'cmp-1',
          country: 'US',
          spend: '2.34',
          impressions: '200',
          clicks: '20',
          actions: [{ action_type: 'mobile_app_install', value: '3' }],
          action_values: [{ action_type: 'purchase', value: '5.67' }],
        },
      ],
    })

    expect(snapshot.accountId).toBe('101')
    expect(snapshot.rows).toHaveLength(1)
    expect(snapshot.rows[0]).toMatchObject({
      date: '2026-08-18',
      accountId: '101',
      campaignId: 'cmp-1',
      campaignName: 'alice_product_web',
      optimizer: 'alice',
      country: 'US',
      spend: 3.57,
      revenue: 10.23,
      impressions: 300,
      clicks: 30,
      installs: 5,
      authorizationType: 'system_user',
      authorizationId: 'credential-1',
    })
    expect(snapshot.rows[0]).not.toHaveProperty('raw')
    expect(snapshot.rows[0]).not.toHaveProperty('actions')
    expect(snapshot.rows[0]).not.toHaveProperty('raw_secret')
    expect(snapshot.rows[0].sourceHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('replaces only the successfully fetched account-day snapshot', async () => {
    const snapshot = buildMetaInsightsFactSnapshot({
      date: '2026-08-18',
      accountId: '101',
      insights: [{ campaign_id: 'cmp-1', country: 'US', spend: '1.00' }],
    })

    await persistMetaInsightsFactSnapshots([snapshot])

    const operations = mockFactBulkWrite.mock.calls[0][0]
    expect(operations[0].updateOne.filter).toEqual({
      provider: 'facebook',
      date: '2026-08-18',
      accountId: '101',
      campaignId: 'cmp-1',
      country: 'US',
    })
    expect(operations[1]).toEqual({
      deleteMany: {
        filter: {
          provider: 'facebook',
          date: '2026-08-18',
          accountId: '101',
          snapshotId: { $ne: snapshot.snapshotId },
        },
      },
    })
  })

  it('marks failures unavailable with retry metadata instead of writing zero facts', async () => {
    const error: any = new Error('Invalid OAuth access token')
    error.code = 190
    const attemptedAt = new Date('2026-08-18T04:00:00.000Z')

    await persistMetaInsightsCoverageOutcomes(
      [
        {
          date: '2026-08-18',
          accountId: 'act_101',
          status: 'unavailable',
          hasSnapshot: false,
          error,
        },
      ],
      attemptedAt,
    )

    expect(mockFactBulkWrite).not.toHaveBeenCalled()
    const operation = mockCoverageBulkWrite.mock.calls[0][0][0].updateOne
    expect(operation.filter).toEqual({
      provider: 'facebook',
      date: '2026-08-18',
      accountId: '101',
    })
    expect(operation.update.$set).toMatchObject({
      status: 'unavailable',
      hasSnapshot: false,
      lastErrorCode: 190,
      nextRetryAt: new Date('2026-08-18T10:00:00.000Z'),
    })
    expect(operation.update.$inc).toEqual({ consecutiveFailures: 1 })
  })
})
