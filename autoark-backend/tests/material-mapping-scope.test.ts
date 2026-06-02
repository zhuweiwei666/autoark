import {
  recordFbMapping,
  recordAdMapping,
  recordAdMappingsBatch,
} from '../src/controllers/material.controller'
import {
  recordFacebookMapping,
  recordAdMaterialMapping,
  recordAdMaterialMappings,
} from '../src/services/materialTracking.service'

jest.mock('../src/models/Material', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    find: jest.fn(),
  },
}))

jest.mock('../src/models/Account', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
  },
}))

jest.mock('../src/models/Ad', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
  },
}))

jest.mock('../src/models/Folder', () => ({
  __esModule: true,
  default: {},
}))

jest.mock('../src/services/r2Storage.service', () => ({
  uploadToR2: jest.fn(),
  deleteFromR2: jest.fn(),
  getObjectFromR2: jest.fn(),
  checkR2Config: jest.fn(),
  generatePresignedUploadUrl: jest.fn(),
  generatePresignedUploadUrls: jest.fn(),
  getPublicUrlForKey: jest.fn(),
}))

jest.mock('../src/services/materialTracking.service', () => ({
  calculateFingerprint: jest.fn(),
  checkDuplicate: jest.fn(),
  recordFacebookMapping: jest.fn(),
  findMaterialByFacebookId: jest.fn(),
  getReusableMaterials: jest.fn(),
  getMaterialFullData: jest.fn(),
  aggregateMetricsToMaterials: jest.fn(),
  recordAdMaterialMapping: jest.fn(),
  recordAdMaterialMappings: jest.fn(),
}))

import Material from '../src/models/Material'
import Account from '../src/models/Account'
import Ad from '../src/models/Ad'

const createResponse = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
})

const createRequest = (body: any = {}) => ({
  body,
  user: {
    userId: '665000000000000000000002',
    organizationId: '665000000000000000000001',
  },
}) as any

const findOneResult = (result: any) => ({
  lean: jest.fn().mockResolvedValue(result),
})

const findResult = (result: any) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(result),
  }),
})

const scopedLookupResult = (result: any) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(result),
  }),
})

