jest.mock('../src/models/Account', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
  },
}))

jest.mock('../src/models/FbToken', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
  },
}))

jest.mock('../src/models/Product', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
  },
}))

jest.mock('../src/integration/facebook/facebookClient', () => ({
  facebookClient: {
    get: jest.fn(),
  },
}))

import Account from '../src/models/Account'
import FbToken from '../src/models/FbToken'
import Product from '../src/models/Product'
import { facebookClient } from '../src/integration/facebook/facebookClient'
import { discoverAccountsByPixels, fetchAllPixels } from '../src/services/productMapping.service'

const mockAccountFind = Account.find as jest.Mock
const mockFbTokenFind = FbToken.find as jest.Mock
const mockProductFind = Product.find as jest.Mock
const mockFacebookGet = facebookClient.get as jest.Mock

describe('product mapping scoped token selection', () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it('uses a token that can access each account when fetching pixels', async () => {
    mockAccountFind.mockResolvedValue([{ accountId: 'act_123', name: 'Account 123' }])
    mockFbTokenFind.mockResolvedValue([
      { _id: 'token-a', token: 'TOKEN_WITHOUT_ACCOUNT', fbUserName: 'token-a' },
      { _id: 'token-b', token: 'TOKEN_WITH_ACCOUNT', fbUserName: 'token-b' },
    ])
    mockFacebookGet
      .mockRejectedValueOnce(new Error('Unsupported get request'))
      .mockResolvedValueOnce({ id: 'act_123', name: 'Account 123' })
      .mockResolvedValueOnce({ data: [{ id: 'pixel_1', name: 'Pixel 1' }] })

    const pixels = await fetchAllPixels({ organizationId: 'org_1' }, { organizationId: 'org_1' })

    expect(mockAccountFind).toHaveBeenCalledWith({
      $and: [
        { channel: 'facebook', status: { $ne: 'disabled' } },
        { organizationId: 'org_1' },
      ],
    })
    expect(mockFbTokenFind).toHaveBeenCalledWith({ status: 'active', organizationId: 'org_1' })
    expect(mockFacebookGet).toHaveBeenNthCalledWith(1, '/act_123', {
      access_token: 'TOKEN_WITHOUT_ACCOUNT',
      fields: 'id,name',
    })
    expect(mockFacebookGet).toHaveBeenNthCalledWith(2, '/act_123', {
      access_token: 'TOKEN_WITH_ACCOUNT',
      fields: 'id,name',
    })
    expect(mockFacebookGet).toHaveBeenNthCalledWith(3, '/act_123/adspixels', {
      access_token: 'TOKEN_WITH_ACCOUNT',
      fields: 'id,name',
      limit: 100,
    })
    expect(pixels).toEqual([{
      id: 'pixel_1',
      name: 'Pixel 1',
      accountId: '123',
      accountName: 'Account 123',
    }])
  })

  it('paginates pixels when fetching product mapping candidates', async () => {
    mockAccountFind.mockResolvedValue([
      { accountId: 'act_123', name: 'Account 123', token: 'TOKEN_WITH_ACCOUNT' },
    ])
    mockFbTokenFind.mockResolvedValue([
      { _id: 'token-b', token: 'TOKEN_WITH_ACCOUNT', fbUserName: 'token-b' },
    ])
    mockFacebookGet
      .mockResolvedValueOnce({
        data: [{ id: 'pixel_1', name: 'Pixel 1' }],
        paging: { next: 'https://graph.facebook.com/next', cursors: { after: 'cursor_1' } },
      })
      .mockResolvedValueOnce({
        data: [{ id: 'pixel_2', name: 'Pixel 2' }],
      })

    const pixels = await fetchAllPixels({}, {})

    expect(mockFacebookGet).toHaveBeenNthCalledWith(1, '/act_123/adspixels', {
      access_token: 'TOKEN_WITH_ACCOUNT',
      fields: 'id,name',
      limit: 100,
    })
    expect(mockFacebookGet).toHaveBeenNthCalledWith(2, '/act_123/adspixels', {
      access_token: 'TOKEN_WITH_ACCOUNT',
      fields: 'id,name',
      limit: 100,
      after: 'cursor_1',
    })
    expect(pixels.map(pixel => pixel.id)).toEqual(['pixel_1', 'pixel_2'])
  })

  it('normalizes discovered account mappings when syncing pixels to products', async () => {
    const product: any = {
      pixels: [{ pixelId: 'pixel_1' }],
      accounts: [],
      save: jest.fn().mockResolvedValue(undefined),
    }
    mockProductFind.mockResolvedValue([product])
    mockAccountFind.mockResolvedValue([{ accountId: 'act_123', name: 'Account 123', token: 'TOKEN_WITH_ACCOUNT' }])
    mockFbTokenFind.mockResolvedValue([{ _id: 'token-b', token: 'TOKEN_WITH_ACCOUNT', fbUserName: 'token-b' }])
    mockFacebookGet.mockResolvedValueOnce({ data: [{ id: 'pixel_1' }] })

    const result = await discoverAccountsByPixels({}, {}, {})

    expect(mockFacebookGet).toHaveBeenCalledWith('/act_123/adspixels', {
      access_token: 'TOKEN_WITH_ACCOUNT',
      fields: 'id',
      limit: 100,
    })
    expect(product.accounts).toEqual([{
      accountId: '123',
      accountName: 'Account 123',
      throughPixelId: 'pixel_1',
      status: 'active',
    }])
    expect(product.save).toHaveBeenCalled()
    expect(result).toEqual({ productsUpdated: 1, newAccountMappings: 1 })
  })

  it('paginates pixels when discovering account mappings for products', async () => {
    const product: any = {
      pixels: [{ pixelId: 'pixel_2' }],
      accounts: [],
      save: jest.fn().mockResolvedValue(undefined),
    }
    mockProductFind.mockResolvedValue([product])
    mockAccountFind.mockResolvedValue([{ accountId: 'act_123', name: 'Account 123', token: 'TOKEN_WITH_ACCOUNT' }])
    mockFbTokenFind.mockResolvedValue([{ _id: 'token-b', token: 'TOKEN_WITH_ACCOUNT', fbUserName: 'token-b' }])
    mockFacebookGet
      .mockResolvedValueOnce({
        data: [{ id: 'pixel_1' }],
        paging: { next: 'https://graph.facebook.com/next', cursors: { after: 'cursor_1' } },
      })
      .mockResolvedValueOnce({ data: [{ id: 'pixel_2' }] })

    const result = await discoverAccountsByPixels({}, {}, {})

    expect(mockFacebookGet).toHaveBeenNthCalledWith(2, '/act_123/adspixels', {
      access_token: 'TOKEN_WITH_ACCOUNT',
      fields: 'id',
      limit: 100,
      after: 'cursor_1',
    })
    expect(product.accounts).toEqual([{
      accountId: '123',
      accountName: 'Account 123',
      throughPixelId: 'pixel_2',
      status: 'active',
    }])
    expect(result).toEqual({ productsUpdated: 1, newAccountMappings: 1 })
  })
})
