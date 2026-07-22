const mockMaterialFind = jest.fn()
const mockMaterialUpdateOne = jest.fn()
const mockMaterialUpdateMany = jest.fn()
const mockMaterialDeleteMany = jest.fn()
const mockCreativeCountDocuments = jest.fn()
const mockCreativeFind = jest.fn()
const mockCreativeUpdateOne = jest.fn()
const mockAdCountDocuments = jest.fn()
const mockMappingCountDocuments = jest.fn()
const mockMetricsCountDocuments = jest.fn()
const mockTaskCountDocuments = jest.fn()
const mockDeleteFromR2 = jest.fn()

jest.mock('../src/models/Material', () => ({
  __esModule: true,
  default: {
    find: mockMaterialFind,
    updateOne: mockMaterialUpdateOne,
    updateMany: mockMaterialUpdateMany,
    deleteMany: mockMaterialDeleteMany,
  },
}))

jest.mock('../src/models/Creative', () => ({
  __esModule: true,
  default: {
    countDocuments: mockCreativeCountDocuments,
    find: mockCreativeFind,
    updateOne: mockCreativeUpdateOne,
  },
}))

jest.mock('../src/models/Ad', () => ({
  __esModule: true,
  default: { countDocuments: mockAdCountDocuments },
}))

jest.mock('../src/models/AdMaterialMapping', () => ({
  __esModule: true,
  default: { countDocuments: mockMappingCountDocuments },
}))

jest.mock('../src/models/MaterialMetrics', () => ({
  __esModule: true,
  default: { countDocuments: mockMetricsCountDocuments },
}))

jest.mock('../src/models/AdTask', () => ({
  __esModule: true,
  default: { countDocuments: mockTaskCountDocuments },
}))

jest.mock('../src/services/r2Storage.service', () => ({
  deleteFromR2: mockDeleteFromR2,
}))

import { deduplicateFacebookMaterials } from '../src/services/facebookMaterialDeduplication.service'
import { buildFacebookMaterialFingerprintKey } from '../src/utils/facebookMaterialIdentity'

const objectId = (value: string) => ({ toString: () => value })

const material = (
  id: string,
  sha256: string,
  accountId: string,
  createdAt: string,
) => ({
  _id: objectId(id),
  createdAt: new Date(createdAt),
  fingerprintKey: `fb:old-${accountId}:sha256:${sha256}`,
  fingerprint: { sha256, md5: `md5-${sha256}` },
  storage: { key: `old/${id}.jpg`, url: `https://r2.example/${id}.jpg` },
  source: { platform: 'facebook', isOriginal: true },
  facebookMappings: [{
    accountId,
    creativeId: `creative-${accountId}`,
    imageHash: `hash-${accountId}`,
    isOriginal: true,
    status: 'uploaded',
  }],
  usage: { accounts: [accountId] },
  tags: ['facebook', 'original'],
})

const findChain = (value: any[]) => ({
  select: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(value),
})

