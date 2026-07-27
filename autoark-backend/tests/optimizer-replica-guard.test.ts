const mockReplicaFindOne = jest.fn()
const mockReplicaFindOneAndUpdate = jest.fn()
const mockReplicaFindByIdAndUpdate = jest.fn()
const mockDraftFindOne = jest.fn()
const mockPlaybookFindOne = jest.fn()
const mockCreativeFindOne = jest.fn()
const mockCopyFindOne = jest.fn()
const mockPublishDraft = jest.fn()
const mockResolveExecutionMandate = jest.fn()

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

jest.mock('../src/models/PlaybookVersion', () => ({
  __esModule: true,
  default: {
    findOne: mockPlaybookFindOne,
  },
}))

jest.mock('../src/models/CreativeGroup', () => ({
  __esModule: true,
  default: {
    findOne: mockCreativeFindOne,
  },
}))

jest.mock('../src/models/CopywritingPackage', () => ({
  __esModule: true,
  default: {
    findOne: mockCopyFindOne,
  },
}))

jest.mock('../src/services/optimizerExecution.service', () => ({
  listExecutionSetup: jest.fn(),
  resolveExecutionMandate: mockResolveExecutionMandate,
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

const runId = '665000000000000000000001'
const playbookId = '665000000000000000000002'
const mandateId = '665000000000000000000003'
const tokenId = '665000000000000000000004'
const metaCredentialId = '66500000000000000000000b'
const sourceCreativeGroupId = '665000000000000000000005'
const sourceCopywritingPackageId = '665000000000000000000006'
const targetingPackageId = '665000000000000000000007'
const productId = '665000000000000000000008'
const executionCreativeGroupId = '665000000000000000000009'
const executionCopywritingPackageId = '66500000000000000000000a'
const draftId = '665000000000000000000010'

const queryWithLean = (value: any) => ({
  lean: jest.fn().mockResolvedValue(value),
})

const frozenTargeting = { geo_locations: { countries: ['US'] } }
const frozenCreative = {
  format: 'single',
  dynamicCreative: false,
  materials: [
    {
      type: 'image',
      url: 'https://cdn.example.com/winner.jpg',
      name: 'Winner',
    },
  ],
}
const frozenCopywriting = {
  content: {
    primaryTexts: ['Primary'],
    headlines: ['Headline'],
    descriptions: ['Description'],
  },
  callToAction: 'SHOP_NOW',
  links: {
    websiteUrl: 'https://example.com/product',
  },
  language: 'en',
}

const pausedDraft = {
  _id: draftId,
  facebookTokenId: tokenId,
  accounts: [
    {
      accountId: '123',
      pageId: 'page_1',
      pixelId: 'pixel_1',
    },
  ],
  campaign: { status: 'PAUSED' },
  adset: { status: 'PAUSED', inlineTargeting: frozenTargeting },
  ad: { status: 'PAUSED' },
  aiOrigin: {
    replicaRunId: runId,
    mandateId,
    statusLockedToPaused: true,
  },
}

const baseRun = {
  _id: runId,
  status: 'approved',
  draftId,
  mandateId,
  playbookVersionId: playbookId,
  sourceCreativeGroupId,
  sourceCopywritingPackageId,
  targetingPackageId,
  productId,
  creativeGroupId: executionCreativeGroupId,
  copywritingPackageId: executionCopywritingPackageId,
  targets: { dailyBudget: 20 },
  assetSnapshot: {
    frozenTargeting,
    frozenCreative,
    frozenCopywriting,
  },
}

const mandateSelection = {
  mandate: {
    _id: mandateId,
    facebookTokenId: tokenId,
    budget: { maximumDailyBudget: 50 },
  },
  targets: [
    {
      accountId: '123',
      pageId: 'page_1',
      pixelId: 'pixel_1',
    },
  ],
  creativeGroup: { _id: sourceCreativeGroupId },
  copywritingPackage: { _id: sourceCopywritingPackageId },
  targetingPackage: { _id: targetingPackageId },
  product: { _id: productId },
}

describe('AI replica publish guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPlaybookFindOne.mockReturnValue(
      queryWithLean({ _id: playbookId, organizationId: undefined }),
    )
    mockResolveExecutionMandate.mockResolvedValue(mandateSelection)
    mockCreativeFindOne.mockReturnValue(
      queryWithLean({
        _id: executionCreativeGroupId,
        config: { format: 'single', dynamicCreative: false },
        materials: frozenCreative.materials,
      }),
    )
    mockCopyFindOne.mockReturnValue(
      queryWithLean({
        _id: executionCopywritingPackageId,
        ...frozenCopywriting,
      }),
    )
  })

  it('rejects any AI draft whose campaign, adset, or ad becomes active', () => {
    expect(() =>
      assertAiDraftPaused({
        ...pausedDraft,
        adset: { status: 'ACTIVE' },
      }),
    ).toThrow('必须全部为 PAUSED')
  })

  it('rejects legacy AI runs that do not have an administrator mandate', async () => {
    mockReplicaFindOne.mockResolvedValue({
      ...baseRun,
      mandateId: undefined,
    })
    mockDraftFindOne.mockResolvedValue(pausedDraft)

    await expect(
      publishReplica({
        id: runId,
        confirmation: 'PUBLISH_PAUSED_REPLICA',
      }),
    ).rejects.toMatchObject({
      code: 'AI_EXECUTION_MANDATE_REQUIRED',
    })
    expect(mockPublishDraft).not.toHaveBeenCalled()
  })

  it('uses an atomic approved-to-publishing claim after revalidating the mandate', async () => {
    mockReplicaFindOne.mockResolvedValue(baseRun)
    mockDraftFindOne.mockResolvedValue(pausedDraft)
    mockReplicaFindOneAndUpdate.mockResolvedValue(null)

    await expect(
      publishReplica({
        id: runId,
        confirmation: 'PUBLISH_PAUSED_REPLICA',
      }),
    ).rejects.toThrow('已被其他发布请求处理')

    expect(mockResolveExecutionMandate).toHaveBeenCalledWith(
      expect.objectContaining({ mandateId, tokenAccessFilter: {} }),
    )
    expect(mockReplicaFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: runId,
        status: 'approved',
      }),
      { $set: { status: 'publishing', updatedBy: undefined } },
      { new: true },
    )
    expect(mockPublishDraft).not.toHaveBeenCalled()
  })

  it('publishes only through the dedicated bulk path after the mandate checks pass', async () => {
    const claimed = { ...baseRun, status: 'publishing' }
    const updated = {
      ...baseRun,
      status: 'publishing',
      taskId: '665000000000000000000020',
      toObject: () => ({
        ...baseRun,
        status: 'publishing',
        taskId: '665000000000000000000020',
      }),
    }
    const task = {
      _id: '665000000000000000000020',
      status: 'queued',
      toObject: () => ({ _id: '665000000000000000000020', status: 'queued' }),
    }
    mockReplicaFindOne.mockResolvedValue(baseRun)
    mockDraftFindOne.mockResolvedValue(pausedDraft)
    mockReplicaFindOneAndUpdate.mockResolvedValue(claimed)
    mockPublishDraft.mockResolvedValue(task)
    mockReplicaFindByIdAndUpdate.mockResolvedValue(updated)

    const result = await publishReplica({
      id: runId,
      confirmation: 'PUBLISH_PAUSED_REPLICA',
      publishedBy: '665000000000000000000099',
    })

    expect(mockPublishDraft).toHaveBeenCalledWith(
      draftId,
      '665000000000000000000099',
      {},
      { aiReplicaRunId: runId },
    )
    expect(result).toMatchObject({
      effectiveStatus: 'publishing',
      taskId: '665000000000000000000020',
    })
  })

  it('accepts the exact organization System User pinned by the mandate', async () => {
    mockReplicaFindOne.mockResolvedValue(baseRun)
    mockDraftFindOne.mockResolvedValue({
      ...pausedDraft,
      facebookTokenId: undefined,
      metaCredentialId,
    })
    mockResolveExecutionMandate.mockResolvedValue({
      ...mandateSelection,
      authorizationType: 'system_user',
      mandate: {
        ...mandateSelection.mandate,
        authorizationType: 'system_user',
        facebookTokenId: undefined,
        metaCredentialId,
      },
    })
    mockReplicaFindOneAndUpdate.mockResolvedValue(null)

    await expect(
      publishReplica({
        id: runId,
        confirmation: 'PUBLISH_PAUSED_REPLICA',
      }),
    ).rejects.toThrow('已被其他发布请求处理')
    expect(mockPublishDraft).not.toHaveBeenCalled()
  })
})
