import {
  streamPublicMaterial,
} from '../src/controllers/material.controller'
import Material from '../src/models/Material'
import {
  getObjectFromR2,
} from '../src/services/r2Storage.service'

jest.mock('../src/models/Material', () => ({
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

const createResponse = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
  setHeader: jest.fn(),
  send: jest.fn(),
})

const createRequest = (key: string) => ({
  params: [key],
}) as any

const materialLookupResult = (result: any) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(result),
  }),
})

describe('public material stream scope', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('rejects traversal paths before querying storage', async () => {
    const res = createResponse()

    await streamPublicMaterial(createRequest('tenants/org-a/materials/../secret.jpg'), res as any)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(getObjectFromR2).not.toHaveBeenCalled()
  })

  it('rejects malformed encoded paths before querying storage', async () => {
    const res = createResponse()

    await streamPublicMaterial(createRequest('%E0%A4%A'), res as any)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(getObjectFromR2).not.toHaveBeenCalled()
  })

  it('does not read arbitrary R2 keys without a material record', async () => {
    ;(Material.findOne as jest.Mock).mockReturnValue(materialLookupResult(null))
    const res = createResponse()

    await streamPublicMaterial(createRequest('tenants/org-a/materials/2026-06-01/missing.jpg'), res as any)

    expect(Material.findOne).toHaveBeenCalledWith({
      'storage.key': 'tenants/org-a/materials/2026-06-01/missing.jpg',
      status: { $ne: 'deleted' },
    })
    expect(res.status).toHaveBeenCalledWith(404)
    expect(getObjectFromR2).not.toHaveBeenCalled()
  })

  it('streams registered non-deleted materials from R2', async () => {
    ;(Material.findOne as jest.Mock).mockReturnValue(materialLookupResult({
      _id: '665000000000000000000101',
      storage: { key: 'tenants/org-a/materials/2026-06-01/file.jpg' },
    }))
    ;(getObjectFromR2 as jest.Mock).mockResolvedValue({
      ContentType: 'image/jpeg',
      ContentLength: 4,
      Body: Buffer.from('test'),
    })
    const res = createResponse()

    await streamPublicMaterial(createRequest('tenants%2Forg-a%2Fmaterials%2F2026-06-01%2Ffile.jpg'), res as any)

    expect(getObjectFromR2).toHaveBeenCalledWith('tenants/org-a/materials/2026-06-01/file.jpg')
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg')
    expect(res.setHeader).toHaveBeenCalledWith('Content-Length', '4')
    expect(res.send).toHaveBeenCalledWith(Buffer.from('test'))
  })
})
