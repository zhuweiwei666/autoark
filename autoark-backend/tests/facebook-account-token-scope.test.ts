import { UserRole } from '../src/models/User'

jest.mock('../src/services/facebook.service', () => ({
  getCampaigns: jest.fn(),
  getAdSets: jest.fn(),
  getAds: jest.fn(),
  getInsightsDaily: jest.fn(),
}))

jest.mock('../src/middlewares/auth', () => ({
  getUserAccountIds: jest.fn(),
  getOrgFilter: jest.fn(),
}))

jest.mock('../src/models/FbToken', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
  },
}))

jest.mock('../src/models/Account', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
  },
}))

import Account from '../src/models/Account'
import FbToken from '../src/models/FbToken'
import * as facebookService from '../src/services/facebook.service'
import { getUserAccountIds } from '../src/middlewares/auth'
import { getCampaigns } from '../src/controllers/facebook.controller'

const mockQuery = (result: any) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(result),
  }),
})

describe('facebook account API token scoping', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('uses a token accessible to the requesting organization when reading account campaigns', async () => {
    ;(getUserAccountIds as jest.Mock).mockResolvedValue(['123'])
    ;(FbToken.find as jest.Mock).mockReturnValue(mockQuery([{ token: 'ORG_TOKEN' }]))
    ;(Account.findOne as jest.Mock).mockReturnValue(mockQuery({ token: 'ORG_TOKEN' }))
    ;(facebookService.getCampaigns as jest.Mock).mockResolvedValue({ data: [] })

    const req: any = {
      params: { id: 'act_123' },
      user: {
        role: UserRole.ORG_ADMIN,
        organizationId: '665000000000000000000001',
        userId: '665000000000000000000002',
      },
    }
    const res: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    }
    const next = jest.fn()

    await getCampaigns(req, res, next)

    expect(FbToken.find).toHaveBeenCalledWith({
      status: 'active',
      organizationId: '665000000000000000000001',
    })
    expect(Account.findOne).toHaveBeenCalledWith({
      channel: 'facebook',
      accountId: { $in: ['123', 'act_123'] },
      token: { $in: ['ORG_TOKEN'] },
    })
    expect(facebookService.getCampaigns).toHaveBeenCalledWith('act_123', 'ORG_TOKEN')
    expect(res.json).toHaveBeenCalledWith({ data: [] })
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects account reads when the account has no accessible token', async () => {
    ;(getUserAccountIds as jest.Mock).mockResolvedValue(['123'])
    ;(FbToken.find as jest.Mock).mockReturnValue(mockQuery([{ token: 'ORG_TOKEN' }]))
    ;(Account.findOne as jest.Mock).mockReturnValue(mockQuery(null))

    const req: any = {
      params: { id: 'act_123' },
      user: {
        role: UserRole.ORG_ADMIN,
        organizationId: '665000000000000000000001',
        userId: '665000000000000000000002',
      },
    }
    const res: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    }
    const next = jest.fn()

    await getCampaigns(req, res, next)

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      message: '没有找到可访问账户 123 的 Facebook 授权',
      statusCode: 403,
    }))
    expect(facebookService.getCampaigns).not.toHaveBeenCalled()
  })
})
