import { getPublicOAuthRequirements } from '../src/controllers/facebookApp.controller'

describe('Facebook App public OAuth requirements', () => {
  it('matches the commercial customer authorization permission package', async () => {
    const json = jest.fn()

    await getPublicOAuthRequirements({} as any, { json } as any)

    expect(json).toHaveBeenCalledWith({
      success: true,
      data: {
        requiredPermissions: [
          'ads_management',
          'ads_read',
          'business_management',
          'pages_show_list',
          'pages_read_engagement',
          'pages_manage_ads',
        ],
        criteria: [
          'App must be active and App Secret validation must pass.',
          'App Mode must be Live.',
          'Business Verification must be verified.',
          'App Review must be approved.',
          'All required permissions must be Advanced + Approved.',
          'Facebook Login for Business config_id must be configured globally or on the App.',
        ],
        rule: 'Public customer OAuth is ready only when the App is active, valid, Live, verified, approved, has Advanced + Approved permissions, and has a Business Login config_id.',
      },
    })
  })
})
