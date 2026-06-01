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
import { updateTaskAdsReviewStatus } from '../src/services/adReview.service'

const mockFacebookClient = facebookClient as jest.Mocked<typeof facebookClient>

const buildTokenQuery = (token: string | null) => {
  const lean = jest.fn().mockResolvedValue(token ? { token } : null)
  const sort = jest.fn().mockReturnValue({ lean })
  return { sort, lean }
}

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
})
