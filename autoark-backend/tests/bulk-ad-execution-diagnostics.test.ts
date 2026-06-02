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
import CopywritingPackage from '../src/models/CopywritingPackage'
import CreativeGroup from '../src/models/CreativeGroup'
import FbToken from '../src/models/FbToken'
import {
  createAd,
  createAdCreative,
  createAdSet,
  createCampaign,
} from '../src/integration/facebook/bulkCreate.api'
import { executeTaskForAccount } from '../src/services/bulkAd.service'

const taskId = '665000000000000000000701'

const buildTask = () => ({
  _id: taskId,
  organizationId: '665000000000000000000001',
  createdBy: '665000000000000000000002',
  items: [{
    accountId: '123',
    accountName: 'Account 123',
    status: 'pending',
    result: {},
  }],
  configSnapshot: {
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