describe('Facebook material deduplication', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockMaterialFind.mockReturnValue(findChain([
      material('material-a', 'shared-sha', 'account-a', '2026-07-21T00:00:00Z'),
      material('material-b', 'shared-sha', 'account-b', '2026-07-21T00:01:00Z'),
      material('material-c', 'unique-sha', 'account-c', '2026-07-21T00:02:00Z'),
    ]))
    mockCreativeCountDocuments.mockResolvedValue(2)
    mockCreativeFind.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) })
    mockCreativeUpdateOne.mockResolvedValue({ modifiedCount: 1 })
    mockMaterialUpdateOne.mockResolvedValue({ modifiedCount: 1 })
    mockMaterialUpdateMany.mockResolvedValue({ modifiedCount: 1 })
    mockMaterialDeleteMany.mockResolvedValue({ deletedCount: 1 })
    mockAdCountDocuments.mockResolvedValue(0)
    mockMappingCountDocuments.mockResolvedValue(0)
    mockMetricsCountDocuments.mockResolvedValue(0)
    mockTaskCountDocuments.mockResolvedValue(0)
    mockDeleteFromR2.mockResolvedValue({ success: true })
  })

  it('previews exact-content duplicates and reference risk without mutating data', async () => {
    const result = await deduplicateFacebookMaterials({ dryRun: true })

    expect(result).toMatchObject({
      dryRun: true,
      totalMaterials: 3,
      distinctFiles: 2,
      duplicateGroups: 1,
      duplicateDocuments: 1,
      creativeReferences: 2,
      externalReferences: {
        ads: 0,
        mappings: 0,
        metrics: 0,
        tasks: 0,
      },
      mergedGroups: 0,
      deletedDocuments: 0,
    })
    expect(mockMaterialUpdateOne).not.toHaveBeenCalled()
    expect(mockMaterialDeleteMany).not.toHaveBeenCalled()
    expect(mockDeleteFromR2).not.toHaveBeenCalled()
  })

  it('requires an exact confirmation before applying destructive cleanup', async () => {
    await expect(deduplicateFacebookMaterials({
      dryRun: false,
      confirmation: 'wrong',
    })).rejects.toThrow('DEDUPLICATE_FACEBOOK_MATERIALS')
  })

  it('merges safe duplicate mappings, rekeys canonical files, and archives redundant records', async () => {
    const result = await deduplicateFacebookMaterials({
      dryRun: false,
      confirmation: 'DEDUPLICATE_FACEBOOK_MATERIALS',
    })

    const sharedUpdate = mockMaterialUpdateOne.mock.calls.find(
      ([, update]) => update.$set.fingerprintKey.endsWith(':shared-sha'),
    )
    expect(sharedUpdate[0]._id.toString()).toBe('material-a')
    expect(sharedUpdate[1]).toEqual(expect.objectContaining({
      $set: expect.objectContaining({
        fingerprintKey: expect.stringMatching(/^fb:[a-f0-9]{16}:sha256:shared-sha$/),
        facebookMappings: expect.arrayContaining([
          expect.objectContaining({ accountId: 'account-a' }),
          expect.objectContaining({ accountId: 'account-b' }),
        ]),
        'usage.accounts': ['account-a', 'account-b'],
      }),
    }))
    const archiveFilter = mockMaterialUpdateMany.mock.calls[0][0]
    const archiveUpdate = mockMaterialUpdateMany.mock.calls[0][1]
    expect(archiveFilter._id.$in.map((id: any) => id.toString())).toEqual(['material-b'])
    expect(archiveUpdate).toEqual({
      $set: {
        status: 'deleted',
        deduplicatedInto: expect.anything(),
      },
    })
    expect(mockMaterialDeleteMany).not.toHaveBeenCalled()
    expect(mockDeleteFromR2).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      mergedGroups: 1,
      archivedDocuments: 1,
      deletedDocuments: 0,
      rekeyedCanonicalDocuments: 2,
      skippedReferencedGroups: 0,
    })
  })

  it('limits actionable work so completed canonical groups do not strand later duplicates', async () => {
    const completed = material('material-complete', 'complete-sha', 'account-a', '2026-07-20T00:00:00Z')
    completed.fingerprintKey = buildFacebookMaterialFingerprintKey(undefined, 'complete-sha')
    mockMaterialFind.mockReturnValue(findChain([
      completed,
      material('material-later-a', 'later-sha', 'account-b', '2026-07-21T00:00:00Z'),
      material('material-later-b', 'later-sha', 'account-c', '2026-07-21T00:01:00Z'),
    ]))

    const result = await deduplicateFacebookMaterials({ dryRun: true, maxGroups: 1 })

    expect(result).toMatchObject({
      selectedGroups: 1,
      duplicateGroups: 1,
      duplicateDocuments: 1,
      truncated: false,
    })
  })

  it('does not delete a group when another production model references a duplicate', async () => {
    mockAdCountDocuments.mockResolvedValue(1)

    const result = await deduplicateFacebookMaterials({
      dryRun: false,
      confirmation: 'DEDUPLICATE_FACEBOOK_MATERIALS',
    })

    expect(mockMaterialDeleteMany).not.toHaveBeenCalled()
    expect(mockDeleteFromR2).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      mergedGroups: 0,
      skippedReferencedGroups: 1,
      deletedDocuments: 0,
    })
  })
})
