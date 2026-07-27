const mockFindOne = jest.fn()
const mockCreate = jest.fn()
const mockFindOneAndUpdate = jest.fn()
const mockFindById = jest.fn()
const mockFindByIdAndUpdate = jest.fn()
const mockAddJob = jest.fn()

jest.mock('../src/models/PlaybookGeneration', () => ({
  __esModule: true,
  default: {
    findOne: mockFindOne,
    create: mockCreate,
    findOneAndUpdate: mockFindOneAndUpdate,
    findById: mockFindById,
    findByIdAndUpdate: mockFindByIdAndUpdate,
  },
}))

jest.mock('../src/queue/optimizerPlaybook.queue', () => ({
  addOptimizerPlaybookJob: mockAddJob,
}))

import {
  processPlaybookGeneration,
  requestPlaybookGeneration,
} from '../src/services/optimizerPlaybookGeneration.service'

const leanResult = (value: any) => ({
  lean: jest.fn().mockResolvedValue(value),
})

describe('async optimizer playbook generation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('reuses and re-enqueues the active queued generation', async () => {
    const existing = {
      _id: '665000000000000000000001',
      optimizerId: 'buyer-a',
      status: 'queued',
    }
    mockFindOne.mockReturnValue(leanResult(existing))
    mockAddJob.mockResolvedValue({ id: 'job_1' })

    const result = await requestPlaybookGeneration({
      optimizerId: 'buyer-a',
      windowDays: 14,
    })

    expect(result).toEqual({ generation: existing, reused: true })
    expect(mockAddJob).toHaveBeenCalledWith(existing._id)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('persists the immutable playbook result and clears the active key', async () => {
    const generation = {
      _id: '665000000000000000000001',
      optimizerId: 'buyer-a',
      organizationId: '665000000000000000000002',
      windowDays: 14,
      refreshInsights: true,
      generatedBy: '665000000000000000000003',
    }
    const playbook = { _id: '665000000000000000000004', version: 3 }
    const completed = {
      ...generation,
      status: 'completed',
      playbookId: playbook._id,
    }
    mockFindOneAndUpdate.mockResolvedValue(generation)
    mockFindByIdAndUpdate.mockReturnValueOnce(leanResult(completed))
    const generator = jest.fn().mockResolvedValue(playbook)

    const result = await processPlaybookGeneration(generation._id, generator)

    expect(generator).toHaveBeenCalledWith({
      optimizerId: 'buyer-a',
      organizationId: generation.organizationId,
      windowDays: 14,
      refreshInsights: true,
      generatedBy: generation.generatedBy,
    })
    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
      generation._id,
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'completed',
          playbookId: playbook._id,
        }),
        $unset: { activeKey: 1 },
      }),
      { new: true },
    )
    expect(result).toEqual({ generation: completed, playbook })
  })

  it('marks a failed generation terminal without exposing token text', async () => {
    const generation = {
      _id: '665000000000000000000001',
      optimizerId: 'buyer-a',
      windowDays: 14,
      refreshInsights: true,
    }
    mockFindOneAndUpdate.mockResolvedValue(generation)
    mockFindByIdAndUpdate.mockReturnValue({ then: undefined })
    const generator = jest
      .fn()
      .mockRejectedValue(
        new Error('request failed access_token=VERY_SECRET&fields=spend'),
      )

    await expect(
      processPlaybookGeneration(generation._id, generator),
    ).rejects.toThrow('request failed')

    expect(mockFindByIdAndUpdate).toHaveBeenLastCalledWith(
      generation._id,
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'failed',
          error: 'request failed access_token=[REDACTED]&fields=spend',
        }),
        $unset: { activeKey: 1 },
      }),
    )
  })
})
