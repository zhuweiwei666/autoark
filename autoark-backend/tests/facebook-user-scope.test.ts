import FacebookUser from '../src/models/FacebookUser'
import FbToken from '../src/models/FbToken'
import * as facebookAccountsService from '../src/services/facebook.accounts.service'
import {
  getCachedPixels,
  getSyncStatus,
  syncFacebookTokenAssets,
  syncFacebookUserAssets,
} from '../src/services/facebookUser.service'

describe('facebook user asset cache scoping', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    jest.spyOn(FacebookUser, 'findOne').mockResolvedValue(null)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    global.fetch = originalFetch
  })

  it('reads cached assets by organization scope before token fallback', async () => {
    const findOne = jest.spyOn(FacebookUser, 'findOne').mockResolvedValue({ pixels: [] } as any)

    await getCachedPixels('fb_1', { organizationId: '665000000000000000000001', tokenId: 'token_1' })

    expect(findOne).toHaveBeenCalledWith({
      fbUserId: 'fb_1',
      organizationId: '665000000000000000000001',
    })
  })

  it('falls back to token scope when organization is unavailable', async () => {
    const findOne = jest.spyOn(FacebookUser, 'findOne').mockResolvedValue(null)

    const status = await getSyncStatus('fb_1', { tokenId: 'token_1' })

    expect(findOne).toHaveBeenCalledWith({
      fbUserId: 'fb_1',
      tokenId: 'token_1',
    })
    expect(status.status).toBe('pending')
  })

  it('makes an expired persisted sync lease retryable after a process interruption', async () => {
    jest.spyOn(FacebookUser, 'findOne').mockResolvedValue({
      syncStatus: 'syncing',
      syncLeaseExpiresAt: new Date(Date.now() - 1000),
      updatedAt: new Date(Date.now() - 60 * 60 * 1000),
      adAccounts: [{ accountId: '100' }],
    } as any)

    const status = await getSyncStatus('fb_1', {
      organizationId: '665000000000000000000001',
      tokenId: '665000000000000000000901',
    })

    expect(status).toEqual(expect.objectContaining({
      status: 'failed',
      retryable: true,
      stale: true,
      accountCount: 1,
    }))
  })

  it('keeps a sync locked while its persisted lease is still active', async () => {
    jest.spyOn(FacebookUser, 'findOne').mockResolvedValue({
      syncStatus: 'syncing',
      syncStartedAt: new Date(),
      syncLeaseExpiresAt: new Date(Date.now() + 60 * 1000),
    } as any)

    const status = await getSyncStatus('fb_1', { tokenId: 'token_1' })

    expect(status).toEqual(expect.objectContaining({
      status: 'syncing',
      retryable: false,
      stale: false,
    }))
  })

  it('syncs Facebook user assets across paginated Graph collections', async () => {
    const writes: any[] = []
    jest.spyOn(FacebookUser, 'findOneAndUpdate').mockImplementation(async (_filter: any, update: any) => {
      writes.push(update)
      return update as any
    })

    const response = (data: any) => Promise.resolve({
      json: async () => data,
    } as any)
    const fetchMock = jest.fn(async (input: any) => {
      const url = String(input)

      if (url.includes('/me/adaccounts') && url.includes('accounts_page_2')) {
        return response({ data: [{ id: 'act_101', account_id: '101', name: 'Account 101', account_status: 1 }] })
      }
      if (url.includes('/me/adaccounts')) {
        return response({
          data: [{ id: 'act_100', account_id: '100', name: 'Account 100', account_status: 1 }],
          paging: { next: 'https://graph.facebook.com/v21.0/me/adaccounts?accounts_page_2=1' },
        })
      }

      if (url.includes('/act_100/adspixels') && url.includes('pixels_page_2')) {
        return response({ data: [{ id: 'pixel_2', name: 'Pixel 2' }] })
      }
      if (url.includes('/act_100/adspixels')) {
        return response({
          data: [{ id: 'pixel_1', name: 'Pixel 1' }],
          paging: { next: 'https://graph.facebook.com/v21.0/act_100/adspixels?pixels_page_2=1' },
        })
      }
      if (url.includes('/act_101/adspixels')) {
        return response({ data: [] })
      }

      if (url.includes('/act_100/promote_pages') && url.includes('pages_page_2')) {
        return response({ data: [{ id: 'page_2', name: 'Page 2', access_token: 'PAGE_TOKEN_2' }] })
      }
      if (url.includes('/act_100/promote_pages')) {
        return response({
          data: [{ id: 'page_1', name: 'Page 1', access_token: 'PAGE_TOKEN_1' }],
          paging: { next: 'https://graph.facebook.com/v21.0/act_100/promote_pages?pages_page_2=1' },
        })
      }
      if (url.includes('/act_101/promote_pages')) {
        return response({ data: [] })
      }
      if (url.includes('/me/accounts')) {
        return response({ data: [{ id: 'fallback_page', name: 'Fallback Page', access_token: 'PAGE_TOKEN_3' }] })
      }

      if (url.includes('/me/businesses')) {
        return response({ data: [{ id: 'biz_1', name: 'Business 1' }] })
      }
      if (url.includes('/biz_1/owned_product_catalogs') && url.includes('catalogs_page_2')) {
        return response({ data: [{ id: 'catalog_2', name: 'Catalog 2' }] })
      }
      if (url.includes('/biz_1/owned_product_catalogs')) {
        return response({
          data: [{ id: 'catalog_1', name: 'Catalog 1' }],
          paging: { next: 'https://graph.facebook.com/v21.0/biz_1/owned_product_catalogs?catalogs_page_2=1' },
        })
      }

      return response({ data: [] })
    })
    global.fetch = fetchMock as any

    await syncFacebookUserAssets(
      'fb_1',
      'TOKEN_A',
      '665000000000000000000901',
      '665000000000000000000001',
    )

    const completedWrite = writes.find((write) => write.syncStatus === 'completed')
    expect(completedWrite.adAccounts.map((account: any) => account.accountId)).toEqual(['100', '101'])
    expect(completedWrite.pixels.map((pixel: any) => pixel.pixelId)).toEqual(['pixel_1', 'pixel_2'])
    expect(completedWrite.pages.map((page: any) => page.pageId)).toEqual(
      expect.arrayContaining(['page_1', 'page_2', 'fallback_page']),
    )
    expect(completedWrite.productCatalogs.map((catalog: any) => catalog.catalogId)).toEqual(['catalog_1', 'catalog_2'])
    const requestWithTimeout = expect.objectContaining({ signal: expect.any(AbortSignal) })
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('accounts_page_2=1'), requestWithTimeout)
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('pixels_page_2=1'), requestWithTimeout)
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('pages_page_2=1'), requestWithTimeout)
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('catalogs_page_2=1'), requestWithTimeout)
  })

  it('collects token-level assets and avoids per-account requests when field expansion succeeds', async () => {
    const writes: any[] = []
    jest.spyOn(FacebookUser, 'findOne').mockResolvedValue(null)
    jest.spyOn(FacebookUser, 'findOneAndUpdate').mockImplementation(async (_filter: any, update: any) => {
      writes.push(update)
      return update as any
    })

    const response = (data: any) => Promise.resolve({
      json: async () => data,
    } as any)
    const fetchMock = jest.fn(async (input: any) => {
      const url = String(input)
      if (url.includes('/me/adaccounts')) {
        return response({
          data: [{
            id: 'act_100',
            account_id: '100',
            name: 'Account 100',
            account_status: 1,
            adspixels: {
              data: [{
                id: 'assigned_pixel',
                name: 'Assigned Pixel',
                owner_business: { id: 'biz_1', name: 'Business 1' },
              }],
            },
            promote_pages: {
              data: [{ id: 'account_page', name: 'Account Page' }],
            },
          }],
        })
      }
      if (url.includes('/me/adspixels')) {
        return response({
          data: [{
            id: 'token_pixel',
            name: 'Token Pixel',
            owner_business: { id: 'biz_1', name: 'Business 1' },
            is_created_by_business: true,
            last_fired_time: '2026-07-24T00:00:00+0000',
          }],
        })
      }
      if (url.includes('/me/accounts')) {
        return response({
          data: [{ id: 'user_page', name: 'User Page', access_token: 'PAGE_TOKEN' }],
        })
      }
      if (url.includes('/me/businesses')) {
        return response({
          data: [{
            id: 'biz_1',
            name: 'Business 1',
            owned_product_catalogs: {
              data: [{ id: 'catalog_1', name: 'Catalog 1' }],
            },
            owned_pixels: {
              data: [{ id: 'business_pixel', name: 'Business Pixel' }],
            },
          }],
        })
      }
      return response({ data: [] })
    })
    global.fetch = fetchMock as any

    await syncFacebookUserAssets(
      'fb_1',
      'TOKEN_A',
      '665000000000000000000901',
      '665000000000000000000001',
    )

    const completedWrite = writes.find((write) => write.syncStatus === 'completed')
    expect(completedWrite.pixels).toEqual(expect.arrayContaining([
      expect.objectContaining({
        pixelId: 'token_pixel',
        name: 'Token Pixel',
        accounts: [],
        ownerBusiness: { id: 'biz_1', name: 'Business 1' },
      }),
      expect.objectContaining({
        pixelId: 'assigned_pixel',
        accounts: [{ accountId: '100', accountName: 'Account 100' }],
      }),
      expect.objectContaining({
        pixelId: 'business_pixel',
        accounts: [],
      }),
    ]))
    expect(completedWrite.pages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        pageId: 'user_page',
        accounts: [],
      }),
      expect.objectContaining({
        pageId: 'account_page',
        accounts: [{ accountId: '100' }],
      }),
    ]))
    expect(completedWrite.productCatalogs).toEqual([
      expect.objectContaining({ catalogId: 'catalog_1' }),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/act_100/'))).toBe(false)
  })

  it('imports the synchronized account directory for a newly authorized token', async () => {
    jest.spyOn(FacebookUser, 'findOne').mockResolvedValue(null)
    jest.spyOn(FacebookUser, 'findOneAndUpdate').mockImplementation(
      async (_filter: any, update: any) => update as any,
    )
    const importAccounts = jest
      .spyOn(facebookAccountsService, 'syncCachedAccountsForToken')
      .mockResolvedValue({ syncedCount: 1, skippedCount: 0, errors: [] })
    const updateToken = jest.spyOn(FbToken, 'findByIdAndUpdate').mockResolvedValue({} as any)
    const response = (data: any) => Promise.resolve({ json: async () => data } as any)
    global.fetch = jest.fn(async (input: any) => {
      if (String(input).includes('/me/adaccounts')) {
        return response({
          data: [{
            id: 'act_100',
            account_id: '100',
            name: 'Account 100',
            account_status: 1,
            adspixels: { data: [] },
            promote_pages: { data: [] },
          }],
        })
      }
      return response({ data: [] })
    }) as any

    const tokenDoc = {
      _id: 'token_1',
      token: 'TOKEN_A',
      fbUserId: 'fb_1',
      organizationId: 'org_1',
      optimizer: 'Alice',
    }
    await syncFacebookTokenAssets(tokenDoc, { force: true })

    expect(importAccounts).toHaveBeenCalledWith(
      tokenDoc,
      [expect.objectContaining({ accountId: '100' })],
    )
    expect(updateToken).toHaveBeenCalledWith('token_1', {
      lastAccountSyncedAt: expect.any(Date),
    })
  })

  it('reuses a recent completed asset snapshot without spending Meta requests', async () => {
    const cachedSnapshot = {
      syncStatus: 'completed',
      lastSyncedAt: new Date(),
      adAccounts: [{ accountId: '100', name: 'Account 100' }],
      pixels: [{ pixelId: 'pixel_1', name: 'Pixel 1', accounts: [] }],
      pages: [],
      productCatalogs: [],
    }
    jest.spyOn(FacebookUser, 'findOne').mockResolvedValue(cachedSnapshot as any)
    jest.spyOn(FacebookUser, 'findOneAndUpdate').mockResolvedValue(cachedSnapshot as any)
    const fetchMock = jest.fn(async () => {
      throw new Error('unexpected Meta request')
    })
    global.fetch = fetchMock as any
    const onAdAccountsSynced = jest.fn().mockResolvedValue(undefined)

    await expect(syncFacebookUserAssets(
      'fb_1',
      'TOKEN_A',
      '665000000000000000000901',
      '665000000000000000000001',
      onAdAccountsSynced,
    )).resolves.toBe(cachedSnapshot)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(onAdAccountsSynced).toHaveBeenCalledWith(cachedSnapshot.adAccounts)
  })

  it('does not bypass another process active sync lease even when refresh is forced', async () => {
    const cachedSnapshot = {
      syncStatus: 'syncing',
      syncLeaseExpiresAt: new Date(Date.now() + 60_000),
      adAccounts: [{ accountId: '100', name: 'Account 100' }],
      pixels: [],
      pages: [],
      productCatalogs: [],
    }
    jest.spyOn(FacebookUser, 'findOne').mockResolvedValue(cachedSnapshot as any)
    const fetchMock = jest.fn(async () => {
      throw new Error('unexpected Meta request')
    })
    global.fetch = fetchMock as any

    await expect(syncFacebookUserAssets(
      'fb_1',
      'TOKEN_A',
      '665000000000000000000901',
      '665000000000000000000001',
      undefined,
      { force: true },
    )).resolves.toBe(cachedSnapshot)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not spend Meta requests when another process wins the atomic sync claim', async () => {
    const pendingSnapshot = {
      syncStatus: 'pending',
      adAccounts: [],
    }
    const activeSnapshot = {
      syncStatus: 'syncing',
      syncLeaseExpiresAt: new Date(Date.now() + 60_000),
      adAccounts: [{ accountId: '100', name: 'Account 100' }],
    }
    jest.spyOn(FacebookUser, 'findOne')
      .mockResolvedValueOnce(pendingSnapshot as any)
      .mockResolvedValueOnce(activeSnapshot as any)
    const claim = jest.spyOn(FacebookUser, 'findOneAndUpdate').mockResolvedValue(null)
    const fetchMock = jest.fn(async () => {
      throw new Error('unexpected Meta request')
    })
    global.fetch = fetchMock as any

    await expect(syncFacebookUserAssets(
      'fb_1',
      'TOKEN_A',
      '665000000000000000000901',
      '665000000000000000000001',
      undefined,
      { force: true },
    )).resolves.toBe(activeSnapshot)

    expect(claim).toHaveBeenCalledTimes(1)
    expect(claim.mock.calls[0][0]).toEqual(expect.objectContaining({
      $and: expect.any(Array),
    }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the previous pixel snapshot when the token-level request fails transiently', async () => {
    const cachedSnapshot = {
      syncStatus: 'completed',
      lastSyncedAt: new Date(),
      adAccounts: [{ accountId: '200', status: 2 }],
      pixels: [{ pixelId: 'known_pixel', name: 'Known Pixel', accounts: [] }],
      pages: [],
      productCatalogs: [],
    }
    jest.spyOn(FacebookUser, 'findOne').mockResolvedValue(cachedSnapshot as any)
    const writes: any[] = []
    jest.spyOn(FacebookUser, 'findOneAndUpdate').mockImplementation(
      async (_filter: any, update: any) => {
        writes.push(update)
        return update as any
      },
    )
    const response = (data: any) => Promise.resolve({ json: async () => data } as any)
    global.fetch = jest.fn(async (input: any) => {
      const url = String(input)
      if (url.includes('/me/adspixels')) {
        throw new Error('temporary network failure')
      }
      if (url.includes('/me/adaccounts')) {
        return response({
          data: [{
            id: 'act_200',
            account_id: '200',
            name: 'Disabled Account',
            account_status: 2,
            adspixels: { data: [] },
            promote_pages: { data: [] },
          }],
        })
      }
      return response({ data: [] })
    }) as any

    await expect(syncFacebookUserAssets(
      'fb_1',
      'TOKEN_A',
      '665000000000000000000901',
      '665000000000000000000001',
      undefined,
      { force: true },
    )).rejects.toThrow('temporary network failure')

    expect(writes.some(write => write.syncStatus === 'completed')).toBe(false)
    expect(writes).toContainEqual(expect.objectContaining({
      syncStatus: 'failed',
      syncError: 'temporary network failure',
    }))
  })

  it('does not scan disabled accounts when expanded account assets are unavailable', async () => {
    jest.spyOn(FacebookUser, 'findOne').mockResolvedValue(null)
    jest.spyOn(FacebookUser, 'findOneAndUpdate').mockResolvedValue({} as any)

    const response = (data: any) => Promise.resolve({
      json: async () => data,
    } as any)
    const fetchMock = jest.fn(async (input: any) => {
      const url = String(input)
      if (url.includes('/me/adaccounts')) {
        return response({
          data: [{
            id: 'act_200',
            account_id: '200',
            name: 'Disabled Account',
            account_status: 2,
          }],
        })
      }
      return response({ data: [] })
    })
    global.fetch = fetchMock as any

    await syncFacebookUserAssets('fb_2', 'TOKEN_B', 'token_2', 'org_1')

    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/act_200/'))).toBe(false)
  })

  it('retries only the account directory when Meta rejects field expansion', async () => {
    jest.spyOn(FacebookUser, 'findOne').mockResolvedValue(null)
    jest.spyOn(FacebookUser, 'findOneAndUpdate').mockResolvedValue({} as any)

    const response = (data: any) => Promise.resolve({
      json: async () => data,
    } as any)
    let accountRequests = 0
    const fetchMock = jest.fn(async (input: any) => {
      if (String(input).includes('/me/adaccounts')) {
        accountRequests += 1
        if (accountRequests === 1) {
          return response({
            error: {
              code: 100,
              message: 'Tried accessing nonexisting field adspixels',
            },
          })
        }
        return response({
          data: [{
            id: 'act_200',
            account_id: '200',
            name: 'Disabled Account',
            account_status: 2,
          }],
        })
      }
      return response({ data: [] })
    })
    global.fetch = fetchMock as any

    await syncFacebookUserAssets('fb_2', 'TOKEN_B', 'token_2', 'org_1')

    expect(accountRequests).toBe(2)
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/act_200/'))).toBe(false)
  })

  it('falls back to business-owned pixels only when business field expansion is unavailable', async () => {
    jest.spyOn(FacebookUser, 'findOne').mockResolvedValue(null)
    const writes: any[] = []
    jest.spyOn(FacebookUser, 'findOneAndUpdate').mockImplementation(
      async (_filter: any, update: any) => {
        writes.push(update)
        return update as any
      },
    )

    const response = (data: any) => Promise.resolve({ json: async () => data } as any)
    let businessRequests = 0
    const fetchMock = jest.fn(async (input: any) => {
      const url = String(input)
      if (url.includes('/me/adspixels')) {
        return response({
          error: {
            code: 100,
            message: 'Unsupported get request for adspixels',
          },
        })
      }
      if (url.includes('/me/businesses')) {
        businessRequests += 1
        if (businessRequests === 1) {
          return response({
            error: {
              code: 100,
              message: 'Tried accessing nonexisting field owned_pixels',
            },
          })
        }
        return response({ data: [{ id: 'biz_1', name: 'Business 1' }] })
      }
      if (url.includes('/biz_1/owned_pixels')) {
        return response({ data: [{ id: 'business_pixel', name: 'Business Pixel' }] })
      }
      return response({ data: [] })
    })
    global.fetch = fetchMock as any

    await syncFacebookUserAssets('fb_1', 'TOKEN_A', 'token_1', 'org_1')

    const completedWrite = writes.find(write => write.syncStatus === 'completed')
    expect(completedWrite.pixels).toEqual([
      expect.objectContaining({ pixelId: 'business_pixel' }),
    ])
    expect(fetchMock.mock.calls.filter(([input]) =>
      String(input).includes('/biz_1/owned_pixels'),
    )).toHaveLength(1)
  })

  it('coalesces concurrent syncs for the same Facebook token', async () => {
    jest.spyOn(FacebookUser, 'findOneAndUpdate').mockImplementation(async (_filter: any, update: any) => update as any)

    let releaseAccounts: (() => void) | undefined
    const accountsGate = new Promise<void>((resolve) => {
      releaseAccounts = resolve
    })
    const response = (data: any) => Promise.resolve({
      json: async () => data,
    } as any)
    const fetchMock = jest.fn(async (input: any) => {
      const url = String(input)
      if (url.includes('/me/adaccounts')) {
        await accountsGate
        return response({
          data: [{ id: 'act_100', account_id: '100', name: 'Account 100', account_status: 1 }],
        })
      }
      return response({ data: [] })
    })
    global.fetch = fetchMock as any
    const firstHandler = jest.fn().mockResolvedValue(undefined)
    const secondHandler = jest.fn().mockResolvedValue(undefined)

    const firstSync = syncFacebookUserAssets(
      'fb_1',
      'TOKEN_A',
      '665000000000000000000901',
      '665000000000000000000001',
      firstHandler,
    )
    const secondSync = syncFacebookUserAssets(
      'fb_1',
      'TOKEN_B',
      '665000000000000000000901',
      '665000000000000000000001',
      secondHandler,
    )

    releaseAccounts?.()
    await Promise.all([firstSync, secondSync])

    const accountFetches = fetchMock.mock.calls.filter(([input]) => String(input).includes('/me/adaccounts'))
    expect(accountFetches).toHaveLength(1)
    const expectedAccounts = [expect.objectContaining({ accountId: '100', name: 'Account 100' })]
    expect(firstHandler).toHaveBeenCalledWith(expectedAccounts)
    expect(secondHandler).toHaveBeenCalledWith(expectedAccounts)
  })

  it('checkpoints ad accounts before scanning their pixels and pages', async () => {
    const writes: any[] = []
    jest.spyOn(FacebookUser, 'findOneAndUpdate').mockImplementation(async (_filter: any, update: any) => {
      writes.push(update)
      return update as any
    })

    let releasePixels: (() => void) | undefined
    let markPixelsStarted: (() => void) | undefined
    const pixelsGate = new Promise<void>((resolve) => {
      releasePixels = resolve
    })
    const pixelsStarted = new Promise<void>((resolve) => {
      markPixelsStarted = resolve
    })
    const response = (data: any) => Promise.resolve({
      json: async () => data,
    } as any)
    const fetchMock = jest.fn(async (input: any) => {
      const url = String(input)
      if (url.includes('/me/adaccounts')) {
        return response({
          data: [{ id: 'act_100', account_id: '100', name: 'Account 100', account_status: 1 }],
        })
      }
      if (url.includes('/act_100/adspixels')) {
        markPixelsStarted?.()
        await pixelsGate
      }
      return response({ data: [] })
    })
    global.fetch = fetchMock as any
    const onAdAccountsSynced = jest.fn().mockResolvedValue(undefined)

    const sync = syncFacebookUserAssets(
      'fb_1',
      'TOKEN_A',
      '665000000000000000000901',
      '665000000000000000000001',
      onAdAccountsSynced,
    )
    await pixelsStarted

    expect(writes).toContainEqual(expect.objectContaining({
      syncStatus: 'syncing',
      adAccounts: [expect.objectContaining({ accountId: '100', name: 'Account 100' })],
    }))
    expect(onAdAccountsSynced).toHaveBeenCalledWith([
      expect.objectContaining({ accountId: '100', name: 'Account 100' }),
    ])

    releasePixels?.()
    await sync
  })

  it('releases the single-flight entry after a failed sync so retry can run', async () => {
    jest.spyOn(FacebookUser, 'findOneAndUpdate').mockResolvedValue({} as any)

    let accountAttempts = 0
    const response = (data: any) => Promise.resolve({ json: async () => data } as any)
    global.fetch = jest.fn(async (input: any) => {
      if (String(input).includes('/me/adaccounts')) {
        accountAttempts += 1
        if (accountAttempts === 1) throw new Error('temporary Graph failure')
      }
      return response({ data: [] })
    }) as any

    await expect(syncFacebookUserAssets(
      'fb_1',
      'TOKEN_A',
      '665000000000000000000901',
      '665000000000000000000001',
    )).rejects.toThrow('temporary Graph failure')

    await expect(syncFacebookUserAssets(
      'fb_1',
      'TOKEN_A',
      '665000000000000000000901',
      '665000000000000000000001',
    )).resolves.toBeDefined()
    expect(accountAttempts).toBe(2)
  })

  it('does not coalesce syncs across organizations', async () => {
    jest.spyOn(FacebookUser, 'findOneAndUpdate').mockResolvedValue({} as any)

    let releaseAccounts: (() => void) | undefined
    const accountsGate = new Promise<void>((resolve) => {
      releaseAccounts = resolve
    })
    const response = (data: any) => Promise.resolve({ json: async () => data } as any)
    const fetchMock = jest.fn(async (input: any) => {
      if (String(input).includes('/me/adaccounts')) await accountsGate
      return response({ data: [] })
    })
    global.fetch = fetchMock as any

    const firstSync = syncFacebookUserAssets('fb_1', 'TOKEN_A', 'token_1', 'org_1')
    const secondSync = syncFacebookUserAssets('fb_1', 'TOKEN_A', 'token_1', 'org_2')
    releaseAccounts?.()
    await Promise.all([firstSync, secondSync])

    const accountFetches = fetchMock.mock.calls.filter(([input]) => String(input).includes('/me/adaccounts'))
    expect(accountFetches).toHaveLength(2)
  })

  it('fetches the user-level Page fallback only once per sync', async () => {
    jest.spyOn(FacebookUser, 'findOneAndUpdate').mockResolvedValue({} as any)

    const response = (data: any) => Promise.resolve({ json: async () => data } as any)
    const fetchMock = jest.fn(async (input: any) => {
      const url = String(input)
      if (url.includes('/me/adaccounts')) {
        return response({ data: [
          { id: 'act_100', account_id: '100', name: 'Account 100', account_status: 1 },
          { id: 'act_101', account_id: '101', name: 'Account 101', account_status: 1 },
        ] })
      }
      if (url.includes('/me/accounts')) {
        return response({ data: [{ id: 'page_1', name: 'Page 1' }] })
      }
      return response({ data: [] })
    })
    global.fetch = fetchMock as any

    await syncFacebookUserAssets('fb_1', 'TOKEN_A', 'token_1', 'org_1')

    const fallbackFetches = fetchMock.mock.calls.filter(([input]) => String(input).includes('/me/accounts'))
    expect(fallbackFetches).toHaveLength(1)
  })
})
