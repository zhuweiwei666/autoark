import {
  PUBLIC_OAUTH_REQUIRED_PERMISSIONS,
  buildPublicOAuthReadiness,
  computePublicOauthComplianceReady,
  computePublicOauthRuntimeReady,
} from '../src/utils/facebookAppReadiness'

const approvedPermissions = () => PUBLIC_OAUTH_REQUIRED_PERMISSIONS.map((name) => ({
  name,
  access: 'advanced',
  status: 'approved',
}))

const readyApp = (overrides: any = {}) => ({
  status: 'active',
  validation: { isValid: true },
  config: { enabledForBulkAds: true },
  compliance: {
    appMode: 'live',
    businessVerification: 'verified',
    appReview: 'approved',
    permissions: approvedPermissions(),
  },
  ...overrides,
})

describe('facebook app public OAuth readiness', () => {
  it('marks an active, validated, live, approved app with config_id as ready', () => {
    const readiness = buildPublicOAuthReadiness(readyApp(), {
      globalBusinessLoginConfigId: '1544502593866149',
    })

    expect(readiness.ready).toBe(true)
    expect(readiness.complianceReady).toBe(true)
    expect(readiness.runtimeReady).toBe(true)
    expect(readiness.gaps).toHaveLength(0)
  })

  it('does not treat advanced permissions alone as public customer OAuth ready', () => {
    const app = readyApp({
      compliance: {
        appMode: 'dev',
        businessVerification: 'verified',
        appReview: 'approved',
        permissions: approvedPermissions(),
      },
    })
    const readiness = buildPublicOAuthReadiness(app, {
      globalBusinessLoginConfigId: '1544502593866149',
    })

    expect(readiness.ready).toBe(false)
    expect(readiness.complianceReady).toBe(false)
    expect(readiness.gaps.map((gap) => gap.code)).toContain('APP_MODE_NOT_LIVE')
  })

  it('separates Meta compliance from runtime config_id readiness', () => {
    const app = readyApp()
    const readiness = buildPublicOAuthReadiness(app, {
      globalBusinessLoginConfigId: '',
    })

    expect(computePublicOauthComplianceReady(app)).toBe(true)
    expect(computePublicOauthRuntimeReady(app, { globalBusinessLoginConfigId: '' })).toBe(false)
    expect(readiness.ready).toBe(false)
    expect(readiness.gaps.map((gap) => gap.code)).toContain('BUSINESS_LOGIN_CONFIG_MISSING')
  })

  it('reports missing required permissions with current access and status', () => {
    const permissions = approvedPermissions().filter((permission) => permission.name !== 'pages_manage_ads')
    permissions.push({
      name: 'pages_manage_ads',
      access: 'standard',
      status: 'requested',
    })

    const readiness = buildPublicOAuthReadiness(readyApp({
      compliance: {
        appMode: 'live',
        businessVerification: 'verified',
        appReview: 'approved',
        permissions,
      },
    }), {
      globalBusinessLoginConfigId: '1544502593866149',
    })

    expect(readiness.permissionsReady).toBe(false)
    expect(readiness.missingPermissions).toEqual(['pages_manage_ads'])
    expect(readiness.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'PERMISSION_PAGES_MANAGE_ADS_NOT_READY',
        detail: expect.stringContaining('access=standard'),
      }),
    ]))
  })
})

