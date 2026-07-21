const mockAdd = jest.fn()
const mockGetWorkersCount = jest.fn()
const mockGetJobs = jest.fn()
const mockAccountFind = jest.fn()

jest.mock('../src/queue/facebook.queue', () => ({
  accountQueue: {
    add: mockAdd,
    getWorkersCount: mockGetWorkersCount,
    getJobs: mockGetJobs,
  },
  campaignQueue: {},
  adQueue: {},
  materialQueue: {},
}))

jest.mock('../src/models/Account', () => ({
  __esModule: true,
  default: {
    find: mockAccountFind,
  },
}))

import {
  recoverFacebookAccountQueue,
  syncCampaignsFromAdAccountsV2,
} from '../src/services/facebook.campaigns.v2.service'

const accounts = [
  {
    accountId: '111',
    token: 'TOKEN_111',
    status: 'active',
    organizationId: '665000000000000000000001',
  },
  {
    accountId: '222',
    token: 'TOKEN_222',
    status: 'active',
    organizationId: '665000000000000000000002',
  },
]

describe('facebook queue scheduler safety', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAccountFind.mockResolvedValue(accounts)
    mockGetWorkersCount.mockResolvedValue(1)
    mockGetJobs.mockResolvedValue([])
    mockAdd.mockImplementation(async (_name, data, options) => ({ data, opts: options }))
  })

  it('fails closed when no account worker is consuming the queue', async () => {
    mockGetWorkersCount.mockResolvedValue(0)

    await expect(syncCampaignsFromAdAccountsV2()).rejects.toThrow(
      'No live facebook.account.sync workers',
    )

    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('skips accounts already pending across cron time slots', async () => {
    mockGetJobs.mockResolvedValue([
      { id: 'old-slot', data: { accountId: '111' } },
    ])

    const result = await syncCampaignsFromAdAccountsV2()

    expect(mockGetJobs).toHaveBeenCalledWith([
      'active',
      'waiting',
      'prioritized',
      'delayed',
    ], 0, 9999)
    expect(mockAdd).toHaveBeenCalledTimes(1)
    expect(mockAdd).toHaveBeenCalledWith(
      'sync-account',
      expect.objectContaining({
        accountId: '222',
        organizationId: '665000000000000000000002',
      }),
      expect.any(Object),
    )
    expect(result).toMatchObject({
      syncedAccounts: 2,
      jobsQueued: 1,
      jobsSkippedPending: 1,
    })
  })

  it('supports an explicit active-account canary without queuing the full catalog', async () => {
    const result = await syncCampaignsFromAdAccountsV2({ accountIds: ['222'], limit: 1 })

    expect(mockAdd).toHaveBeenCalledTimes(1)
    expect(mockAdd).toHaveBeenCalledWith(
      'sync-account',
      expect.objectContaining({ accountId: '222' }),
      expect.any(Object),
    )
    expect(result).toMatchObject({ syncedAccounts: 1, jobsQueued: 1 })
  })

  it('previews recovery without removing jobs and requires exact confirmation to apply', async () => {
    const prioritized = { id: 'p1', remove: jest.fn() }
    const failed = { id: 'f1', remove: jest.fn() }
    mockGetJobs
      .mockResolvedValueOnce([prioritized])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([failed])

    const preview = await recoverFacebookAccountQueue({ dryRun: true })

    expect(preview).toMatchObject({
      dryRun: true,
      candidates: 2,
      byState: { prioritized: 1, waiting: 0, delayed: 0, failed: 1 },
      removed: 0,
    })
    expect(prioritized.remove).not.toHaveBeenCalled()
    expect(failed.remove).not.toHaveBeenCalled()

    await expect(recoverFacebookAccountQueue({
      dryRun: false,
      confirmation: 'wrong',
    })).rejects.toThrow('RECOVER_FACEBOOK_ACCOUNT_QUEUE')
  })

  it('removes only bounded non-active account jobs after confirmation', async () => {
    const jobs = ['p1', 'w1', 'd1', 'f1'].map((id) => ({ id, remove: jest.fn().mockResolvedValue(undefined) }))
    mockGetJobs
      .mockResolvedValueOnce([jobs[0]])
      .mockResolvedValueOnce([jobs[1]])
      .mockResolvedValueOnce([jobs[2]])
      .mockResolvedValueOnce([jobs[3]])

    const result = await recoverFacebookAccountQueue({
      dryRun: false,
      confirmation: 'RECOVER_FACEBOOK_ACCOUNT_QUEUE',
      maxJobs: 10,
    })

    expect(result).toMatchObject({ dryRun: false, candidates: 4, removed: 4 })
    expect(jobs.every((job) => job.remove.mock.calls.length === 1)).toBe(true)
    expect(mockGetJobs).not.toHaveBeenCalledWith(expect.arrayContaining(['active']), expect.anything(), expect.anything())
  })
})
