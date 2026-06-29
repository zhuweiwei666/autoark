import {
  deleteFolder,
  renameFolder,
} from '../src/controllers/material.controller'
import Material from '../src/models/Material'
import Folder from '../src/models/Folder'

jest.mock('../src/models/Material', () => ({
  __esModule: true,
  default: {
    updateMany: jest.fn(),
  },
}))

jest.mock('../src/models/Folder', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
    deleteOne: jest.fn(),
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

const ORG_ID = '665000000000000000000001'

const createResponse = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
})

const createRequest = (body: any = {}) => ({
  body,
  user: {
    userId: '665000000000000000000002',
    organizationId: ORG_ID,
  },
}) as any

const scopedPredicate = (query: any) => query?.$and?.[0] || query

describe('material folder path regex safety', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('escapes regex metacharacters when renaming child folder paths', async () => {
    const folder = {
      _id: 'folder_1',
      name: 'A+B',
      path: 'A+B',
      parentId: null,
      save: jest.fn().mockResolvedValue(undefined),
    }
    ;(Folder.findOne as jest.Mock)
      .mockResolvedValueOnce(folder)
      .mockResolvedValueOnce(null)
    ;(Folder.updateMany as jest.Mock).mockResolvedValue({ modifiedCount: 0 })
    ;(Material.updateMany as jest.Mock).mockResolvedValue({ modifiedCount: 0 })
    const res = createResponse()

    await renameFolder(createRequest({
      folderId: 'folder_1',
      newName: 'Archive',
    }), res as any)

    expect(scopedPredicate((Folder.updateMany as jest.Mock).mock.calls[0][0])).toEqual({
      path: { $regex: '^A\\+B/' },
    })
    expect(scopedPredicate((Material.updateMany as jest.Mock).mock.calls[1][0])).toEqual({
      folder: { $regex: '^A\\+B/' },
      status: 'uploaded',
    })
    expect(res.json).toHaveBeenCalledWith({ success: true, data: folder })
  })

  it('escapes regex metacharacters when deleting child folder paths', async () => {
    ;(Folder.findOne as jest.Mock).mockResolvedValue({
      _id: 'folder_1',
      name: 'A.B',
      path: 'A.B',
      parentId: null,
    })
    ;(Material.updateMany as jest.Mock).mockResolvedValue({ modifiedCount: 0 })
    ;(Folder.deleteMany as jest.Mock).mockResolvedValue({ deletedCount: 0 })
    ;(Folder.deleteOne as jest.Mock).mockResolvedValue({ deletedCount: 1 })
    const res = createResponse()

    await deleteFolder(createRequest({
      folderId: 'folder_1',
    }), res as any)

    expect(scopedPredicate((Material.updateMany as jest.Mock).mock.calls[0][0])).toEqual({
      $or: [
        { folder: 'A.B' },
        { folder: { $regex: '^A\\.B/' } },
      ],
      status: 'uploaded',
    })
    expect(scopedPredicate((Folder.deleteMany as jest.Mock).mock.calls[0][0])).toEqual({
      path: { $regex: '^A\\.B/' },
    })
    expect(res.json).toHaveBeenCalledWith({ success: true })
  })
})
