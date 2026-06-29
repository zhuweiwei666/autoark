import Material from '../src/models/Material'
import { getMaterialList, getReusable } from '../src/controllers/material.controller'
import { getReusableMaterials } from '../src/services/materialTracking.service'

jest.mock('../src/models/Material', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
    countDocuments: jest.fn(),
  },
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

const createResponse = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
})

const createRequest = (query: any = {}) => ({
  query,
  user: {
    userId: '665000000000000000000002',
    organizationId: '665000000000000000000001',
    role: 'admin',
  },
}) as any

describe('material reusable controller', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('caps reusable material recommendation limit before querying', async () => {
    const visibleMaterials = [{ _id: 'mat_1', name: 'Winner.jpg' }]
    const lean = jest.fn().mockResolvedValue(visibleMaterials)

    ;(getReusableMaterials as jest.Mock).mockResolvedValue([{ _id: 'mat_1' }])
    ;(Material.find as jest.Mock).mockReturnValue({ lean })

    const res = createResponse()

    await getReusable(createRequest({ limit: '9999' }), res as any)

    expect(getReusableMaterials).toHaveBeenCalledWith(expect.objectContaining({
      limit: 100,
      scopeFilter: expect.any(Object),
    }))
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: visibleMaterials,
    })
  })

  it('sanitizes reusable material filters before querying recommendations', async () => {
    const lean = jest.fn().mockResolvedValue([])

    ;(getReusableMaterials as jest.Mock).mockResolvedValue([])
    ;(Material.find as jest.Mock).mockReturnValue({ lean })

    const res = createResponse()

    await getReusable(createRequest({
      type: 'document',
      minRoas: 'Infinity',
      minSpend: 'NaN',
      minQualityScore: '-1',
      limit: '9999',
      sortBy: 'unsafeField',
    }), res as any)

    expect(getReusableMaterials).toHaveBeenCalledWith(expect.objectContaining({
      type: undefined,
      minRoas: 1,
      minSpend: 50,
      minQualityScore: 60,
      limit: 100,
      sortBy: 'qualityScore',
      scopeFilter: expect.any(Object),
    }))
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [],
    })
  })

  it('sanitizes material list filters before querying materials', async () => {
    const listChain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    }
    ;(Material.find as jest.Mock).mockReturnValue(listChain)
    ;(Material.countDocuments as jest.Mock).mockResolvedValue(0)

    const res = createResponse()

    await getMaterialList(createRequest({
      status: 'not-real-status',
      type: 'document',
      folder: { $ne: '默认' },
      tags: { $ne: 'safe' },
      search: '.*',
      limit: '9999',
      sortBy: 'unsafeField',
    }), res as any)

    const query = (Material.find as jest.Mock).mock.calls[0][0]
    const serialized = JSON.stringify(query)

    expect(serialized).toContain('"status":"uploaded"')
    expect(serialized).toContain('\\\\.\\\\*')
    expect(serialized).not.toContain('not-real-status')
    expect(serialized).not.toContain('document')
    expect(serialized).not.toContain('$ne')
    expect(listChain.sort).toHaveBeenCalledWith({ createdAt: -1 })
    expect(listChain.limit).toHaveBeenCalledWith(100)
    expect(Material.countDocuments).toHaveBeenCalledWith(query)
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        list: [],
        total: 0,
        page: 1,
        pageSize: 100,
        totalPages: 0,
      },
    })
  })
})
