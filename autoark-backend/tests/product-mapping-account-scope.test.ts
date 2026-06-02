import Account from '../src/models/Account'
import FacebookUser from '../src/models/FacebookUser'
import FbToken from '../src/models/FbToken'
import Product from '../src/models/Product'
import { UserRole } from '../src/models/User'
import { addAccountToProduct, addPixelToProduct, createProduct, updateProduct } from '../src/controllers/productMapping.controller'

const queryWithLean = (value: any) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(value),
  }),
})

const leanQuery = (value: any) => ({
  lean: jest.fn().mockResolvedValue(value),
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

  it('rejects linking a pixel outside the requester cached Facebook assets', async () => {
    jest.spyOn(FbToken, 'find').mockReturnValue(queryWithLean([{
      _id: '665000000000000000000501',
      fbUserId: 'fb_1',
    }]) as any)
    jest.spyOn(FacebookUser, 'find').mockReturnValue(leanQuery([{
      fbUserId: 'fb_1',
      pixels: [{ pixelId: 'pixel_other', name: 'Other Pixel' }],
    }]) as any)
    const productFind = jest.spyOn(Product, 'findOne').mockResolvedValue(null as any)
    const req: any = makeReq({ pixelId: 'pixel_1' })
    const res: any = makeRes()

    await addPixelToProduct(req, res)

    expect(productFind).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: '无权绑定 Pixel pixel_1，请先同步 Facebook 资产后重新选择',
    })
  })

  it('rejects unsafe pixel ids before querying cached Facebook assets', async () => {
    const tokenFind = jest.spyOn(FbToken, 'find')
    const productFind = jest.spyOn(Product, 'findOne')
    const req: any = makeReq({ pixelId: { $ne: 'pixel_1' } })
    const res: any = makeRes()

    await addPixelToProduct(req, res)

    expect(tokenFind).not.toHaveBeenCalled()
    expect(productFind).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'pixelId is required',
    })
  })

  it('links pixels from the requester cached Facebook assets', async () => {
    jest.spyOn(FbToken, 'find').mockReturnValue(queryWithLean([{
      _id: '665000000000000000000501',
      fbUserId: 'fb_1',
    }]) as any)
    jest.spyOn(FacebookUser, 'find').mockReturnValue(leanQuery([{
      fbUserId: 'fb_1',
      pixels: [{ pixelId: 'pixel_1', name: 'Scoped Pixel' }],
    }]) as any)

    const product: any = {
      pixels: [],
      accounts: [],
      save: jest.fn().mockResolvedValue(undefined),
    }
    jest.spyOn(Product, 'findOne').mockResolvedValue(product)
    const req: any = makeReq({ pixelId: 'pixel_1' })
    const res: any = makeRes()

    await addPixelToProduct(req, res)

    expect(product.pixels).toEqual([{
      pixelId: 'pixel_1',
      pixelName: 'Scoped Pixel',
      confidence: 100,
      matchMethod: 'manual',
      verified: true,
      verifiedAt: expect.any(Date),
    }])
    expect(product.primaryPixelId).toBe('pixel_1')
    expect(product.save).toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith({ success: true, data: product })
  })

  it('sanitizes product creation data and blocks relationship mass assignment', async () => {
    jest.spyOn(Product, 'findOne').mockResolvedValue(null as any)
    const createSpy = jest.spyOn(Product, 'create').mockResolvedValue({ name: 'Demo' } as any)
    const req: any = makeReq({
      name: '  Demo  ',
      identifier: '  demo:sku_1  ',
      tags: [' vip ', { $ne: 'bad' }, 'launch'],
      pixels: [{ pixelId: 'pixel_1' }],
      accounts: [{ accountId: 'act_123' }],
      primaryPixelId: 'pixel_1',
    })
    const res: any = makeRes()

    await createProduct(req, res)

    const createPayload = createSpy.mock.calls[0][0]
    expect(createPayload).toMatchObject({
      name: 'Demo',
      identifier: 'demo:sku_1',
      tags: ['vip', 'launch'],
      organizationId: '665000000000000000000001',
      createdBy: '665000000000000000000002',
    })
    expect(createPayload).not.toHaveProperty('pixels')
    expect(createPayload).not.toHaveProperty('accounts')
    expect(createPayload).not.toHaveProperty('primaryPixelId')
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { name: 'Demo' } })
  })

  it('filters product updates through the product field allowlist', async () => {
    const product = { _id: '665000000000000000000301', name: 'Demo' }
    const updateSpy = jest.spyOn(Product, 'findOneAndUpdate').mockResolvedValue(product as any)
    const req: any = makeReq({
      name: '  Demo updated  ',
      tags: [' one ', { $ne: 'two' }],
      status: { $ne: 'archived' },
      pixels: [{ pixelId: 'pixel_1' }],
      accounts: [{ accountId: 'act_123' }],
      primaryPixelId: 'pixel_1',
      organizationId: '665000000000000000000999',
    })
    const res: any = makeRes()

    await updateProduct(req, res)

    expect(updateSpy).toHaveBeenCalledWith(
      expect.any(Object),
      {
        $set: {
          name: 'Demo updated',
          tags: ['one'],
        },
      },
      { new: true },
    )
    expect(res.json).toHaveBeenCalledWith({ success: true, data: product })
  })
})
