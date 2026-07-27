const mockResolveExecutionMandate = jest.fn()

jest.mock('../src/services/optimizerExecution.service', () => ({
  resolveExecutionMandate: mockResolveExecutionMandate,
}))

import CopywritingPackage from '../src/models/CopywritingPackage'
import CreativeGroup from '../src/models/CreativeGroup'
import PlaybookVersion from '../src/models/PlaybookVersion'
import ReplicaRun from '../src/models/ReplicaRun'
import { assertAiTaskExecutionAuthorized } from '../src/services/bulkAd.service'

const ids = {
  task: '665000000000000000000001',
  draft: '665000000000000000000002',
  organization: '665000000000000000000003',
  run: '665000000000000000000004',
  mandate: '665000000000000000000005',
  playbook: '665000000000000000000006',
  token: '665000000000000000000007',
  metaCredential: '66500000000000000000000f',
  sourceCreative: '665000000000000000000008',
  sourceCopy: '665000000000000000000009',
  targeting: '66500000000000000000000a',
  product: '66500000000000000000000b',
  executionCreative: '66500000000000000000000c',
  executionCopy: '66500000000000000000000d',
}

const frozenTargeting = { geo_locations: { countries: ['US'] } }
const executionCreative = {
  _id: ids.executionCreative,
  config: { format: 'single', dynamicCreative: false },
  materials: [
    {
      type: 'image',
      url: 'https://cdn.example.com/winner.jpg',
      name: 'Winner',
    },
  ],
}
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
const executionCopy = {
  _id: ids.executionCopy,
  content: {
    primaryTexts: ['Admin copy'],
    headlines: ['Admin headline'],
    descriptions: [],
  },
  callToAction: 'SHOP_NOW',
  links: { websiteUrl: 'https://product.example.com' },
}
const frozenCopy = {
  content: {
    primaryTexts: ['Admin copy'],
    headlines: ['Admin headline'],
    descriptions: [],
  },
  callToAction: 'SHOP_NOW',
  links: { websiteUrl: 'https://product.example.com' },
}

const queryWithLean = (value: any) => ({
  lean: jest.fn().mockResolvedValue(value),
})

const queryWithSelectAndLean = (value: any) => ({
  select: jest.fn().mockReturnValue(queryWithLean(value)),
})

const replicaRun = {
  _id: ids.run,
  mandateId: ids.mandate,
  playbookVersionId: ids.playbook,
  sourceCreativeGroupId: ids.sourceCreative,
  sourceCopywritingPackageId: ids.sourceCopy,
  targetingPackageId: ids.targeting,
  productId: ids.product,
  creativeGroupId: ids.executionCreative,
  copywritingPackageId: ids.executionCopy,
  targets: { dailyBudget: 20 },
  assetSnapshot: {
    frozenTargeting,
    frozenCreative,
    frozenCopywriting: frozenCopy,
  },
}

const selection = {
  mandate: {
    _id: ids.mandate,
    facebookTokenId: ids.token,
    budget: { maximumDailyBudget: 50 },
  },
  targets: [
    {
      accountId: '123',
      pageId: 'page_1',
      pixelId: 'pixel_1',
    },
  ],
  creativeGroup: { _id: ids.sourceCreative },
  copywritingPackage: { _id: ids.sourceCopy },
  targetingPackage: { _id: ids.targeting },
  product: { _id: ids.product },
}

const task = {
  _id: ids.task,
  draftId: ids.draft,
  organizationId: ids.organization,
  configSnapshot: {
    facebookTokenId: ids.token,
    facebookTokenOwnerUserId: '66500000000000000000000e',
    accounts: [
      {
        accountId: '123',
        pageId: 'page_1',
        pixelId: 'pixel_1',
      },
    ],
    campaign: { status: 'PAUSED', budget: 20 },
    adset: {
      status: 'PAUSED',
      budget: 20,
      inlineTargeting: frozenTargeting,
    },
    ad: {
      status: 'PAUSED',
      creativeGroupIds: [ids.executionCreative],
      copywritingPackageIds: [ids.executionCopy],
    },
    aiOrigin: {
      replicaRunId: ids.run,
      mandateId: ids.mandate,
      playbookVersionId: ids.playbook,
      statusLockedToPaused: true,
    },
  },
}

