const mockCreativeCount = jest.fn()
const mockCreativeFind = jest.fn()
const mockAccountFind = jest.fn()
const mockGetJob = jest.fn()
const mockAdd = jest.fn()

jest.mock('../src/models/Creative', () => ({
  __esModule: true,
  default: {
    countDocuments: mockCreativeCount,
    find: mockCreativeFind,
  },
}))

jest.mock('../src/models/Account', () => ({
  __esModule: true,
  default: {
    find: mockAccountFind,
  },
}))

jest.mock('../src/queue/facebook.queue', () => ({
  materialQueue: {
    getJob: mockGetJob,
    add: mockAdd,
  },
}))

import { backfillFacebookOriginalImages } from '../src/services/facebookMaterialBackfill.service'

const leanQuery = (value: any) => ({ lean: jest.fn().mockResolvedValue(value) })

describe('Facebook original image backfill', () => {
  const originalSyncEnabled = process.env.FACEBOOK_SYNC_ENABLED

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.FACEBOOK_SYNC_ENABLED = 'true'
    const creatives = [
      {
        creativeId: 'creative-1',
        accountId: '123',
        organizationId: { toString: () => 'org-1' },
        name: 'Image one',
        imageHash: 'hash-1',
        imageUrl: 'https://preview.example/1.jpg',
      },
      {
        creativeId: 'creative-2',
        accountId: '456',
        name: 'Image two',
        imageHash: 'hash-2',
      },
    ]
    mockCreativeCount.mockResolvedValue(2)
    mockCreativeFind.mockReturnValue({
      limit: jest.fn().mockReturnValue(leanQuery(creatives)),
    })
    mockAccountFind.mockReturnValue(
      leanQuery([
        {
          accountId: 'act_123',
          token: 'TOKEN_123',
          organizationId: { toString: () => 'org-account' },
        },
      ]),
    )
    mockGetJob.mockResolvedValue(null)
    mockAdd.mockResolvedValue({ id: 'queued' })
  })

  afterAll(() => {
    if (originalSyncEnabled === undefined) {
      delete process.env.FACEBOOK_SYNC_ENABLED
    } else {
      process.env.FACEBOOK_SYNC_ENABLED = originalSyncEnabled
    }
  })

  it('previews eligible originals without mutating the queue', async () => {
    const result = await backfillFacebookOriginalImages({
      dryRun: true,
      maxJobs: 100,
    })

    expect(result).toMatchObject({
      dryRun: true,
      totalCandidates: 2,
      selected: 2,
      eligible: 1,
      skippedNoToken: 1,
      queued: 0,
    })
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('requires confirmation and queues a bounded original-image-only job', async () => {
    await expect(
      backfillFacebookOriginalImages({
        dryRun: false,
        confirmation: 'wrong',
      }),
    ).rejects.toThrow('BACKFILL_FACEBOOK_ORIGINAL_IMAGES')

    const result = await backfillFacebookOriginalImages({
      dryRun: false,
      confirmation: 'BACKFILL_FACEBOOK_ORIGINAL_IMAGES',
      maxJobs: 100,
    })

    expect(mockAdd).toHaveBeenCalledWith(
      'sync-material-original-image',
      {
        creative: {
          creativeId: 'creative-1',
          name: 'Image one',
          imageHash: 'hash-1',
          imageUrl: 'https://preview.example/1.jpg',
        },
        accountId: '123',
        organizationId: 'org-1',
        token: 'TOKEN_123',
      },
      expect.objectContaining({
        jobId: 'material-original-image-v2-creative-1',
        priority: 1,
      }),
    )
    expect(result).toMatchObject({ eligible: 1, queued: 1, skippedNoToken: 1 })
  })

  it('keeps previews available but blocks applied backfills while sync is disabled', async () => {
    process.env.FACEBOOK_SYNC_ENABLED = 'false'

    const preview = await backfillFacebookOriginalImages({
      dryRun: true,
      maxJobs: 100,
    })

    expect(preview).toMatchObject({ dryRun: true, eligible: 1, queued: 0 })

    await expect(
      backfillFacebookOriginalImages({
        dryRun: false,
        confirmation: 'BACKFILL_FACEBOOK_ORIGINAL_IMAGES',
        maxJobs: 100,
      }),
    ).rejects.toThrow('Facebook sync is disabled')
    expect(mockAdd).not.toHaveBeenCalled()
  })
})
