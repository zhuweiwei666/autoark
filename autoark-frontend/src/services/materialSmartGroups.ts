import { authFetch } from './api'

export type MaterialSmartGroupStatus = 'active' | 'disabled' | 'unavailable' | 'paused'

export interface MaterialSmartGroupNode {
  key: string
  type:
    | 'facebook-root'
    | 'facebook-optimizer'
    | 'facebook-account'
    | 'external-root'
    | 'external-provider'
    | 'external-package'
  label: string
  count: number
  status?: MaterialSmartGroupStatus
  paused?: boolean
  children?: MaterialSmartGroupNode[]
}

export type MaterialSelection =
  | { kind: 'all' }
  | { kind: 'folder'; path: string }
  | { kind: 'smart'; type: string; key: string; label: string }

export interface MaterialOriginSummary {
  provider: string
  label: string
  advertiser?: string
  heat?: number
  estimatedValue?: number
  firstSeenAt?: string
  lastSeenAt?: string
  mediaType?: 'image' | 'video'
  sourcePageUrl?: string
}

export interface MaterialOriginsResult {
  origins: MaterialOriginSummary[]
  total: number
  hasMore: boolean
}

export interface ExternalSyncCounters {
  discovered: number
  considered: number
  alreadySeen: number
  downloaded: number
  contentReused: number
  newlyCreated: number
  invalid: number
  failed: number
  deferred: number
}

export interface ExternalMaterialStatus {
  provider: 'guangdada'
  status: MaterialSmartGroupStatus
  paused: boolean
  pauseReason: string | null
  recurringEnabled: boolean
  lastRun: null | {
    mode: string
    dryRun: boolean
    request: { recentDays?: number; limit?: number }
    status: string
    counters: ExternalSyncCounters
    startedAt?: string
    completedAt?: string
  }
}

export interface ExternalMaterialSyncResult {
  provider: 'guangdada'
  mode: string
  dryRun: boolean
  request: {
    recentDays: number
    limit: number
  }
  status: 'queued' | 'duplicate' | 'disabled' | 'unavailable'
  enqueued: boolean
}

export const EXTERNAL_SYNC_MODES = {
  dryRun: { mode: 'scheduled', dryRun: true },
  syncNow: { mode: 'canary10', dryRun: false },
} as const

export class MaterialSmartGroupRequestError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'MaterialSmartGroupRequestError'
    this.status = status
  }
}

export interface LatestRequestHandlers<T> {
  onStart?: () => void
  onSuccess: (value: T) => void
  onError?: (error: unknown) => void
  onSettled?: () => void
}

export const toggleSmartGroupExpansion = (
  expanded: ReadonlySet<string>,
  nodeId: string,
): Set<string> => {
  const next = new Set(expanded)
  if (next.has(nodeId)) {
    next.delete(nodeId)
  } else {
    next.add(nodeId)
  }
  return next
}

export const createLatestRequestRunner = () => {
  let latestRequestId = 0
  let activeController: AbortController | null = null

  const abort = () => {
    latestRequestId += 1
    activeController?.abort()
    activeController = null
  }

  const run = async <T>(
    request: (signal: AbortSignal) => Promise<T>,
    handlers: LatestRequestHandlers<T>,
  ): Promise<void> => {
    const requestId = ++latestRequestId
    activeController?.abort()
    const controller = new AbortController()
    activeController = controller
    handlers.onStart?.()

    try {
      const value = await request(controller.signal)
      if (requestId === latestRequestId) {
        handlers.onSuccess(value)
      }
    } catch (error) {
      if (requestId === latestRequestId && !controller.signal.aborted) {
        handlers.onError?.(error)
      }
    } finally {
      if (requestId === latestRequestId) {
        activeController = null
        handlers.onSettled?.()
      }
    }
  }

  return { run, abort }
}

