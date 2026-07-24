jest.mock('../src/integration/facebook/bulkCreate.api', () => ({
  createCampaign: jest.fn(),
  createAdSet: jest.fn(),
  createAdCreative: jest.fn(),
  createAd: jest.fn(),
  uploadImageFromUrl: jest.fn(),
  uploadVideoFromUrl: jest.fn(),
}))

jest.mock('../src/integration/facebook/facebookClient', () => ({
  facebookClient: {
    get: jest.fn(),
  },
}))

import Ad from '../src/models/Ad'
import AdMaterialMapping from '../src/models/AdMaterialMapping'
import AdTask from '../src/models/AdTask'
import Account from '../src/models/Account'
import CopywritingPackage from '../src/models/CopywritingPackage'
import CreativeGroup from '../src/models/CreativeGroup'
import FbToken from '../src/models/FbToken'
import User, { UserRole } from '../src/models/User'
import {
  createAd,
  createAdCreative,
  createAdSet,
  createCampaign,
  uploadVideoFromUrl,
} from '../src/integration/facebook/bulkCreate.api'
import { executeTaskForAccount, retryFailedItems } from '../src/services/bulkAd.service'

const taskId = '665000000000000000000701'
const facebookTokenId = '665000000000000000000702'
const facebookTokenOwnerUserId = '665000000000000000000703'
const publisherUserId = '665000000000000000000704'

const buildTask = () => ({
  _id: taskId,
  organizationId: '665000000000000000000001',
  createdBy: publisherUserId,
  items: [{
    accountId: '123',
    accountName: 'Account 123',
    status: 'pending',
    result: {},
  }],
  configSnapshot: {
    facebookTokenId,
    facebookTokenOwnerUserId,
    accounts: [{
      accountId: '123',
      accountName: 'Account 123',
      pageId: 'page_1',
      pixelId: 'pixel_1',
      pixelName: 'Pixel 1',
      conversionEvent: 'PURCHASE',
    }],
    campaign: {
      nameTemplate: 'campaign_{accountName}',
      objective: 'OUTCOME_SALES',
      status: 'PAUSED',
      budgetOptimization: true,
      budgetType: 'DAILY',
      budget: 50,
    },
    adset: {
      inlineTargeting: { geo_locations: { countries: ['US'] } },
      nameTemplate: 'adset_{accountName}',
      multiplier: 1,
      optimizationGoal: 'OFFSITE_CONVERSIONS',
      billingEvent: 'IMPRESSIONS',
      status: 'PAUSED',
    },
    ad: {
      creativeGroupIds: ['665000000000000000000711'],
      copywritingPackageIds: ['665000000000000000000712'],
      nameTemplate: 'ad_{index}',
      status: 'PAUSED',
    },
    publishStrategy: {},
  },
})

