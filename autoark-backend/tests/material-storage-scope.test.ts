import {
  confirmUpload,
  confirmUploads,
  getPresignedUrl,
  getPresignedUrls,
} from '../src/controllers/material.controller'
import {
  generatePresignedUploadUrl,
  generatePresignedUploadUrls,
} from '../src/services/r2Storage.service'

jest.mock('../src/models/Material', () => ({
  __esModule: true,
  default: jest.fn(),
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
  getPublicUrlForKey: jest.fn((key: string) => `https://cdn.autoark.test/${key}`),
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

const createRequest = (body: any = {}) => ({
  body,
  user: {
    userId: '665000000000000000000002',
    organizationId: '665000000000000000000001',
  },
}) as any

describe('material storage tenant scoping', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('prefixes single presigned upload keys with the request organization', async () => {
    ;(generatePresignedUploadUrl as jest.Mock).mockResolvedValue({
      success: true,
      uploadUrl: 'https://upload.example',
      key: 'tenants/org-665000000000000000000001/ads/2026-06-01/file.jpg',
      publicUrl: 'https://cdn.example/file.jpg',
    })
    const res = createResponse()

    await getPresignedUrl(createRequest({
      fileName: 'creative.jpg',
      mimeType: 'image/jpeg',
      folder: 'ads',
    }), res as any)

    expect(generatePresignedUploadUrl).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'creative.jpg',
      mimeType: 'image/jpeg',
      folder: 'tenants/org-665000000000000000000001/ads',
    }))
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }))
  })

  it('prefixes batch presigned upload keys with the request organization', async () => {
    ;(generatePresignedUploadUrls as jest.Mock).mockResolvedValue({
      success: true,
      urls: [],
    })
    const res = createResponse()

    await getPresignedUrls(createRequest({
      folder: 'batch',
      files: [{ fileName: 'creative.mp4', mimeType: 'video/mp4', size: 123 }],
    }), res as any)

    expect(generatePresignedUploadUrls).toHaveBeenCalledWith(
      [{ fileName: 'creative.mp4', mimeType: 'video/mp4', size: 123 }],
      'tenants/org-665000000000000000000001/batch',
    )
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [] })
  })

  it('rejects direct upload confirmations outside the request organization prefix', async () => {
    const res = createResponse()

    await confirmUpload(createRequest({
      key: 'materials/2026-06-01/file.jpg',
      fileName: 'file.jpg',
      mimeType: 'image/jpeg',
    }), res as any)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: '素材存储路径不属于当前租户',
    })
  })

  it('records invalid batch confirmation keys as failed items', async () => {
    const res = createResponse()

    await confirmUploads(createRequest({
      files: [{
        key: 'tenants/org-other/materials/2026-06-01/file.jpg',
        fileName: 'file.jpg',
        mimeType: 'image/jpeg',
      }],
    }), res as any)

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        uploaded: [],
        failed: [{ fileName: 'file.jpg', error: '素材存储路径不属于当前租户' }],
        total: 1,
        successCount: 0,
        failCount: 1,
      },
    })
  })
})
