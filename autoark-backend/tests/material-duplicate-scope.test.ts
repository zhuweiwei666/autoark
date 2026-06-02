import Material from '../src/models/Material'
import {
  checkDuplicate,
  getReusableMaterials,
} from '../src/services/materialTracking.service'

jest.mock('../src/models/Material', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    find: jest.fn(),
  },
}))

const findOneResult = (result: any) => ({
  lean: jest.fn().mockResolvedValue(result),
})

describe('material duplicate tenant scope', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('limits fingerprint duplicate checks to the provided tenant scope', async () => {
    ;(Material.findOne as jest.Mock).mockReturnValue(findOneResult(null))

    await checkDuplicate(
      { pHash: 'phash_1', md5: 'md5_1' },
      'image',
      { organizationId: '665000000000000000000001' },
    )

    expect(Material.findOne).toHaveBeenCalledWith({
      $and: [
        { type: 'image', 'fingerprint.pHash': 'phash_1' },
        { organizationId: '665000000000000000000001' },
      ],
    })
  })

  it('limits reusable material recommendations to the provided tenant scope', async () => {
    const limit = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    })
    const sort = jest.fn().mockReturnValue({ limit })
    ;(Material.find as jest.Mock).mockReturnValue({ sort })

    await getReusableMaterials({
      minRoas: 2,
      minSpend: 100,
      minQualityScore: 70,
      limit: 10,
      scopeFilter: { organizationId: '665000000000000000000001' },
    })

    expect(Material.find).toHaveBeenCalledWith({
      $and: [
        {
          status: 'uploaded',
          'metrics.totalSpend': { $gte: 100 },
          'metrics.avgRoas': { $gte: 2 },
          'metrics.qualityScore': { $gte: 70 },
        },
        { organizationId: '665000000000000000000001' },
      ],
    })
    expect(sort).toHaveBeenCalledWith({ 'metrics.qualityScore': -1 })
    expect(limit).toHaveBeenCalledWith(10)
  })
})
