import {
  aggregateMetrics,
  createFolder,
  moveToFolder,
  updateMaterial,
} from '../src/controllers/material.controller'
import Material from '../src/models/Material'
import Folder from '../src/models/Folder'
import { UserRole } from '../src/models/User'
import { aggregateMetricsToMaterials } from '../src/services/materialTracking.service'

jest.mock('../src/models/Material', () => ({
  __esModule: true,
  default: {
    findOneAndUpdate: jest.fn(),
    updateMany: jest.fn(),
  },
}))

jest.mock('../src/models/Folder', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
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

const createRequest = (body: any = {}, params: any = {}) => ({
  body,
  params,
  user: {
    userId: '665000000000000000000002',
    organizationId: '665000000000000000000001',
  },
}) as any

const scopedPredicate = (query: any) => query?.$and?.[0] || query

describe('material metadata sanitization', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('sanitizes material metadata updates before saving', async () => {
    ;(Material.findOneAndUpdate as jest.Mock).mockResolvedValue({ _id: 'mat_1' })
    const res = createResponse()

    await updateMaterial(createRequest({
      name: '  Launch Creative  ',
      tags: ['winner', ' winner ', 'very-long-tag-value-that-should-be-truncated-to-forty-characters', { $ne: '' }],
      folder: '../Q2//Winners/../../Final',
      notes: `  ${'n'.repeat(2500)}  `,
      status: 'deleted',
      metrics: { totalSpend: 999999 },
      organizationId: '665000000000000000000099',
      createdBy: 'attacker',
    }, { id: 'mat_1' }), res as any)

    const update = (Material.findOneAndUpdate as jest.Mock).mock.calls[0][1]
    expect(update).toMatchObject({
      name: 'Launch Creative',
      tags: ['winner', 'very-long-tag-value-that-should-be-trunc'],
      folder: 'Q2/Winners/Final',
    })
    expect(update.notes).toHaveLength(2000)
    expect(update).not.toHaveProperty('status')
    expect(update).not.toHaveProperty('metrics')
    expect(update).not.toHaveProperty('organizationId')
    expect(update).not.toHaveProperty('createdBy')
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { _id: 'mat_1' } })
  })

  it('sanitizes batch move ids and target folder', async () => {
    ;(Material.updateMany as jest.Mock).mockResolvedValue({ modifiedCount: 2 })
    const res = createResponse()

    await moveToFolder(createRequest({
      ids: ['mat_1', { $ne: null }, 'mat_1', 'mat_2'],
      folder: '../Archive//2026/../../Q2',
    }), res as any)

    expect(scopedPredicate((Material.updateMany as jest.Mock).mock.calls[0][0])).toEqual({
      _id: { $in: ['mat_1', 'mat_2'] },
      status: 'uploaded',
    })
    expect((Material.updateMany as jest.Mock).mock.calls[0][1]).toEqual({ folder: 'Archive/2026/Q2' })
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { modifiedCount: 2 },
    })
  })

  it('rejects folder names that try to create nested paths', async () => {
    const res = createResponse()

    await createFolder(createRequest({ name: 'Parent/Child' }), res as any)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ success: false, error: '请输入文件夹名称' })
    expect(Folder.findOne).not.toHaveBeenCalled()
  })

  it('sanitizes manual material aggregation dates before running attribution', async () => {
    ;(aggregateMetricsToMaterials as jest.Mock).mockResolvedValue({
      processed: 0,
      matchedByAdMapping: 0,
      matchedByFbId: 0,
      unmatched: 0,
    })
    const res = createResponse()

    await aggregateMetrics({
      ...createRequest({ date: '2026-02-31' }),
      user: {
        userId: '665000000000000000000002',
        role: UserRole.SUPER_ADMIN,
      },
    } as any, res as any)

    const [targetDate] = (aggregateMetricsToMaterials as jest.Mock).mock.calls[0]
    expect(targetDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(targetDate).not.toBe('2026-02-31')
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }))
  })
})
