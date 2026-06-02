import Material from '../src/models/Material'
import { getReusable } from '../src/controllers/material.controller'
import { getReusableMaterials } from '../src/services/materialTracking.service'

jest.mock('../src/models/Material', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
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
})
