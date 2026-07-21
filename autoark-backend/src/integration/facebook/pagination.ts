import { facebookClient } from './facebookClient'

export const fetchFacebookEdgePages = async <T = any>(
  endpoint: string,
  params: Record<string, any>,
  options?: { maxPages?: number },
): Promise<T[]> => {
  const configuredMax = Number(options?.maxPages || process.env.FACEBOOK_SYNC_MAX_PAGES || 100)
  const maxPages = Math.min(200, Math.max(1, Number.isFinite(configuredMax) ? Math.floor(configuredMax) : 100))
  const results: T[] = []
  const seenCursors = new Set<string>()
  let after: string | undefined

  for (let page = 0; page < maxPages; page += 1) {
    const response = await facebookClient.get(endpoint, {
      ...params,
      ...(after ? { after } : {}),
    })
    if (Array.isArray(response?.data)) results.push(...response.data)

    const nextCursor = response?.paging?.cursors?.after
    if (!response?.paging?.next || !nextCursor) break
    if (seenCursors.has(nextCursor)) break
    if (page === maxPages - 1) {
      throw new Error(`Facebook pagination exceeded ${maxPages} pages for ${endpoint}`)
    }
    seenCursors.add(nextCursor)
    after = nextCursor
  }

  return results
}
