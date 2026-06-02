import Material from '../src/models/Material'
import { checkDuplicate } from '../src/services/materialTracking.service'

jest.mock('../src/models/Material', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
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
})
