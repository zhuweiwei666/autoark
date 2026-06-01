import { getPublicOAuthRequirements } from '../src/controllers/facebookApp.controller'

describe('Facebook App public OAuth requirements', () => {
  it('matches the commercial customer authorization permission package', () => {
    const json = jest.fn()

    getPublicOAuthRequirements({} as any, { json } as any)

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
        rule: 'All required permissions must be Advanced + Approved, and app must be valid + active.',
      },
    })
  })
})