describe('bulk ad execution diagnostics', () => {
  beforeEach(() => {
    jest.spyOn(Account, 'findOne').mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: '665000000000000000000705',
        }),
      }),
    } as any)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
  })

  it('stores structured Meta sub-step diagnostics when no ads are created', async () => {
    const task = buildTask()
    jest.spyOn(AdTask, 'findById')
      .mockResolvedValueOnce(task as any)
      .mockResolvedValueOnce(task as any)
    jest.spyOn(AdTask, 'findOneAndUpdate').mockResolvedValue(task as any)
    jest.spyOn(AdTask, 'findByIdAndUpdate').mockResolvedValue(task as any)
    jest.spyOn(FbToken, 'findOne').mockResolvedValue({
      token: 'fb_token',
      fbUserName: 'Tester',
    } as any)
    jest.spyOn(CreativeGroup, 'find').mockResolvedValue([{
      _id: '665000000000000000000711',
      name: 'Creative Group',
      materials: [{
        _id: '665000000000000000000713',
        type: 'image',
        name: 'Image 1',
        facebookImageHash: 'hash_1',
        status: 'uploaded',
      }],
    }] as any)
    jest.spyOn(CopywritingPackage, 'find').mockResolvedValue([{
      _id: '665000000000000000000712',
      name: 'Copy Package',
      links: { websiteUrl: 'https://example.com' },
      content: {
        primaryTexts: ['Primary'],
        headlines: ['Headline'],
        descriptions: ['Description'],
      },
      callToAction: 'SHOP_NOW',
    }] as any)
    jest.spyOn(Ad, 'findOneAndUpdate').mockResolvedValue(null as any)
    ;(createCampaign as jest.Mock).mockResolvedValue({ success: true, id: 'camp_1' })
    ;(createAdSet as jest.Mock).mockResolvedValue({ success: true, id: 'adset_1' })
    ;(createAdCreative as jest.Mock).mockResolvedValue({
      success: false,
      error: {
        code: 100,
        subcode: 1885316,
        message: 'Invalid image hash for this ad account',
        userMsg: '图片素材无法用于当前广告账户',
        type: 'OAuthException',
      },
    })
    ;(createAd as jest.Mock).mockResolvedValue({ success: true, id: 'ad_1' })

    await executeTaskForAccount(taskId, '123')

    expect(FbToken.findOne).toHaveBeenCalledWith({
      _id: facebookTokenId,
      status: 'active',
      organizationId: task.organizationId,
      userId: facebookTokenOwnerUserId,
    })
    const finalUpdate = (AdTask.findOneAndUpdate as jest.Mock).mock.calls.find((call: any[]) => (
      call[1]?.$set?.['items.$.errors']
    ))
    const storedErrors = finalUpdate?.[1]?.$set?.['items.$.errors'] || []

    expect(finalUpdate?.[1]?.$set).toMatchObject({
      'items.$.status': 'failed',
      'items.$.result.adIds': [],
      'items.$.result.createdCount': 0,
    })
    expect(storedErrors.map((error: any) => error.errorCode)).toEqual([
      'CREATIVE_OR_MATERIAL_FAILED',
      'NO_ADS_CREATED',
    ])
    expect(storedErrors[0]).toMatchObject({
      entityType: 'creative',
      rawCode: 100,
      rawSubcode: 1885316,
      source: 'meta',
    })
    expect(storedErrors[0].operatorMessage).toContain('Invalid image hash')
  })

  it('does not send displayLink as video_data.caption', async () => {
    const task = buildTask()
    jest.spyOn(AdTask, 'findById')
      .mockResolvedValueOnce(task as any)
      .mockResolvedValueOnce(task as any)
    jest.spyOn(AdTask, 'findOneAndUpdate').mockResolvedValue(task as any)
    jest.spyOn(AdTask, 'findByIdAndUpdate').mockResolvedValue(task as any)
    jest.spyOn(FbToken, 'findOne').mockResolvedValue({ token: 'fb_token' } as any)
    jest.spyOn(CreativeGroup, 'find').mockResolvedValue([{
      _id: '665000000000000000000711',
      name: 'Video Group',
      materials: [{
        _id: '665000000000000000000713',
        type: 'video',
        name: 'Video 1',
        facebookVideoId: 'video_1',
        thumbnailUrl: 'https://example.com/thumb.jpg',
        status: 'uploaded',
      }],
    }] as any)
    jest.spyOn(CopywritingPackage, 'find').mockResolvedValue([{
      _id: '665000000000000000000712',
      name: 'Copy Package',
      links: { websiteUrl: 'https://example.com', displayLink: 'Leyon' },
      content: {
        primaryTexts: ['Primary'],
        headlines: ['Headline'],
        descriptions: ['Description'],
      },
      callToAction: 'SHOP_NOW',
    }] as any)
    jest.spyOn(Ad, 'findOneAndUpdate').mockResolvedValue({} as any)
    jest.spyOn(AdMaterialMapping as any, 'recordMapping').mockResolvedValue({} as any)
    ;(createCampaign as jest.Mock).mockResolvedValue({ success: true, id: 'camp_1' })
    ;(createAdSet as jest.Mock).mockResolvedValue({ success: true, id: 'adset_1' })
    ;(createAdCreative as jest.Mock).mockResolvedValue({ success: true, id: 'creative_1' })
    ;(createAd as jest.Mock).mockResolvedValue({ success: true, id: 'ad_1' })

    await executeTaskForAccount(taskId, '123')

    expect(createAdCreative).toHaveBeenCalledWith(expect.objectContaining({
      objectStorySpec: expect.objectContaining({
        video_data: expect.not.objectContaining({ caption: expect.anything() }),
      }),
    }))
    const creativePayload = (createAdCreative as jest.Mock).mock.calls[0][0]
    expect(creativePayload.objectStorySpec.link_data).toBeUndefined()
    expect(creativePayload.objectStorySpec.video_data.caption).toBeUndefined()
  })

  it('marks an account failed and preserves diagnostics when any material is skipped', async () => {
    const task = buildTask()
    jest.spyOn(AdTask, 'findById')
      .mockResolvedValueOnce(task as any)
      .mockResolvedValueOnce(task as any)
    jest.spyOn(AdTask, 'findOneAndUpdate').mockResolvedValue(task as any)
    jest.spyOn(AdTask, 'findByIdAndUpdate').mockResolvedValue(task as any)
    jest.spyOn(FbToken, 'findOne').mockResolvedValue({ token: 'fb_token' } as any)
    jest.spyOn(CreativeGroup, 'find').mockResolvedValue([{
      _id: '665000000000000000000711',
      name: 'Mixed Group',
      materials: [
        {
          _id: '665000000000000000000713',
          type: 'image',
          name: 'Image 1',
          facebookImageHash: 'hash_1',
          status: 'uploaded',
        },
        {
          _id: '665000000000000000000714',
          type: 'video',
          name: 'Video 1',
          url: 'https://example.com/video.mp4',
          status: 'uploaded',
        },
      ],
    }] as any)
    jest.spyOn(CopywritingPackage, 'find').mockResolvedValue([{
      _id: '665000000000000000000712',
      name: 'Copy Package',
      links: { websiteUrl: 'https://example.com' },
      content: {
        primaryTexts: ['Primary'],
        headlines: ['Headline'],
        descriptions: ['Description'],
      },
      callToAction: 'SHOP_NOW',
    }] as any)
    jest.spyOn(Ad, 'findOneAndUpdate').mockResolvedValue({} as any)
    jest.spyOn(AdMaterialMapping as any, 'recordMapping').mockResolvedValue({} as any)
    ;(uploadVideoFromUrl as jest.Mock).mockResolvedValue({
      success: false,
      error: {
        code: 100,
        message: 'Video upload failed',
        userMsg: '视频上传失败',
      },
    })
    ;(createCampaign as jest.Mock).mockResolvedValue({ success: true, id: 'camp_1' })
    ;(createAdSet as jest.Mock).mockResolvedValue({ success: true, id: 'adset_1' })
    ;(createAdCreative as jest.Mock).mockResolvedValue({ success: true, id: 'creative_1' })
    ;(createAd as jest.Mock).mockResolvedValue({ success: true, id: 'ad_1' })

    await executeTaskForAccount(taskId, '123')

    const finalUpdate = (AdTask.findOneAndUpdate as jest.Mock).mock.calls.find((call: any[]) => (
      call[1]?.$set?.['items.$.result.expectedCount']
    ))
    expect(finalUpdate?.[1]?.$set).toMatchObject({
      'items.$.status': 'failed',
      'items.$.result.expectedCount': 2,
      'items.$.result.createdCount': 1,
      'items.$.result.skippedCount': 1,
    })
    expect(finalUpdate?.[1]?.$set?.['items.$.errors']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ errorCode: 'CREATIVE_OR_MATERIAL_FAILED' }),
        expect.objectContaining({ errorCode: 'BULK_MATERIALS_INCOMPLETE' }),
      ]),
    )
  })

  it('stops before creating a campaign when the preflight token is no longer active', async () => {
    const task = buildTask()
    jest.spyOn(AdTask, 'findById').mockResolvedValue(task as any)
    jest.spyOn(AdTask, 'findOneAndUpdate').mockResolvedValue(task as any)
    jest.spyOn(FbToken, 'findOne').mockResolvedValue(null)

    await expect(executeTaskForAccount(taskId, '123')).rejects.toThrow(
      '预检使用的 Facebook 个人号授权已失效，请重新验证草稿后再发布',
    )

    expect(FbToken.findOne).toHaveBeenCalledWith({
      _id: facebookTokenId,
      status: 'active',
      organizationId: task.organizationId,
      userId: facebookTokenOwnerUserId,
    })
    expect(createCampaign).not.toHaveBeenCalled()
    expect(AdTask.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('stops before token lookup when the task account is outside the organization inventory', async () => {
    const task = buildTask()
    jest.spyOn(AdTask, 'findById').mockResolvedValue(task as any)
    ;(Account.findOne as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    })
    const tokenLookup = jest.spyOn(FbToken, 'findOne')
    const taskUpdate = jest.spyOn(AdTask, 'findOneAndUpdate')

    await expect(executeTaskForAccount(taskId, '123')).rejects.toThrow(
      '广告账户 Account 123 不属于当前组织，任务已停止',
    )

    expect(tokenLookup).not.toHaveBeenCalled()
    expect(createCampaign).not.toHaveBeenCalled()
    expect(taskUpdate).not.toHaveBeenCalled()
  })

  it('stores organization scope on created ads and material mappings', async () => {
    const task = buildTask()
    jest.spyOn(AdTask, 'findById')
      .mockResolvedValueOnce(task as any)
      .mockResolvedValueOnce(task as any)
    jest.spyOn(AdTask, 'findOneAndUpdate').mockResolvedValue(task as any)
    jest.spyOn(AdTask, 'findByIdAndUpdate').mockResolvedValue(task as any)
    jest.spyOn(FbToken, 'findOne').mockResolvedValue({
      token: 'fb_token',
      fbUserName: 'Tester',
    } as any)
    jest.spyOn(CreativeGroup, 'find').mockResolvedValue([{
      _id: '665000000000000000000711',
      name: 'Creative Group',
      materials: [{
        _id: '665000000000000000000713',
        type: 'image',
        name: 'Image 1',
        facebookImageHash: 'hash_1',
        status: 'uploaded',
      }],
    }] as any)
    jest.spyOn(CopywritingPackage, 'find').mockResolvedValue([{
      _id: '665000000000000000000712',
      name: 'Copy Package',
      links: { websiteUrl: 'https://example.com' },
      content: {
        primaryTexts: ['Primary'],
        headlines: ['Headline'],
        descriptions: ['Description'],
      },
      callToAction: 'SHOP_NOW',
    }] as any)
    jest.spyOn(Ad, 'findOneAndUpdate').mockResolvedValue({} as any)
    jest.spyOn(AdMaterialMapping as any, 'recordMapping').mockResolvedValue({} as any)
    ;(createCampaign as jest.Mock).mockResolvedValue({ success: true, id: 'camp_1' })
    ;(createAdSet as jest.Mock).mockResolvedValue({ success: true, id: 'adset_1' })
    ;(createAdCreative as jest.Mock).mockResolvedValue({ success: true, id: 'creative_1' })
    ;(createAd as jest.Mock).mockResolvedValue({ success: true, id: 'ad_1' })

    await executeTaskForAccount(taskId, '123')

    expect(CreativeGroup.find).toHaveBeenCalledWith({
      $and: [
        { _id: { $in: ['665000000000000000000711'] } },
        { organizationId: task.organizationId },
      ],
    })
    expect(CopywritingPackage.find).toHaveBeenCalledWith({
      $and: [
        { _id: { $in: ['665000000000000000000712'] } },
        { organizationId: task.organizationId },
      ],
    })
    expect(Ad.findOneAndUpdate).toHaveBeenCalledWith(
      { adId: 'ad_1' },
      { $set: expect.objectContaining({
        adId: 'ad_1',
        accountId: '123',
        organizationId: task.organizationId,
        taskId,
        materialId: '665000000000000000000713',
      }) },
      { upsert: true },
    )
    expect((AdMaterialMapping as any).recordMapping).toHaveBeenCalledWith(expect.objectContaining({
      adId: 'ad_1',
      accountId: '123',
      organizationId: task.organizationId,
      taskId,
      materialId: '665000000000000000000713',
    }))
  })

  it('uses the super-admin publisher scope for legacy assets without an organization', async () => {
    const task = buildTask()
    delete (task as any).organizationId
    jest.spyOn(AdTask, 'findById')
      .mockResolvedValueOnce(task as any)
      .mockResolvedValueOnce(task as any)
    jest.spyOn(AdTask, 'findOneAndUpdate').mockResolvedValue(task as any)
    jest.spyOn(AdTask, 'findByIdAndUpdate').mockResolvedValue(task as any)
    jest.spyOn(User, 'findById').mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ role: UserRole.SUPER_ADMIN }),
      }),
    } as any)
    jest.spyOn(FbToken, 'findOne').mockResolvedValue({ token: 'fb_token' } as any)
    jest.spyOn(CreativeGroup, 'find').mockResolvedValue([{
      _id: '665000000000000000000711',
      name: 'Legacy creative group',
      materials: [{
        _id: '665000000000000000000713',
        type: 'image',
        name: 'Image 1',
        facebookImageHash: 'hash_1',
        status: 'uploaded',
      }],
    }] as any)
    jest.spyOn(CopywritingPackage, 'find').mockResolvedValue([{
      _id: '665000000000000000000712',
      name: 'Legacy copywriting package',
      links: { websiteUrl: 'https://example.com' },
      content: {
        primaryTexts: ['Primary'],
        headlines: ['Headline'],
        descriptions: ['Description'],
      },
      callToAction: 'SHOP_NOW',
    }] as any)
    jest.spyOn(Ad, 'findOneAndUpdate').mockResolvedValue({} as any)
    jest.spyOn(AdMaterialMapping as any, 'recordMapping').mockResolvedValue({} as any)
    ;(createCampaign as jest.Mock).mockResolvedValue({ success: true, id: 'camp_1' })
    ;(createAdSet as jest.Mock).mockResolvedValue({ success: true, id: 'adset_1' })
    ;(createAdCreative as jest.Mock).mockResolvedValue({ success: true, id: 'creative_1' })
    ;(createAd as jest.Mock).mockResolvedValue({ success: true, id: 'ad_1' })

    await executeTaskForAccount(taskId, '123')

    expect(CreativeGroup.find).toHaveBeenCalledWith({
      _id: { $in: ['665000000000000000000711'] },
    })
    expect(CopywritingPackage.find).toHaveBeenCalledWith({
      _id: { $in: ['665000000000000000000712'] },
    })
    expect(createCampaign).toHaveBeenCalled()
    expect(createAdSet).toHaveBeenCalled()
  })

  it('fails resource preflight before creating Meta objects', async () => {
    const task = buildTask()
    jest.spyOn(AdTask, 'findById').mockResolvedValue(task as any)
    jest.spyOn(AdTask, 'findOneAndUpdate').mockResolvedValue(task as any)
    jest.spyOn(AdTask, 'findByIdAndUpdate').mockResolvedValue(task as any)
    jest.spyOn(FbToken, 'findOne').mockResolvedValue({ token: 'fb_token' } as any)
    jest.spyOn(CreativeGroup, 'find').mockResolvedValue([{
      _id: '665000000000000000000711',
      materials: [],
    }] as any)
    jest.spyOn(CopywritingPackage, 'find').mockResolvedValue([])

    await expect(executeTaskForAccount(taskId, '123')).rejects.toThrow(
      'Copywriting packages not found or inaccessible',
    )

    expect(createCampaign).not.toHaveBeenCalled()
    expect(createAdSet).not.toHaveBeenCalled()
    const failureUpdate = (AdTask.findOneAndUpdate as jest.Mock).mock.calls.find((call: any[]) => (
      call[1]?.$set?.['items.$.errors']
    ))
    expect(failureUpdate?.[1]?.$set?.['items.$.errors']?.[0]?.errorCode).toBe('BULK_ASSET_NOT_FOUND')
  })

  it('blocks retry of the legacy resource error after partial Meta creation', async () => {
    const task = buildTask()
    task.status = 'failed'
    task.items[0].status = 'failed'
    task.items[0].result = {
      campaignId: 'camp_existing',
      adsetIds: ['adset_existing'],
    }
    task.items[0].errors = [{
      errorCode: 'EXECUTION_ERROR',
      errorMessage: 'No copywriting packages found',
      retryable: true,
    }]
    jest.spyOn(AdTask, 'findOne').mockResolvedValue(task as any)

    await expect(retryFailedItems(taskId, {
      organizationId: task.organizationId,
    })).rejects.toThrow('没有可重试的失败项')
  })

  it('falls back to one adset when a task snapshot has an invalid multiplier', async () => {
    const task = buildTask()
    task.configSnapshot.adset.multiplier = 'not-a-number' as any
    jest.spyOn(AdTask, 'findById')
      .mockResolvedValueOnce(task as any)
      .mockResolvedValueOnce(task as any)
    jest.spyOn(AdTask, 'findOneAndUpdate').mockResolvedValue(task as any)
    jest.spyOn(AdTask, 'findByIdAndUpdate').mockResolvedValue(task as any)
    jest.spyOn(FbToken, 'findOne').mockResolvedValue({
      token: 'fb_token',
      fbUserName: 'Tester',
    } as any)
    jest.spyOn(CreativeGroup, 'find').mockResolvedValue([{
      _id: '665000000000000000000711',
      name: 'Creative Group',
      materials: [{
        _id: '665000000000000000000713',
        type: 'image',
        name: 'Image 1',
        facebookImageHash: 'hash_1',
        status: 'uploaded',
      }],
    }] as any)
    jest.spyOn(CopywritingPackage, 'find').mockResolvedValue([{
      _id: '665000000000000000000712',
      name: 'Copy Package',
      links: { websiteUrl: 'https://example.com' },
      content: {
        primaryTexts: ['Primary'],
        headlines: ['Headline'],
        descriptions: ['Description'],
      },
      callToAction: 'SHOP_NOW',
    }] as any)
    jest.spyOn(Ad, 'findOneAndUpdate').mockResolvedValue({} as any)
    jest.spyOn(AdMaterialMapping as any, 'recordMapping').mockResolvedValue({} as any)
    ;(createCampaign as jest.Mock).mockResolvedValue({ success: true, id: 'camp_1' })
    ;(createAdSet as jest.Mock).mockResolvedValue({ success: true, id: 'adset_1' })
    ;(createAdCreative as jest.Mock).mockResolvedValue({ success: true, id: 'creative_1' })
    ;(createAd as jest.Mock).mockResolvedValue({ success: true, id: 'ad_1' })

    await executeTaskForAccount(taskId, '123')

    expect(createAdSet).toHaveBeenCalledTimes(1)
    expect(createAdSet).toHaveBeenCalledWith(expect.objectContaining({
      name: 'adset_Account 123',
    }))
  })
})
