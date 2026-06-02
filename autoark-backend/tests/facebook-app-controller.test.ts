jest.mock('../src/models/FacebookApp', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
  },
}))

import FacebookApp from '../src/models/FacebookApp'
import { getAvailableApps } from '../src/controllers/facebookApp.controller'

const mockFacebookApp = FacebookApp as jest.Mocked<typeof FacebookApp>

const createFindChain = (apps: any[] = []) => {
  const limit = jest.fn().mockResolvedValue(apps)
  const sort = jest.fn().mockReturnValue({ limit })
  return { sort, limit }
}

const responseMock = () => ({
  json: jest.fn(),
  status: jest.fn().mockReturnThis(),
})

describe('Facebook App controller', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('caps available app selection count', async () => {
    const chain = createFindChain([{ appId: 'app_1' }])
    ;(mockFacebookApp.find as jest.Mock).mockReturnValue({ sort: chain.sort })
    const res = responseMock()

    await getAvailableApps({ query: { count: '9999' } } as any, res as any)

    expect(mockFacebookApp.find).toHaveBeenCalledWith({
      status: 'active',
      'validation.isValid': true,
      'config.enabledForBulkAds': { $ne: false },
    })
    expect(chain.limit).toHaveBeenCalledWith(50)
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ appId: 'app_1' }] })
  })

  it('uses the default count when count is zero or invalid', async () => {
    const chain = createFindChain([])
    ;(mockFacebookApp.find as jest.Mock).mockReturnValue({ sort: chain.sort })
    const res = responseMock()

    await getAvailableApps({ query: { count: '0' } } as any, res as any)

    expect(chain.limit).toHaveBeenCalledWith(1)
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [] })
  })
})