const readJson = async <T>(response: Response, fallback: string): Promise<T> => {
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.success) {
    throw new MaterialSmartGroupRequestError(
      payload?.message || payload?.error || fallback,
      response.status,
    )
  }
  return payload.data as T
}

export const loadMaterialSmartGroups = async (
  signal?: AbortSignal,
): Promise<MaterialSmartGroupNode[]> => {
  const response = await authFetch('/api/materials/smart-groups', { signal })
  return readJson<MaterialSmartGroupNode[]>(response, '智能分组暂不可用')
}

export const buildMaterialQuery = ({
  selection,
  page,
  pageSize,
  type,
  search,
}: {
  selection: MaterialSelection
  page: number
  pageSize: number
  type?: string
  search?: string
}): URLSearchParams => {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  })
  if (type) params.set('type', type)
  if (search) params.set('search', search)
  if (selection.kind === 'folder' && selection.path) {
    params.set('folder', selection.path)
  }
  if (selection.kind === 'smart') {
    params.set('smartGroupType', selection.type)
    params.set('smartGroupKey', selection.key)
  }
  return params
}

export const loadMaterialOrigins = async (
  materialId: string,
): Promise<MaterialOriginsResult> => {
  const response = await authFetch(`/api/materials/${encodeURIComponent(materialId)}/origins`)
  return readMaterialOriginsResponse(response)
}

export const readMaterialOriginsResponse = async (
  response: Response,
): Promise<MaterialOriginsResult> => {
  if (response.status === 404) {
    return { origins: [], total: 0, hasMore: false }
  }
  return readJson<MaterialOriginsResult>(response, '来源详情暂不可用')
}

export const loadExternalMaterialStatus = async (
  signal?: AbortSignal,
): Promise<ExternalMaterialStatus> => {
  const response = await authFetch('/api/materials/external/guangdada/status', { signal })
  return readJson<ExternalMaterialStatus>(response, '同步状态暂不可用')
}

export const requestExternalMaterialSync = async ({
  dryRun,
  mode,
}: {
  dryRun: boolean
  mode: 'scheduled' | 'canary10'
}): Promise<ExternalMaterialSyncResult> => {
  const response = await authFetch('/api/materials/external/guangdada/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dryRun, mode }),
  })
  return readExternalMaterialSyncResponse(response)
}

export const readExternalMaterialSyncResponse = async (
  response: Response,
): Promise<ExternalMaterialSyncResult> => {
  const payload = await response.json().catch(() => null)
  const isDuplicate = response.status === 409 &&
    payload?.success === true &&
    payload?.data?.status === 'duplicate' &&
    payload?.data?.enqueued === false
  if (isDuplicate) {
    return payload.data as ExternalMaterialSyncResult
  }
  if (!response.ok && payload?.data?.status === 'disabled') {
    throw new MaterialSmartGroupRequestError('外部素材同步未启用', response.status)
  }
  if (
    !response.ok &&
    payload?.success === true &&
    payload?.data?.status === 'unavailable'
  ) {
    throw new MaterialSmartGroupRequestError(
      '外部素材同步服务暂不可用',
      response.status,
    )
  }
  if (!response.ok || !payload?.success) {
    throw new MaterialSmartGroupRequestError(
      payload?.message || payload?.error || '同步请求失败',
      response.status,
    )
  }
  return payload.data as ExternalMaterialSyncResult
}

export const externalMaterialSyncFeedback = (
  result: ExternalMaterialSyncResult,
  action: string,
): string => {
  if (result.status === 'duplicate') return '已有任务运行中'
  if (result.status === 'disabled') return '外部素材同步未启用'
  if (result.status === 'unavailable') return '外部素材同步服务暂不可用'
  return `${action}请求已提交`
}

export const setExternalMaterialPaused = async (paused: boolean): Promise<void> => {
  const action = paused ? 'pause' : 'resume'
  const response = await authFetch(`/api/materials/external/guangdada/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  await readJson(response, paused ? '暂停同步失败' : '恢复同步失败')
}
