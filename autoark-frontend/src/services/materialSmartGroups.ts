import { authFetch } from './api'

export type MaterialSmartGroupStatus = 'active' | 'disabled' | 'unavailable' | 'paused'

export interface MaterialSmartGroupNode {
  key: string
  type:
    | 'facebook-root'
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

export const loadMaterialSmartGroups = async (): Promise<MaterialSmartGroupNode[]> => {
  const response = await authFetch('/api/materials/smart-groups')
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
  return readJson<MaterialOriginsResult>(response, '来源详情暂不可用')
}

export const loadExternalMaterialStatus = async (): Promise<ExternalMaterialStatus> => {
  const response = await authFetch('/api/materials/external/guangdada/status')
  return readJson<ExternalMaterialStatus>(response, '同步状态暂不可用')
}

export const requestExternalMaterialSync = async ({
  dryRun,
  mode,
}: {
  dryRun: boolean
  mode: 'scheduled' | 'canary10'
}): Promise<void> => {
  const response = await authFetch('/api/materials/external/guangdada/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dryRun, mode }),
  })
  await readJson(response, '同步请求失败')
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
