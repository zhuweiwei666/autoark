const mockAutomationJobFindById = jest.fn()
const mockAutomationJobFind = jest.fn()
const mockAutomationJobCountDocuments = jest.fn()
const mockFbTokenFindOne = jest.fn()
const mockPublishDraft = jest.fn()
const mockSyncFacebookUserAssets = jest.fn()
const mockAgentFindById = jest.fn()

jest.mock('../src/queue/automation.queue', () => ({
  addAutomationJob: jest.fn(),
}))

jest.mock('../src/models/AutomationJob', () => ({
  __esModule: true,
  AUTOMATION_JOB_TYPES: [
    'RUN_AGENT',
    'RUN_AGENT_AS_JOBS',
    'EXECUTE_AGENT_OPERATION',
    'PUBLISH_DRAFT',
    'RUN_FB_FULL_SYNC',
    'SYNC_FB_USER_ASSETS',
  ],
  AUTOMATION_JOB_STATUSES: [
    'queued',
    'running',
    'completed',
    'failed',
    'cancelled',
  ],
  default: {
    findById: mockAutomationJobFindById,
    find: mockAutomationJobFind,
    countDocuments: mockAutomationJobCountDocuments,
  },
}))

jest.mock('../src/models/FbToken', () => ({
  __esModule: true,
  default: {
    findOne: mockFbTokenFindOne,
  },
}))

jest.mock('../src/services/bulkAd.service', () => ({
  __esModule: true,
  default: {
    publishDraft: mockPublishDraft,
  },
}))

jest.mock('../src/services/facebook.sync.service', () => ({
  runFullSync: jest.fn(),
}))

jest.mock('../src/services/facebookUser.service', () => ({
  syncFacebookUserAssets: mockSyncFacebookUserAssets,
}))

jest.mock('../src/domain/agent/agent.service', () => ({
  agentService: {
    runAgent: jest.fn(),
    runAgentAsJobs: jest.fn(),
    executeOperation: jest.fn(),
  },
}))

jest.mock('../src/domain/agent/agent.model', () => ({
  AgentConfig: {
    findById: mockAgentFindById,
  },
}))

import {
  executeAutomationJobInline,
  listAutomationJobs,
} from '../src/services/automationJob.service'

const createJobDoc = (overrides: any = {}) => ({
  _id: 'job-1',
  status: 'queued',
  type: 'PUBLISH_DRAFT',
  payload: { draftId: 'draft-1' },
  organizationId: 'org-a',
  createdBy: 'user-1',
  attempts: 0,
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides,
})

const leanResult = (value: any) => ({
  lean: jest.fn().mockResolvedValue(value),
})

const selectableLeanResult = (value: any) => ({
  select: jest.fn(() => leanResult(value)),
})

const automationJobFindChain = () => {
  const chain: any = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([]),
  }
  return chain
}

describe('automation job execution scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPublishDraft.mockResolvedValue({ ok: true })
    mockSyncFacebookUserAssets.mockResolvedValue({ ok: true })
    mockAutomationJobCountDocuments.mockResolvedValue(0)
  })

  it('sanitizes automation job list filters and pagination at service boundary', async () => {
    const chain = automationJobFindChain()
    mockAutomationJobFind.mockReturnValue(chain)

    const result = await listAutomationJobs({
      status: { $ne: 'queued' },
      type: 'PUBLISH_DRAFT',
      agentId: { $ne: '665000000000000000000301' },
      page: 'bad',
      pageSize: '9999',
    })

    expect(mockAutomationJobFind).toHaveBeenCalledWith({ type: 'PUBLISH_DRAFT' })
    expect(mockAutomationJobCountDocuments).toHaveBeenCalledWith({ type: 'PUBLISH_DRAFT' })
    expect(chain.skip).toHaveBeenCalledWith(0)
    expect(chain.limit).toHaveBeenCalledWith(200)
    expect(result).toMatchObject({
      list: [],
      total: 0,
      page: 1,
      pageSize: 200,
    })
  })

  it('publishes drafts with the job tenant access filter', async () => {
    const doc = createJobDoc()
    mockAutomationJobFindById.mockResolvedValue(doc)

    await executeAutomationJobInline('job-1')

    expect(mockPublishDraft).toHaveBeenCalledTimes(1)
    const [draftId, userId, accessFilter] = mockPublishDraft.mock.calls[0]
    expect(draftId).toBe('draft-1')
    expect(userId).toBe('user-1')
    expect(accessFilter).toMatchObject({ organizationId: 'org-a' })
    expect(doc.status).toBe('completed')
  })

  it('syncs facebook user assets only through an accessible active token', async () => {
    const doc = createJobDoc({
      type: 'SYNC_FB_USER_ASSETS',
      payload: { fbUserId: 'fb-user-1', tokenId: 'token-1' },
    })
    mockAutomationJobFindById.mockResolvedValue(doc)
    mockFbTokenFindOne.mockReturnValue(leanResult({
      token: 'facebook-token',
      organizationId: 'org-a',
    }))

    await executeAutomationJobInline('job-1')

    expect(mockFbTokenFindOne).toHaveBeenCalledWith({
      $and: [
        { status: 'active' },
        { _id: 'token-1' },
        { organizationId: 'org-a' },
      ],
    })
    expect(mockSyncFacebookUserAssets).toHaveBeenCalledWith(
      'fb-user-1',
      'facebook-token',
      'token-1',
      'org-a',
      undefined,
      { force: true },
    )
    expect(doc.status).toBe('completed')
  })

  it('rejects raw access tokens in automation payloads', async () => {
    const doc = createJobDoc({
      type: 'SYNC_FB_USER_ASSETS',
      payload: { fbUserId: 'fb-user-1', accessToken: 'raw-token' },
    })
    mockAutomationJobFindById.mockResolvedValue(doc)

    await expect(executeAutomationJobInline('job-1')).rejects.toThrow('Raw accessToken is not allowed')

    expect(mockFbTokenFindOne).not.toHaveBeenCalled()
    expect(mockSyncFacebookUserAssets).not.toHaveBeenCalled()
    expect(doc.status).toBe('failed')
  })

  it('rejects scoped agent jobs when the agent belongs to another organization', async () => {
    const doc = createJobDoc({
      type: 'RUN_AGENT_AS_JOBS',
      payload: { agentId: 'agent-1' },
      organizationId: 'org-a',
    })
    mockAutomationJobFindById.mockResolvedValue(doc)
    mockAgentFindById.mockReturnValue(selectableLeanResult({
      organizationId: 'org-b',
      createdBy: 'user-2',
    }))

    await expect(executeAutomationJobInline('job-1')).rejects.toThrow('outside its organization')

    expect(doc.status).toBe('failed')
  })
})
