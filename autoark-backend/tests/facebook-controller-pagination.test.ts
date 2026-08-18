jest.mock('../src/middlewares/auth', () => ({
  getOrgFilter: jest.fn(),
  getUserAccountIds: jest.fn(),
}))

jest.mock('../src/services/facebook.campaigns.service', () => ({
  getCampaigns: jest.fn(),
}))

jest.mock('../src/services/facebook.accounts.service', () => ({
  getAccounts: jest.fn(),
}))

jest.mock('../src/services/facebook.countries.service', () => ({
  getCountries: jest.fn(),
}))

jest.mock('../src/services/facebook.campaigns.v2.service', () => ({
  syncCampaignsFromAdAccountsV2: jest.fn(),
  getQueueStatus: jest.fn(),
}))

jest.mock('../src/services/facebook.permissions.service', () => ({
  diagnoseToken: jest.fn(),
  diagnoseAllTokens: jest.fn(),
}))

jest.mock('../src/services/facebook.purchase.correction', () => ({
  getPurchaseValueInfo: jest.fn(),
}))

jest.mock('../src/services/facebook.sync.service', () => ({
  getEffectiveAdAccounts: jest.fn(),
}))

jest.mock('../src/services/facebook.token.pool', () => ({
  tokenPool: {
    getTokenStatus: jest.fn(),
  },
}))

import * as facebookAccountsService from '../src/services/facebook.accounts.service'
import * as facebookCampaignsService from '../src/services/facebook.campaigns.service'
import * as facebookCountriesService from '../src/services/facebook.countries.service'
import * as facebookPermissionsService from '../src/services/facebook.permissions.service'
import { getUserAccountIds } from '../src/middlewares/auth'
import { UserRole } from '../src/models/User'
import {
  diagnoseTokens,
  getAccountsList,
  getCampaignsList,
  getCountriesList,
} from '../src/controllers/facebook.controller'

const resMock = () => ({
  json: jest.fn(),
  status: jest.fn().mockReturnThis(),
  setHeader: jest.fn(),
  redirect: jest.fn(),
})

const superAdminReq = (query: any = {}) => ({
  query,
  user: {
    role: UserRole.SUPER_ADMIN,
    userId: '665000000000000000000001',
  },
})

describe('facebook controller legacy snapshot redirects', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getUserAccountIds as jest.Mock).mockResolvedValue(null)
    ;(facebookCampaignsService.getCampaigns as jest.Mock).mockResolvedValue({ data: [], pagination: {} })
    ;(facebookAccountsService.getAccounts as jest.Mock).mockResolvedValue({ data: [], pagination: {} })
    ;(facebookCountriesService.getCountries as jest.Mock).mockResolvedValue({ data: [], pagination: {} })
    ;(facebookPermissionsService.diagnoseAllTokens as jest.Mock).mockResolvedValue({
      results: [],
      meta: { totalFound: 0, checked: 0, limit: 100, truncated: false },
    })
  })

  it('redirects the legacy campaign list to the MongoDB summary endpoint', async () => {
    const req: any = superAdminReq({ page: '2', limit: '10000', sortBy: 'unsafeField', sortOrder: 'asc' })
    const res: any = resMock()

    await getCampaignsList(req, res, jest.fn())

    expect(res.redirect).toHaveBeenCalledWith(
      307,
      '/api/summary/campaigns?page=2&limit=10000&sortBy=unsafeField&sortOrder=asc',
    )
    expect(res.setHeader).toHaveBeenCalledWith('Deprecation', 'true')
    expect(facebookCampaignsService.getCampaigns).not.toHaveBeenCalled()
  })

  it('drops object-shaped legacy filters instead of reflecting them into a redirect', async () => {
    const req: any = superAdminReq({
      name: 'a.b+[x]',
      accountId: { $ne: '123' },
      status: { $ne: 'ACTIVE' },
      objective: '  APP_INSTALLS  ',
    })
    const res: any = resMock()

    await getCampaignsList(req, res, jest.fn())

    expect(res.redirect).toHaveBeenCalledWith(
      307,
      '/api/summary/campaigns?name=a.b%2B%5Bx%5D&objective=++APP_INSTALLS++',
    )
    expect(facebookCampaignsService.getCampaigns).not.toHaveBeenCalled()
  })

  it('redirects the super-admin legacy account list without calling Meta services', async () => {
    const req: any = superAdminReq({ page: '3', limit: '9999', endDate: '2026-06-02' })
    const res: any = resMock()

    await getAccountsList(req, res, jest.fn())

    expect(res.redirect).toHaveBeenCalledWith(
      307,
      '/api/summary/accounts?page=3&limit=9999&endDate=2026-06-02',
    )
    expect(facebookAccountsService.getAccounts).not.toHaveBeenCalled()
  })

  it('keeps the legacy account list restricted to super admins', async () => {
    const req: any = {
      query: {},
      user: { role: UserRole.ORG_ADMIN, userId: '665000000000000000000002' },
    }
    const res: any = resMock()

    await getAccountsList(req, res, jest.fn())

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.redirect).not.toHaveBeenCalled()
    expect(facebookAccountsService.getAccounts).not.toHaveBeenCalled()
  })

  it('maps the legacy country sort order to the MongoDB summary contract', async () => {
    const req: any = superAdminReq({ page: '4', limit: '1000', sortBy: 'spend', sortOrder: 'asc' })
    const res: any = resMock()

    await getCountriesList(req, res, jest.fn())

    expect(res.redirect).toHaveBeenCalledWith(
      307,
      '/api/summary/countries?page=4&limit=1000&sortBy=spend&sortOrder=asc&order=asc',
    )
    expect(facebookCountriesService.getCountries).not.toHaveBeenCalled()
  })

  it('caps all-token permission diagnosis batches', async () => {
    const req: any = superAdminReq({ limit: '9999' })
    const res: any = resMock()

    await diagnoseTokens(req, res, jest.fn())

    expect(facebookPermissionsService.diagnoseAllTokens).toHaveBeenCalledWith({ limit: 100 })
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [],
      meta: { totalFound: 0, checked: 0, limit: 100, truncated: false },
    })
  })
})
