const mockReplicaFindOne = jest.fn()
const mockReplicaFindOneAndUpdate = jest.fn()
const mockReplicaFindByIdAndUpdate = jest.fn()
const mockDraftFindOne = jest.fn()
const mockPublishDraft = jest.fn()

jest.mock('../src/models/ReplicaRun', () => ({
  __esModule: true,
  default: {
    findOne: mockReplicaFindOne,
    findOneAndUpdate: mockReplicaFindOneAndUpdate,
    findByIdAndUpdate: mockReplicaFindByIdAndUpdate,
  },
}))

jest.mock('../src/models/AdDraft', () => ({
  __esModule: true,
  default: {
    findOne: mockDraftFindOne,
  },
}))

jest.mock('../src/services/bulkAd.service', () => ({
  createDraft: jest.fn(),
  validateDraft: jest.fn(),
  publishDraft: mockPublishDraft,
}))

import {
  assertAiDraftPaused,
  publishReplica,
} from '../src/services/optimizerReplica.service'

const pausedDraft = {
  _id: '665000000000000000000010',
  campaign: { status: 'PAUSED' },
  adset: { status: 'PAUSED' },
  ad: { status: 'PAUSED' },
  aiOrigin: { statusLockedToPaused: true },
}

describe('AI replica publish guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejects any AI draft whose campaign, adset, or ad becomes active', () => {
    expect(() =>
      assertAiDraftPaused({
        ...pausedDraft,
        adset: { status: 'ACTIVE' },
      }),
    ).toThrow('必须全部为 PAUSED')
  })

  it('uses an atomic approved-to-publishing claim before calling the bulk publisher', async () => {
    mockReplicaFindOne.mockResolvedValue({
      _id: '665000000000000000000001',
      status: 'approved',
      draftId: pausedDraft._id,
    })
    mockDraftFindOne.mockResolvedValue(pausedDraft)
    mockReplicaFindOneAndUpdate.mockResolvedValue(null)

    await expect(
      publishReplica({
        id: '665000000000000000000001',
        confirmation: 'PUBLISH_PAUSED_REPLICA',
      }),
    ).rejects.toThrow('已被其他发布请求处理')

    expect(mockReplicaFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: '665000000000000000000001',
        status: 'approved',
      }),
      { $set: { status: 'publishing', updatedBy: undefined } },
      { new: true },
    )
    expect(mockPublishDraft).not.toHaveBeenCalled()
  })

  it('publishes through the existing bulk path only after the PAUSED claim succeeds', async () => {
    const run = {
      _id: '665000000000000000000001',
      status: 'approved',
      draftId: pausedDraft._id,
    }
    const claimed = { ...run, status: 'publishing' }
    const updated = {
      ...run,
      status: 'publishing',
      taskId: '665000000000000000000020',
      toObject: () => ({
        ...run,
        status: 'publishing',
        taskId: '665000000000000000000020',
      }),
    }
    const task = {
      _id: '665000000000000000000020',
      status: 'queued',
      toObject: () => ({ _id: '665000000000000000000020', status: 'queued' }),
    }
    mockReplicaFindOne.mockResolvedValue(run)
    mockDraftFindOne.mockResolvedValue(pausedDraft)
    mockReplicaFindOneAndUpdate.mockResolvedValue(claimed)
    mockPublishDraft.mockResolvedValue(task)
    mockReplicaFindByIdAndUpdate.mockResolvedValue(updated)

    const result = await publishReplica({
      id: run._id,
      confirmation: 'PUBLISH_PAUSED_REPLICA',
      publishedBy: '665000000000000000000099',
    })

    expect(mockPublishDraft).toHaveBeenCalledWith(
      pausedDraft._id,
      '665000000000000000000099',
      {},
    )
    expect(result).toMatchObject({
      effectiveStatus: 'publishing',
      taskId: '665000000000000000000020',
    })
  })
})
