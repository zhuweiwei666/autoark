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

  it('returns safe App relationships without relying on unavailable owner fields', async () => {
    mockFacebookGet.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/1688691382308509') {
        return { id: '1688691382308509', name: 'BAIZ 56' }
      }
      if (endpoint === '/1688691382308509/roles') {
        return {
          data: [
            {
              user: { id: '9001', name: 'App Admin' },
              role: 'administrators',
            },
          ],
        }
      }
      if (endpoint === '/1688691382308509/agencies') {
        return {
          data: [{ id: '123456789', name: 'AutoArk Agency' }],
        }
      }
      if (endpoint === '/1688691382308509/connected_client_businesses') {
        return {
          data: [{ id: '987654321', name: 'Client Business' }],
        }
      }
      throw new Error(`Unexpected endpoint: ${endpoint}`)
    })

    const result = await inspectApplicationOwnership('6a422088296518ea88ed4950')

    expect(mockFacebookGet).toHaveBeenCalledWith('/1688691382308509', {
      access_token: '1688691382308509|APP_SECRET',
      fields: 'id,name',
    })
    expect(result.graph).toEqual({
      id: '1688691382308509',
      name: 'BAIZ 56',
    })
    expect(result.ownership).toEqual({
      status: 'not_exposed_by_application_api',
    })
    expect(result.relationships).toEqual({
      roles: [
        {
          userId: '9001',
          userName: 'App Admin',
          role: 'administrators',
        },
      ],
      agencies: [{ id: '123456789', name: 'AutoArk Agency' }],
      connectedClientBusinesses: [
        {
          id: '987654321',
          name: 'Client Business',
        },
      ],
    })
    expect(result.warnings).toEqual([])
    expect(JSON.stringify(result)).not.toContain('APP_SECRET')
  })

  it('keeps relationship inspection available when one optional edge fails', async () => {
    mockFacebookGet.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/1688691382308509') {
        return { id: '1688691382308509', name: 'BAIZ 56' }
      }
      if (endpoint === '/1688691382308509/roles') {
        const error = Object.assign(new Error('Unsupported edge'), {
          code: 100,
        })
        throw error
      }
      return { data: [] }
    })

    const result = await inspectApplicationOwnership('6a422088296518ea88ed4950')

    expect(result.relationships.roles).toEqual([])
    expect(result.warnings).toEqual([
      {
        edge: '/1688691382308509/roles',
        message: 'Unsupported edge',
        code: 100,
        subcode: undefined,
      },
    ])
  })
})
