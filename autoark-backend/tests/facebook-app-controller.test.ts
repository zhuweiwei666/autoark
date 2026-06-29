jest.mock('../src/models/FacebookApp', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
    findById: jest.fn(),
  },
}))

jest.mock('../src/services/auditLog.service', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('axios', () => ({
  get: jest.fn(),
}))

import axios from 'axios'
import FacebookApp from '../src/models/FacebookApp'
import { getAvailableApps, refreshAppReadiness, refreshAppsReadiness, updateApp, updateCompliance } from '../src/controllers/facebookApp.controller'

const mockFacebookApp = FacebookApp as jest.Mocked<typeof FacebookApp>
const mockAxios = axios as jest.Mocked<typeof axios>

const createFindChain = (apps: any[] = []) => {
  const limit = jest.fn().mockResolvedValue(apps)
  const sort = jest.fn().mockReturnValue({ limit })
  return { sort, limit }
}

const responseMock = () => ({
  json: jest.fn(),
  status: jest.fn().mockReturnThis(),
})

const approvedPermissions = () => [
  'ads_management',
  'ads_read',
  'business_management',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_ads',
].map((name) => ({
  name,
  access: 'advanced',
  status: 'approved',
}))

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

  it('sanitizes config and compliance updates before saving an app', async () => {
    const app: any = {
      _id: 'app_doc_1',
      appId: '2165550037551429',
      appSecret: 'old_secret',
      appName: 'Old app',
      notes: 'old notes',
      status: 'active',
      validation: { isValid: true },
      config: {
        maxConcurrentTasks: 5,
        requestsPerMinute: 200,
        priority: 1,
        enabledForBulkAds: true,
        businessLoginConfigId: 'old_config',
      },
      compliance: {
        appMode: 'unknown',
        businessVerification: 'unknown',
        appReview: 'unknown',
        permissions: [],
        publicOauthReady: false,
      },
      save: jest.fn().mockResolvedValue(undefined),
    }
    ;(mockFacebookApp.findById as jest.Mock).mockResolvedValue(app)
    const res = responseMock()

    await updateApp({
      params: { id: 'app_doc_1' },
      body: {
        appName: { $ne: 'Injected' },
        notes: `  ${'n'.repeat(600)}  `,
        status: 'deleted',
        config: {
          maxConcurrentTasks: '999999',
          requestsPerMinute: '999999999',
          priority: '3.8',
          enabledForBulkAds: false,
          businessLoginConfigId: { $ne: 'bad' },
          injected: true,
        },
        compliance: {
          appMode: 'dev',
          publicOauthReady: true,
          injected: true,
          permissions: [
            { name: { $ne: 'ads_management' }, access: 'advanced', status: 'approved' },
            { name: 'ads_management', access: 'root', status: 'approved', notes: 'x'.repeat(600), extra: true },
            { name: 'ads_management', access: 'advanced', status: 'approved' },
          ],
        },
      },
      user: { userId: 'admin_1' },
    } as any, res as any)

    expect(app.appName).toBe('Old app')
    expect(app.notes).toHaveLength(500)
    expect(app.status).toBe('active')
    expect(app.config).toEqual({
      maxConcurrentTasks: 100,
      requestsPerMinute: 100000,
      priority: 3,
      enabledForBulkAds: false,
      businessLoginConfigId: 'old_config',
    })
    expect(app.compliance).toEqual(expect.objectContaining({
      appMode: 'dev',
      publicOauthReady: false,
    }))
    expect(app.compliance.injected).toBeUndefined()
    expect(app.compliance.permissions).toHaveLength(1)
    expect(app.compliance.permissions[0]).toEqual(expect.objectContaining({
      name: 'ads_management',
      access: 'unknown',
      status: 'approved',
    }))
    expect(app.compliance.permissions[0].notes).toHaveLength(500)
    expect(app.save).toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith({ success: true, data: app })
  })

  it('sanitizes compliance-only updates and recomputes public OAuth readiness', async () => {
    const app: any = {
      _id: 'app_doc_2',
      appId: '2165550037551429',
      appName: 'Page app',
      status: 'active',
      validation: { isValid: true },
      config: { enabledForBulkAds: true, businessLoginConfigId: '1544502593866149' },
      compliance: {
        appMode: 'unknown',
        businessVerification: 'unknown',
        appReview: 'unknown',
        permissions: [],
        publicOauthReady: false,
      },
      save: jest.fn().mockResolvedValue(undefined),
    }
    ;(mockFacebookApp.findById as jest.Mock).mockResolvedValue(app)
    const res = responseMock()

    await updateCompliance({
      params: { id: 'app_doc_2' },
      body: {
        appMode: 'live',
        businessVerification: 'verified',
        appReview: 'approved',
        publicOauthReady: false,
        permissions: [
          ...approvedPermissions(),
          { name: { $ne: 'bad' }, access: 'advanced', status: 'approved' },
        ],
      },
      user: { userId: 'admin_1' },
    } as any, res as any)

    expect(app.compliance.appMode).toBe('live')
    expect(app.compliance.businessVerification).toBe('verified')
    expect(app.compliance.appReview).toBe('approved')
    expect(app.compliance.permissions).toHaveLength(6)
    expect(app.compliance.publicOauthReady).toBe(true)
    expect(app.save).toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith({ success: true, data: app })
  })

  it('refreshes one app readiness by validating against Meta in real time', async () => {
    const app: any = {
      _id: 'app_doc_3',
      appId: '2165550037551429',
      appSecret: 'secret',
      appName: 'Realtime app',
      status: 'inactive',
      validation: { isValid: false },
      config: { enabledForBulkAds: true, businessLoginConfigId: '1544502593866149' },
      compliance: {
        appMode: 'live',
        businessVerification: 'verified',
        appReview: 'approved',
        permissions: approvedPermissions(),
        publicOauthReady: false,
      },
      save: jest.fn().mockResolvedValue(undefined),
    }
    ;(mockFacebookApp.findById as jest.Mock).mockResolvedValue(app)
    mockAxios.get
      .mockResolvedValueOnce({ data: { access_token: 'app_access_token' } })
      .mockResolvedValueOnce({ data: { data: { app_id: '2165550037551429', is_valid: true } } })
    const res = responseMock()

    await refreshAppReadiness({
      params: { id: 'app_doc_3' },
      user: { userId: 'admin_1' },
    } as any, res as any)

    expect(mockAxios.get).toHaveBeenCalledTimes(2)
    expect(app.validation).toEqual(expect.objectContaining({ isValid: true }))
    expect(app.status).toBe('active')
    expect(app.compliance.publicOauthReady).toBe(true)
    expect(app.compliance.lastCheckedAt).toBeInstanceOf(Date)
    expect(app.save).toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({
        isValid: true,
        app,
        readiness: expect.objectContaining({ ready: true }),
      }),
    })
  })

  it('refreshes all app readiness records for the app management page', async () => {
    const apps: any[] = [
      {
        _id: 'app_doc_4',
        appId: '2165550037551429',
        appSecret: 'secret',
        appName: 'Realtime app',
        status: 'active',
        validation: { isValid: true },
        config: { enabledForBulkAds: true, businessLoginConfigId: '1544502593866149' },
        compliance: {
          appMode: 'live',
          businessVerification: 'verified',
          appReview: 'approved',
          permissions: approvedPermissions(),
          publicOauthReady: false,
        },
        save: jest.fn().mockResolvedValue(undefined),
      },
    ]
    ;(mockFacebookApp.find as jest.Mock).mockResolvedValue(apps)
    mockAxios.get
      .mockResolvedValueOnce({ data: { access_token: 'app_access_token' } })
      .mockResolvedValueOnce({ data: { data: { app_id: '2165550037551429', is_valid: true } } })
    const res = responseMock()

    await refreshAppsReadiness({ user: { userId: 'admin_1' } } as any, res as any)

    expect(apps[0].compliance.publicOauthReady).toBe(true)
    expect(apps[0].save).toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({
        apps,
        refreshed: 1,
        failed: 0,
      }),
    })
  })
})
