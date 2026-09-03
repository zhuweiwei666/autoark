import FacebookUser from '../src/models/FacebookUser'
import { syncFacebookUserAssets } from '../src/services/facebookUser.service'

describe('Facebook asset sync request budget and recovery', () => {
  const originalFetch = global.fetch
  let writes: any[]
  const response = (body: any) => ({ ok: !body.error, json: async () => body }) as any
  const account = (id: number, status = 1) => ({
    id: `act_${id}`, account_id: String(id), name: `Account ${id}`, account_status: status,
  })
  const sync = () => syncFacebookUserAssets('user', 'TOKEN', 'token', 'org', undefined, { force: true })
  const emptyAssets = (url: URL) => response(Object.fromEntries(
    url.searchParams.get('ids')!.split(',').map(id => [id, { id }]),
  ))

  beforeEach(() => {
    writes = []
    jest.spyOn(FacebookUser, 'findOne').mockResolvedValue(null)
    jest.spyOn(FacebookUser, 'findOneAndUpdate').mockImplementation(async (_filter, update) => {
      writes.push(update)
      return update as any
    })
  })
  afterEach(() => {
    jest.restoreAllMocks()
    global.fetch = originalFetch
  })

  it('checkpoints a lightweight directory and reads all authorized assets in bounded batches', async () => {
    const calls: URL[] = []
    const accounts = Array.from({ length: 26 }, (_, i) => account(i, i < 21 ? 1 : 2))
    global.fetch = jest.fn(async input => {
      const url = new URL(String(input))
      calls.push(url)
      if (url.pathname.endsWith('/me/adaccounts')) {
        expect(url.searchParams.get('fields')).not.toMatch(/adspixels|promote_pages/)
        return response({ data: accounts })
      }
      if (url.searchParams.has('ids')) {
        expect(writes.some(write => write.adAccounts?.length === 26)).toBe(true)
        const ids = url.searchParams.get('ids')!.split(',')
        expect(ids.length).toBeLessThanOrEqual(10)
        expect(ids.every(id => Number(id.replace('act_', '')) < 26)).toBe(true)
        // Meta omits successfully queried empty connections instead of returning data: [].
        return response(Object.fromEntries(ids.map(id => [id, { id }])))
      }
      if (url.pathname.endsWith('/me/businesses')) return response({ data: [{ id: 'biz' }] })
      if (url.pathname.endsWith('/me/accounts')) return response({ data: [] })
      return response({ data: [] })
    }) as any
    const result = await sync()
    expect(result.syncStatus).toBe('completed')
    expect(result.adAccounts).toHaveLength(26)
    expect(calls).toHaveLength(6) // directory + pages + businesses + three asset batches
    expect(result.syncStats.graphRequestCount).toBe(6)
    expect(calls.flatMap(url => url.searchParams.get('ids')?.split(',') || [])).toHaveLength(26)
  })

  it('shrinks only the failing directory page and retains the cursor and prior results', async () => {
    const limits: number[] = []
    global.fetch = jest.fn(async input => {
      const url = new URL(String(input))
      if (url.searchParams.has('ids')) return emptyAssets(url)
      if (!url.pathname.endsWith('/me/adaccounts')) return response({ data: [] })
      if (!url.searchParams.has('after')) {
        return response({ data: [account(1, 2)], paging: {
          next: 'https://graph.facebook.com/v21.0/me/adaccounts?after=cursor&limit=100',
        } })
      }
      const limit = Number(url.searchParams.get('limit'))
      limits.push(limit)
      if (limit > 50) return response({ error: { code: 1, message: "Please reduce the amount of data you're asking for, then retry your request" } })
      expect(url.searchParams.get('access_token')).toBe('TOKEN')
      return response({ data: [account(2, 2)] })
    }) as any
    const result = await sync()
    expect(limits).toEqual([100, 50])
    expect(result.adAccounts.map((a: any) => a.accountId)).toEqual(['1', '2'])
    expect(result.syncStats.graphFailureCount).toBe(1)
  })

  it('splits an oversized asset batch without repeating the directory', async () => {
    let directoryCalls = 0
    const batchSizes: number[] = []
    global.fetch = jest.fn(async input => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/me/adaccounts')) {
        directoryCalls++
        return response({ data: Array.from({ length: 10 }, (_, i) => account(i)) })
      }
      if (!url.searchParams.has('ids')) return response({ data: [] })
      const ids = url.searchParams.get('ids')!.split(',')
      batchSizes.push(ids.length)
      if (ids.length > 5) throw Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })
      return response(Object.fromEntries(ids.map(id => [id, {
        id, adspixels: { data: [{ id: 'pixel', name: 'Pixel' }] },
      }])))
    }) as any
    const result = await sync()
    expect(directoryCalls).toBe(1)
    expect(batchSizes).toEqual([10, 5, 5])
    expect(result.pixels[0].accounts).toHaveLength(10)
  })

  it('keeps the last complete assets and records failure when a batch has a transient error', async () => {
    global.fetch = jest.fn(async input => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/me/adaccounts')) return response({ data: [account(1)] })
      if (url.searchParams.has('ids')) return response({ error: { code: 2, message: 'Temporary service failure' } })
      return response({ data: [] })
    }) as any
    await expect(sync()).rejects.toThrow('Temporary service failure')
    expect(writes.some(write => write.syncStatus === 'completed')).toBe(false)
    expect(writes.every(write => write.pixels === undefined)).toBe(true)
    expect(writes.at(-1)).toMatchObject({ syncStatus: 'failed', syncStats: { graphFailureCount: 1 } })
  })

  it('does not truncate the account directory after reducing the page size', async () => {
    global.fetch = jest.fn(async input => {
      const url = new URL(String(input))
      if (url.searchParams.has('ids')) return emptyAssets(url)
      if (!url.pathname.endsWith('/me/adaccounts')) return response({ data: [] })
      if (Number(url.searchParams.get('limit')) > 10) {
        return response({ error: { code: 1, message: 'Please reduce the amount of data' } })
      }
      const offset = Number(url.searchParams.get('after') || 0)
      return response({
        data: Array.from({ length: 10 }, (_, i) => account(offset + i, 2)),
        ...(offset < 110 && { paging: { next: `https://graph.facebook.com/v21.0/me/adaccounts?after=${offset + 10}&limit=100` } }),
      })
    }) as any
    const result = await sync()
    expect(result.adAccounts).toHaveLength(120)
    expect(result.adAccountsPaginationTruncated).toBe(false)
  })

  it('retries a failed object connection without discarding the successful objects', async () => {
    const connections: string[] = []
    global.fetch = jest.fn(async input => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/me/adaccounts')) return response({ data: [account(1), account(2)] })
      if (url.searchParams.has('ids')) return response({
        act_1: { id: 'act_1', adspixels: { data: [{ id: 'pixel1', name: 'Pixel 1' }] } },
        act_2: { error: { code: 1, message: 'Please reduce the amount of data' } },
      })
      if (url.pathname.includes('/act_')) connections.push(url.pathname)
      if (url.pathname.endsWith('/act_2/adspixels')) return response({ data: [{ id: 'pixel2', name: 'Pixel 2' }] })
      return response({ data: [] })
    }) as any
    const result = await sync()
    expect(connections.sort()).toEqual(['/v21.0/act_2/adspixels', '/v21.0/act_2/promote_pages'])
    expect(result.pixels.map((p: any) => p.pixelId).sort()).toEqual(['pixel1', 'pixel2'])
  })

  it('retains Pixels that are only assigned to disabled accounts', async () => {
    global.fetch = jest.fn(async input => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/me/adaccounts')) return response({ data: [account(1, 2)] })
      if (url.searchParams.has('ids')) return response({ act_1: {
        id: 'act_1', adspixels: { data: [{ id: 'disabled_pixel', name: 'Pixel' }] },
      } })
      return response({ data: [] })
    }) as any
    const result = await sync()
    expect(result.pixels).toEqual([expect.objectContaining({
      pixelId: 'disabled_pixel', accounts: [{ accountId: '1', accountName: 'Account 1' }],
    })])
  })

  it('stops scheduling after failure and drains active requests before releasing the sync', async () => {
    let release: () => void
    let started: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const running = new Promise<void>(resolve => { started = resolve })
    let batches = 0
    global.fetch = jest.fn(async input => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/me/adaccounts')) return response({ data: Array.from({ length: 30 }, (_, i) => account(i)) })
      if (!url.searchParams.has('ids')) return response({ data: [] })
      batches++
      if (batches === 1) return response({ error: { code: 190, message: 'Invalid token' } })
      started!()
      await gate
      return emptyAssets(url)
    }) as any
    const outcome = sync().catch(error => error)
    await running
    await new Promise(resolve => setImmediate(resolve))
    expect(writes.some(write => write.syncStatus === 'failed')).toBe(false)
    release!()
    expect((await outcome).message).toBe('Invalid token')
    expect(batches).toBe(2)
    expect(writes.at(-1).syncStatus).toBe('failed')
  })
})