const mockValidExecution = () => {
  jest
    .spyOn(ReplicaRun, 'findOne')
    .mockReturnValue(queryWithSelectAndLean(replicaRun) as any)
  jest.spyOn(PlaybookVersion, 'findOne').mockReturnValue(
    queryWithLean({
      _id: ids.playbook,
      organizationId: ids.organization,
    }) as any,
  )
  jest
    .spyOn(CreativeGroup, 'findOne')
    .mockReturnValue(queryWithLean(executionCreative) as any)
  jest
    .spyOn(CopywritingPackage, 'findOne')
    .mockReturnValue(queryWithLean(executionCopy) as any)
  mockResolveExecutionMandate.mockResolvedValue(selection)
}

describe('AI worker execution authorization', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
  })

  it('revalidates the complete mandate and frozen payload before Meta writes', async () => {
    mockValidExecution()

    await expect(assertAiTaskExecutionAuthorized(task)).resolves.toBe(true)
    expect(mockResolveExecutionMandate).toHaveBeenCalledWith({
      mandateId: ids.mandate,
      playbook: expect.objectContaining({ _id: ids.playbook }),
      accessFilter: { organizationId: ids.organization },
      tokenAccessFilter: {
        organizationId: ids.organization,
        userId: task.configSnapshot.facebookTokenOwnerUserId,
      },
    })
  })

  it('stops an already queued AI task when its mandate is revoked', async () => {
    mockValidExecution()
    mockResolveExecutionMandate.mockRejectedValue(
      Object.assign(new Error('revoked'), {
        statusCode: 409,
        code: 'AI_EXECUTION_MANDATE_REQUIRED',
      }),
    )

    await expect(assertAiTaskExecutionAuthorized(task)).rejects.toMatchObject({
      statusCode: 409,
      errorCode: 'AI_EXECUTION_MANDATE_REQUIRED',
    })
  })

  it('stops execution when a frozen creative changes after approval', async () => {
    mockValidExecution()
    jest.spyOn(CreativeGroup, 'findOne').mockReturnValue(
      queryWithLean({
        ...executionCreative,
        materials: [
          {
            type: 'image',
            url: 'https://cdn.example.com/replaced.jpg',
            name: 'Replaced',
          },
        ],
      }) as any,
    )

    await expect(assertAiTaskExecutionAuthorized(task)).rejects.toMatchObject({
      statusCode: 409,
      errorCode: 'AI_EXECUTION_SNAPSHOT_CHANGED',
    })
  })

  it('revalidates the exact organization System User before Meta writes', async () => {
    mockValidExecution()
    mockResolveExecutionMandate.mockResolvedValue({
      ...selection,
      authorizationType: 'system_user',
      mandate: {
        ...selection.mandate,
        authorizationType: 'system_user',
        facebookTokenId: undefined,
        metaCredentialId: ids.metaCredential,
      },
    })
    const systemTask = {
      ...task,
      configSnapshot: {
        ...task.configSnapshot,
        facebookTokenId: undefined,
        facebookTokenOwnerUserId: undefined,
        metaCredentialId: ids.metaCredential,
      },
    }

    await expect(assertAiTaskExecutionAuthorized(systemTask)).resolves.toBe(
      true,
    )
    expect(mockResolveExecutionMandate).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenAccessFilter: { organizationId: ids.organization },
      }),
    )
  })

  it('fails closed when an AI lineage loses its PAUSED lock', async () => {
    const corruptedTask = {
      ...task,
      configSnapshot: {
        ...task.configSnapshot,
        aiOrigin: {
          ...task.configSnapshot.aiOrigin,
          statusLockedToPaused: false,
        },
      },
    }

    await expect(
      assertAiTaskExecutionAuthorized(corruptedTask),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: 'AI_EXECUTION_LINEAGE_REQUIRED',
    })
  })

  it('does not affect ordinary manually published bulk tasks', async () => {
    const replicaLookup = jest.spyOn(ReplicaRun, 'findOne')
    await expect(
      assertAiTaskExecutionAuthorized({
        ...task,
        configSnapshot: {},
      }),
    ).resolves.toBe(true)
    expect(replicaLookup).not.toHaveBeenCalled()
  })
})
