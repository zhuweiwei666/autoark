const mockFacebookGet = jest.fn()
const mockFacebookAppLean = jest.fn()

jest.mock('../src/integration/facebook/facebookClient', () => ({
  facebookClient: {
    get: mockFacebookGet,
  },
}))

jest.mock('../src/models/FacebookApp', () => ({
  __esModule: true,
  default: {
    findById: jest.fn(() => ({
      select: jest.fn(() => ({
        lean: mockFacebookAppLean,
      })),
    })),
  },
}))

import { inspectApplicationOwnership } from '../src/services/metaBusinessCredential.service'

describe('Meta App ownership inspection', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFacebookAppLean.mockResolvedValue({
      _id: '6a422088296518ea88ed4950',
      appId: '1688691382308509',
      appSecret: 'APP_SECRET',
      appName: 'BAIZ 56',
      status: 'active',
    })
  })

  it('returns business ownership without exposing the App secret or access token', async () => {
    mockFacebookGet.mockResolvedValue({
      id: '1688691382308509',
      name: 'BAIZ 56',
      owner_business: { id: '123456789', name: 'AutoArk Central' },
    })

    const result = await inspectApplicationOwnership('6a422088296518ea88ed4950')

    expect(mockFacebookGet).toHaveBeenCalledWith('/1688691382308509', {
      access_token: '1688691382308509|APP_SECRET',
      fields: 'id,name,owner_business',
    })
    expect(result.graph).toEqual({
      id: '1688691382308509',
      name: 'BAIZ 56',
      ownerBusiness: { id: '123456789', name: 'AutoArk Central' },
      isBusinessOwned: true,
    })
    expect(JSON.stringify(result)).not.toContain('APP_SECRET')
  })

  it('reports an App with no Business owner explicitly', async () => {
    mockFacebookGet.mockResolvedValue({
      id: '1688691382308509',
      name: 'BAIZ 56',
    })

    const result = await inspectApplicationOwnership('6a422088296518ea88ed4950')

    expect(result.graph.ownerBusiness).toBeUndefined()
    expect(result.graph.isBusinessOwned).toBe(false)
  })
})
