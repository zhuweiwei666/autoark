jest.mock('../src/integration/facebook/facebookClient', () => ({
  facebookClient: {
    get: jest.fn(),
  },
}))

import mongoose from 'mongoose'
import Ad from '../src/models/Ad'
import AdTask from '../src/models/AdTask'
import FbToken from '../src/models/FbToken'
import { facebookClient } from '../src/integration/facebook/facebookClient'
import {
  checkPendingAdsReview,
  refreshAllReviewStatus,
  updateTaskAdsReviewStatus,
} from '../src/services/adReview.service'

const mockFacebookClient = facebookClient as jest.Mocked<typeof facebookClient>

const buildTokenQuery = (token: string | null) => {
  const lean = jest.fn().mockResolvedValue(token ? { token } : null)
  const sort = jest.fn().mockReturnValue({ lean })
  return { sort, lean }
}

const limitedFind = (value: any[]) => ({
  limit: jest.fn().mockResolvedValue(value),
})

describe('ad review tenant scope', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
  })

  it('uses the task organization token when refreshing task ad review status', async () => {
    const organizationId = new mongoose.Types.ObjectId('665000000000000000000701')
    const taskId = new mongoose.Types.ObjectId('665000000000000000000702')
    const tokenQuery = buildTokenQuery('ORG_TOKEN')
    const task: any = {
      _id: taskId,
      organizationId,
      toObject: () => ({
        _id: taskId,
        organizationId,
        items: [{
          accountId: 'act_123',
          ads: [{ adId: 'ad_123' }],
          result: { adIds: ['ad_456'] },
        }],
      }),
    }

    jest.spyOn(AdTask, 'findById').mockResolvedValue(task)
    jest.spyOn(FbToken, 'findOne').mockReturnValue(tokenQuery as any)
    jest.spyOn(Ad, 'findOneAndUpdate').mockResolvedValue({} as any)
    jest.spyOn(AdTask, 'findByIdAndUpdate').mockResolvedValue({} as any)
    mockFacebookClient.get.mockResolvedValue({
      effective_status: 'ACTIVE',
      status: 'ACTIVE',
      name: 'Ad from scoped token',
    })

    const result = await updateTaskAdsReviewStatus(String(taskId))

    expect(FbToken.findOne).toHaveBeenCalledWith({ status: 'active', organizationId })
    expect(tokenQuery.sort).toHaveBeenCalledWith({ updatedAt: -1 })
    expect(mockFacebookClient.get).toHaveBeenCalledWith('/ad_123', expect.objectContaining({
      access_token: 'ORG_TOKEN',
    }))
    expect(mockFacebookClient.get).toHaveBeenCalledWith('/ad_456', expect.objectContaining({
      access_token: 'ORG_TOKEN',
    }))
    expect(Ad.findOneAndUpdate).toHaveBeenCalledWith(
      { adId: 'ad_123' },
      { $set: expect.objectContaining({ taskId: String(taskId), accountId: 'act_123', organizationId }) },
      { upsert: true },
    )
    expect(result).toMatchObject({
      total: 2,
      updated: 2,
      approved: 2,
      errors: [],
    })
  })

  it('does not call Meta when the task organization has no active token', async () => {
    const organizationId = new mongoose.Types.ObjectId('665000000000000000000711')
    const taskId = new mongoose.Types.ObjectId('665000000000000000000712')
    const tokenQuery = buildTokenQuery(null)
    const task: any = {
      _id: taskId,
      organizationId,
      toObject: () => ({
        _id: taskId,
        organizationId,
        items: [{ accountId: 'act_123', result: { adIds: ['ad_123'] } }],
      }),
    }

    jest.spyOn(AdTask, 'findById').mockResolvedValue(task)
    jest.spyOn(FbToken, 'findOne').mockReturnValue(tokenQuery as any)
    jest.spyOn(Ad, 'findOneAndUpdate').mockResolvedValue({} as any)

    const result = await updateTaskAdsReviewStatus(String(taskId))

    expect(FbToken.findOne).toHaveBeenCalledWith({ status: 'active', organizationId })
    expect(mockFacebookClient.get).not.toHaveBeenCalled()
    expect(Ad.findOneAndUpdate).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      total: 1,
      updated: 0,
      errors: ['没有可用的 Facebook Token'],
    })
  })

  it('uses each ad organization token when refreshing all review statuses', async () => {
    const orgA = new mongoose.Types.ObjectId('665000000000000000000721')
    const orgB = new mongoose.Types.ObjectId('665000000000000000000722')

    jest.spyOn(Ad, 'find').mockReturnValue(limitedFind([
      { adId: 'ad_a', organizationId: orgA },
      { adId: 'ad_b', organizationId: orgB },
    ]) as any)
    jest.spyOn(FbToken, 'findOne').mockImplementation((query: any) => (
      buildTokenQuery(String(query.organizationId) === String(orgA) ? 'TOKEN_A' : 'TOKEN_B') as any
    ))
    jest.spyOn(Ad, 'findOneAndUpdate').mockResolvedValue({} as any)
    mockFacebookClient.get.mockResolvedValue({
      effective_status: 'ACTIVE',
      status: 'ACTIVE',
      name: 'Scoped ad',
    })

    const result = await refreshAllReviewStatus()

    expect(FbToken.findOne).toHaveBeenCalledWith({ status: 'active', organizationId: orgA })
    expect(FbToken.findOne).toHaveBeenCalledWith({ status: 'active', organizationId: orgB })
    expect(mockFacebookClient.get).toHaveBeenCalledWith('/ad_a', expect.objectContaining({
      access_token: 'TOKEN_A',
    }))
    expect(mockFacebookClient.get).toHaveBeenCalledWith('/ad_b', expect.objectContaining({
      access_token: 'TOKEN_B',
    }))
    expect(result).toMatchObject({
      total: 2,
      updated: 2,
      errors: [],
    })
  })

  it('does not borrow another organization token when checking pending ads', async () => {
    const orgA = new mongoose.Types.ObjectId('665000000000000000000731')
    const orgB = new mongoose.Types.ObjectId('665000000000000000000732')

    jest.spyOn(Ad, 'find').mockReturnValue(limitedFind([
      { adId: 'ad_a', organizationId: orgA },
      { adId: 'ad_b', organizationId: orgB },
    ]) as any)
    jest.spyOn(FbToken, 'findOne').mockImplementation((query: any) => (
      buildTokenQuery(String(query.organizationId) === String(orgA) ? 'TOKEN_A' : null) as any
    ))
    jest.spyOn(Ad, 'findOneAndUpdate').mockResolvedValue({} as any)
    mockFacebookClient.get.mockResolvedValue({
      effective_status: 'ACTIVE',
      status: 'ACTIVE',
    })

    const result = await checkPendingAdsReview()

    expect(mockFacebookClient.get).toHaveBeenCalledTimes(1)
    expect(mockFacebookClient.get).toHaveBeenCalledWith('/ad_a', expect.objectContaining({
      access_token: 'TOKEN_A',
    }))
    expect(Ad.findOneAndUpdate).toHaveBeenCalledTimes(1)
    expect(result.checked).toBe(2)
    expect(result.updated).toBe(1)
    expect(result.errors).toContain(`组织 ${orgB} 没有可用的 Facebook Token`)
  })
})
