import Material from '../src/models/Material'
import MaterialFavorite from '../src/models/MaterialFavorite'
import { getMaterialList, setMaterialFavorite } from '../src/controllers/material.controller'

jest.mock('../src/models/Material', () => ({
  __esModule: true,
  default: { aggregate: jest.fn(), findOne: jest.fn() },
}))
jest.mock('../src/models/MaterialFavorite', () => ({
  __esModule: true,
  default: {
    distinct: jest.fn(),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
  },
}))
jest.mock('../src/services/r2Storage.service', () => ({
  uploadToR2: jest.fn(), deleteFromR2: jest.fn(), getObjectFromR2: jest.fn(),
  checkR2Config: jest.fn(), generatePresignedUploadUrl: jest.fn(),
  generatePresignedUploadUrls: jest.fn(), getPublicUrlForKey: jest.fn(),
}))
jest.mock('../src/services/materialTracking.service', () => ({
  calculateFingerprint: jest.fn(), checkDuplicate: jest.fn(), recordFacebookMapping: jest.fn(),
  findMaterialByFacebookId: jest.fn(), getReusableMaterials: jest.fn(),
  getMaterialFullData: jest.fn(), aggregateMetricsToMaterials: jest.fn(),
  recordAdMaterialMapping: jest.fn(), recordAdMaterialMappings: jest.fn(),
}))

const user = {
  userId: '665000000000000000000002',
  organizationId: '665000000000000000000001',
  role: 'admin',
}
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() })

describe('material favorites', () => {
  afterEach(() => jest.clearAllMocks())

  it('annotates the current user favorites and supports favorite-only filtering', async () => {
    ;(MaterialFavorite.distinct as jest.Mock).mockResolvedValue(['665000000000000000000010'])
    ;(Material.aggregate as jest.Mock).mockResolvedValue([{
      data: [{ _id: '665000000000000000000010', name: 'Favorite video' }],
      total: [{ count: 1 }],
    }])
    const res = response()

    await getMaterialList({
      query: { includeFavorite: 'true', favoritesOnly: 'true' },
      user,
    } as any, res as any)

    expect(MaterialFavorite.distinct).toHaveBeenCalledWith('materialId', { userId: user.userId })
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        list: [expect.objectContaining({ isFavorite: true })],
      }),
    }))
  })

  it('creates and removes a personal favorite without mutating the material', async () => {
    const lean = jest.fn().mockResolvedValue({ _id: '665000000000000000000010' })
    const select = jest.fn().mockReturnValue({ lean })
    ;(Material.findOne as jest.Mock).mockReturnValue({ select })
    ;(MaterialFavorite.updateOne as jest.Mock).mockResolvedValue({})
    ;(MaterialFavorite.deleteOne as jest.Mock).mockResolvedValue({})

    const addRes = response()
    await setMaterialFavorite({
      params: { id: '665000000000000000000010' },
      body: { favorite: true },
      user,
    } as any, addRes as any)
    expect(MaterialFavorite.updateOne).toHaveBeenCalledWith(
      { userId: user.userId, materialId: '665000000000000000000010' },
      expect.any(Object),
      { upsert: true },
    )

    const removeRes = response()
    await setMaterialFavorite({
      params: { id: '665000000000000000000010' },
      body: { favorite: false },
      user,
    } as any, removeRes as any)
    expect(MaterialFavorite.deleteOne).toHaveBeenCalledWith({
      userId: user.userId,
      materialId: '665000000000000000000010',
    })
  })
})
