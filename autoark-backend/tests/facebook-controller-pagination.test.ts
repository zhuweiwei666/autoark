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
})

const superAdminReq = (query: any = {}) => ({
  query,
  user: {
    role: UserRole.SUPER_ADMIN,
    userId: '665000000000000000000001',
  },
})

describe('facebook controller pagination caps', () => {
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

  it('caps campaign list limit and falls back to spend sorting', async () => {
    const req: any = superAdminReq({ page: '2', limit: '10000', sortBy: 'unsafeField', sortOrder: 'asc' })
    const res: any = resMock()

    await getCampaignsList(req, res, jest.fn())

    expect(facebookCampaignsService.getCampaigns).toHaveBeenCalledWith(
      expect.any(Object),
      { page: 2, limit: 100, sortBy: 'spend', sortOrder: 'asc' },
    )
  })

  it('caps account list limit and keeps the default account sort', async () => {
    const req: any = superAdminReq({ page: '3', limit: '9999', sortBy: 'notAllowed' })
    const res: any = resMock()

    await getAccountsList(req, res, jest.fn())

    expect(facebookAccountsService.getAccounts).toHaveBeenCalledWith(
      expect.any(Object),
      { page: 3, limit: 100, sortBy: 'periodSpend', sortOrder: 'desc' },
      undefined,
    )
  })

  it('caps country list limit and rejects unsafe sort fields', async () => {
    const req: any = superAdminReq({ page: '4', limit: '1000', sortBy: 'badSort' })
    const res: any = resMock()

    await getCountriesList(req, res, jest.fn())

    expect(facebookCountriesService.getCountries).toHaveBeenCalledWith(
      expect.any(Object),
      { page: 4, limit: 100, sortBy: 'spend', sortOrder: 'desc' },
      {},
    )
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