describe('material ad mapping tenant scoping', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('passes material organizationId when recording a single ad mapping', async () => {
    ;(Material.findOne as jest.Mock).mockReturnValue(findOneResult({
      _id: '665000000000000000000101',
      organizationId: { toString: () => '665000000000000000000001' },
    }))
    ;(Ad.findOne as jest.Mock).mockReturnValue(scopedLookupResult(null))
    ;(Account.findOne as jest.Mock).mockReturnValue(scopedLookupResult({
      accountId: '123',
      organizationId: '665000000000000000000001',
    }))
    ;(recordAdMaterialMapping as jest.Mock).mockResolvedValue(true)
    const res = createResponse()

    await recordAdMapping(createRequest({
      adId: 'ad_1',
      materialId: '665000000000000000000101',
      accountId: '123',
    }), res as any)

    expect(recordAdMaterialMapping).toHaveBeenCalledWith(expect.objectContaining({
      adId: 'ad_1',
      materialId: '665000000000000000000101',
      organizationId: '665000000000000000000001',
      accountId: '123',
    }))
    expect(res.json).toHaveBeenCalledWith({ success: true, message: '映射记录成功' })
  })

  it('sanitizes single ad mapping payloads before recording', async () => {
    ;(Material.findOne as jest.Mock).mockReturnValue(findOneResult({
      _id: '665000000000000000000101',
      organizationId: { toString: () => '665000000000000000000001' },
    }))
    ;(Ad.findOne as jest.Mock).mockReturnValue(scopedLookupResult(null))
    ;(Account.findOne as jest.Mock).mockReturnValue(scopedLookupResult({
      accountId: 'act_123',
      organizationId: '665000000000000000000001',
    }))
    ;(recordAdMaterialMapping as jest.Mock).mockResolvedValue(true)
    const res = createResponse()

    await recordAdMapping(createRequest({
      adId: '  ad_1  ',
      materialId: '665000000000000000000101',
      accountId: '  act_123  ',
      campaignId: '  campaign_1  ',
      adsetId: '  adset_1  ',
      creativeId: '  creative_1  ',
      materialType: 'carousel',
      materialName: `  ${'n'.repeat(200)}  `,
      materialUrl: `  https://cdn.example.com/${'u'.repeat(3000)}  `,
      fbImageHash: '  hash_1  ',
      fbVideoId: { $ne: '' },
      publishedBy: `  ${'p'.repeat(200)}  `,
      taskId: 'not-object-id',
      organizationId: '665000000000000000000999',
      createdBy: 'attacker',
      status: 'deleted',
    }), res as any)

    const payload = (recordAdMaterialMapping as jest.Mock).mock.calls[0][0]
    expect(payload).toMatchObject({
      adId: 'ad_1',
      materialId: '665000000000000000000101',
      organizationId: '665000000000000000000001',
      accountId: 'act_123',
      campaignId: 'campaign_1',
      adsetId: 'adset_1',
      creativeId: 'creative_1',
      fbImageHash: 'hash_1',
    })
    expect(payload.materialName).toHaveLength(160)
    expect(payload.materialUrl).toHaveLength(2048)
    expect(payload.publishedBy).toHaveLength(120)
    expect(payload).not.toHaveProperty('materialType')
    expect(payload).not.toHaveProperty('fbVideoId')
    expect(payload).not.toHaveProperty('taskId')
    expect(payload).not.toHaveProperty('createdBy')
    expect(payload).not.toHaveProperty('status')
    expect(res.json).toHaveBeenCalledWith({ success: true, message: '映射记录成功' })
  })

  it('rejects single ad mappings to accounts outside the material organization', async () => {
    ;(Material.findOne as jest.Mock).mockReturnValue(findOneResult({
      _id: '665000000000000000000101',
      organizationId: { toString: () => '665000000000000000000001' },
    }))
    ;(Ad.findOne as jest.Mock).mockReturnValue(scopedLookupResult(null))
    ;(Account.findOne as jest.Mock).mockReturnValue(scopedLookupResult(null))
    ;(recordAdMaterialMapping as jest.Mock).mockResolvedValue(true)
    const res = createResponse()

    await recordAdMapping(createRequest({
      adId: 'ad_1',
      materialId: '665000000000000000000101',
      accountId: 'act_other_org',
    }), res as any)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: '广告账户不存在或无权访问',
    })
    expect(recordAdMaterialMapping).not.toHaveBeenCalled()
  })

  it('adds material organizationId to every visible batch mapping', async () => {
    ;(Material.find as jest.Mock).mockReturnValue(findResult([
      {
        _id: { toString: () => '665000000000000000000101' },
        organizationId: { toString: () => '665000000000000000000001' },
      },
    ]))
    ;(Ad.findOne as jest.Mock).mockReturnValue(scopedLookupResult({
      adId: 'ad_1',
      accountId: '123',
      organizationId: '665000000000000000000001',
    }))
    ;(recordAdMaterialMappings as jest.Mock).mockResolvedValue({ success: 1, failed: 0 })
    const res = createResponse()

    await recordAdMappingsBatch(createRequest({
      mappings: [
        { adId: 'ad_1', materialId: '665000000000000000000101' },
        { adId: 'ad_2', materialId: '665000000000000000000999' },
      ],
    }), res as any)

    expect(recordAdMaterialMappings).toHaveBeenCalledWith([
      expect.objectContaining({
        adId: 'ad_1',
        materialId: '665000000000000000000101',
        organizationId: '665000000000000000000001',
      }),
    ])
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: { success: 1, failed: 0 },
      filteredMappingCount: 1,
    }))
  })

  it('sanitizes batch ad mappings before recording', async () => {
    ;(Material.find as jest.Mock).mockReturnValue(findResult([
      {
        _id: { toString: () => '665000000000000000000101' },
        organizationId: { toString: () => '665000000000000000000001' },
      },
    ]))
    ;(Ad.findOne as jest.Mock).mockReturnValue(scopedLookupResult({
      adId: 'ad_1',
      accountId: 'act_1',
      organizationId: '665000000000000000000001',
    }))
    ;(recordAdMaterialMappings as jest.Mock).mockResolvedValue({ success: 1, failed: 0 })
    const res = createResponse()

    await recordAdMappingsBatch(createRequest({
      mappings: [
        {
          adId: '  ad_1  ',
          materialId: '665000000000000000000101',
          accountId: '  act_1  ',
          materialType: 'image',
          materialName: `  ${'m'.repeat(200)}  `,
          organizationId: '665000000000000000000999',
          createdBy: 'attacker',
          status: 'deleted',
        },
        {
          adId: 'ad_invalid',
          materialId: { $ne: null },
          accountId: 'act_1',
        },
      ],
    }), res as any)

    const payload = (recordAdMaterialMappings as jest.Mock).mock.calls[0][0][0]
    expect(payload).toMatchObject({
      adId: 'ad_1',
      materialId: '665000000000000000000101',
      accountId: 'act_1',
      materialType: 'image',
      organizationId: '665000000000000000000001',
    })
    expect(payload.materialName).toHaveLength(160)
    expect(payload).not.toHaveProperty('createdBy')
    expect(payload).not.toHaveProperty('status')
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      filteredMappingCount: 1,
    }))
  })

  it('rejects oversized batch mapping requests before querying', async () => {
    const res = createResponse()

    await recordAdMappingsBatch(createRequest({
      mappings: Array.from({ length: 501 }, (_, index) => ({
        adId: `ad_${index}`,
        materialId: '665000000000000000000101',
      })),
    }), res as any)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: '一次最多记录 500 条映射',
    })
    expect(Material.find).not.toHaveBeenCalled()
    expect(recordAdMaterialMappings).not.toHaveBeenCalled()
  })

  it('filters batch mappings whose accounts are outside the material organization', async () => {
    ;(Material.find as jest.Mock).mockReturnValue(findResult([
      {
        _id: { toString: () => '665000000000000000000101' },
        organizationId: { toString: () => '665000000000000000000001' },
      },
      {
        _id: { toString: () => '665000000000000000000102' },
        organizationId: { toString: () => '665000000000000000000001' },
      },
    ]))
    ;(Ad.findOne as jest.Mock).mockReturnValue(scopedLookupResult(null))
    ;(Account.findOne as jest.Mock)
      .mockReturnValueOnce(scopedLookupResult({
        accountId: 'act_1',
        organizationId: '665000000000000000000001',
      }))
      .mockReturnValueOnce(scopedLookupResult(null))
    ;(recordAdMaterialMappings as jest.Mock).mockResolvedValue({ success: 1, failed: 0 })
    const res = createResponse()

    await recordAdMappingsBatch(createRequest({
      mappings: [
        { adId: 'ad_1', materialId: '665000000000000000000101', accountId: 'act_1' },
        { adId: 'ad_2', materialId: '665000000000000000000102', accountId: 'act_other_org' },
      ],
    }), res as any)

    expect(recordAdMaterialMappings).toHaveBeenCalledWith([
      expect.objectContaining({
        adId: 'ad_1',
        materialId: '665000000000000000000101',
        organizationId: '665000000000000000000001',
        accountId: 'act_1',
      }),
    ])
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      filteredMappingCount: 1,
    }))
  })

  it('rejects facebook upload mappings to accounts outside the material organization', async () => {
    ;(Material.findOne as jest.Mock).mockReturnValue(findOneResult({
      _id: '665000000000000000000101',
      organizationId: { toString: () => '665000000000000000000001' },
    }))
    ;(Account.findOne as jest.Mock).mockReturnValue(scopedLookupResult(null))
    const res = createResponse()

    await recordFbMapping(createRequest({
      materialId: '665000000000000000000101',
      accountId: 'act_other_org',
      imageHash: 'image_hash_1',
    }), res as any)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: '广告账户不存在或无权访问',
    })
  })

  it('sanitizes facebook upload mapping payloads before recording', async () => {
    ;(Material.findOne as jest.Mock).mockReturnValue(findOneResult({
      _id: '665000000000000000000101',
      organizationId: { toString: () => '665000000000000000000001' },
    }))
    ;(Account.findOne as jest.Mock).mockReturnValue(scopedLookupResult({
      accountId: 'act_1',
      organizationId: '665000000000000000000001',
    }))
    ;(recordFacebookMapping as jest.Mock).mockResolvedValue(true)
    const res = createResponse()

    await recordFbMapping(createRequest({
      materialId: '  665000000000000000000101  ',
      accountId: '  act_1  ',
      imageHash: '  hash_1  ',
      videoId: { $ne: '' },
      organizationId: '665000000000000000000999',
    }), res as any)

    expect(recordFacebookMapping).toHaveBeenCalledWith(
      '665000000000000000000101',
      'act_1',
      { imageHash: 'hash_1' },
    )
    expect(res.json).toHaveBeenCalledWith({ success: true })
  })
})
