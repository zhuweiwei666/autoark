import Account from '../src/models/Account'
import Product from '../src/models/Product'
import { UserRole } from '../src/models/User'
import { addAccountToProduct } from '../src/controllers/productMapping.controller'

const queryWithLean = (value: any) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(value),
  }),
})

const makeReq = (body: any = {}) => ({
  params: { id: '665000000000000000000301' },
  body,
  user: {
    role: UserRole.ORG_ADMIN,
    userId: '665000000000000000000002',
    organizationId: '665000000000000000000001',
  },
})

const makeRes = () => ({
  json: jest.fn(),
  status: jest.fn().mockReturnThis(),
})

describe('product mapping account scope', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('rejects linking an account outside the requester asset scope', async () => {
    jest.spyOn(Account, 'findOne').mockReturnValue(queryWithLean(null) as any)
    const productFind = jest.spyOn(Product, 'findOne').mockResolvedValue(null as any)
    const req: any = makeReq({ accountId: 'act_123' })
    const res: any = makeRes()

    await addAccountToProduct(req, res)

    const accountQuery = (Account.findOne as jest.Mock).mock.calls[0][0]
    expect(accountQuery.$and[0]).toEqual({ channel: 'facebook', accountId: { $in: ['123', 'act_123'] } })
    expect(String(accountQuery.$and[1].organizationId)).toBe('665000000000000000000001')
    expect(productFind).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: '无权绑定广告账户 123，请先同步并分配账户资产',
    })
  })

  it('normalizes linked account ids and blocks duplicate account formats', async () => {
    jest.spyOn(Account, 'findOne').mockReturnValue(queryWithLean({
      accountId: 'act_123',
      name: 'Scoped Account',
    }) as any)

    const product: any = {
      pixels: [{ pixelId: 'pixel_1', pixelName: 'Pixel 1' }],
      accounts: [{ accountId: 'act_123', accountName: 'Existing Account' }],
      save: jest.fn(),
    }
    jest.spyOn(Product, 'findOne').mockResolvedValue(product)
    const req: any = makeReq({ accountId: '123', throughPixelId: 'pixel_1' })
    const res: any = makeRes()

    await addAccountToProduct(req, res)

    expect(product.save).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Account already linked to this product',
    })
  })

  it('links scoped accounts with normalized account ids', async () => {
    jest.spyOn(Account, 'findOne').mockReturnValue(queryWithLean({
      accountId: 'act_123',
      name: 'Scoped Account',
    }) as any)

    const product: any = {
      pixels: [{ pixelId: 'pixel_1', pixelName: 'Pixel 1' }],
      accounts: [],
      save: jest.fn().mockResolvedValue(undefined),
    }
    jest.spyOn(Product, 'findOne').mockResolvedValue(product)
    const req: any = makeReq({ accountId: 'act_123', throughPixelId: 'pixel_1' })
    const res: any = makeRes()

    await addAccountToProduct(req, res)

    expect(product.accounts).toEqual([{
      accountId: '123',
      accountName: 'Scoped Account',
      throughPixelId: 'pixel_1',
      status: 'active',
    }])
    expect(product.save).toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith({ success: true, data: product })
  })
})
