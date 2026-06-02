import {
  recordFbMapping,
  recordAdMapping,
  recordAdMappingsBatch,
} from '../src/controllers/material.controller'
import {
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
})
