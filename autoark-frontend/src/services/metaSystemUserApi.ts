import { API_BASE_URL, authFetch } from './api'

export type MetaAsset = {
  assetId: string
  name?: string
  source?: 'owned' | 'client' | 'assigned' | 'unknown'
  accountIds?: string[]
  cachedAssignment?: {
    organizationId?: string
    name?: string
    operator?: string
    status?: string
  }
}

export type MetaCredentialSummary = {
  id: string
  status: 'provisioning' | 'active' | 'invalid' | 'inactive'
  isDefault: boolean
  businessId: string
  businessName?: string
  systemUserId: string
  systemUserName: string
  tokenFingerprint: string
  lastValidatedAt?: string
  expiresAt?: string
  assetCounts: {
    adAccounts: number
    pages: number
    pixels: number
  }
}

export type MigrationOrganization = {
  id: string
  name: string
  status: string
  suggestedAssets: {
    adAccounts: MetaAsset[]
    pages: MetaAsset[]
    pixels: MetaAsset[]
  }
  sourceSnapshots: Array<{
    tokenId?: string
    fbUserId?: string
    fbUserName?: string
    lastSyncedAt?: string
    syncStatus?: string
  }>
  credentials: MetaCredentialSummary[]
}

export type MigrationInventory = {
  apps: Array<{
    id: string
    appId: string
    appName: string
    status: string
    isValid: boolean
    enabledForBulkAds: boolean
  }>
  organizations: MigrationOrganization[]
}

export type BootstrapToken = {
  id: string
  organizationId?: string
  optimizer?: string
  status: string
  fbUserId?: string
  fbUserName?: string
  lastCheckedAt?: string
  expiresAt?: string
  updatedAt?: string
}

export type MetaBusiness = {
  id: string
  name?: string
  verificationStatus?: string
}

export type BusinessInventory = {
  business: MetaBusiness
  systemUsers: Array<{
    id: string
    name?: string
    role?: string
    createdTime?: string
  }>
  assets: {
    adAccounts: MetaAsset[]
    pages: MetaAsset[]
    pixels: MetaAsset[]
    apps: MetaAsset[]
  }
  warnings: Array<{
    edge?: string
    message?: string
    code?: number
    subcode?: number
  }>
}

export type ProvisionInput = {
  organizationId: string
  facebookAppId: string
  bootstrapTokenId: string
  businessId: string
  systemUserId?: string
  systemUserName?: string
  isDefault: boolean
  assets: {
    adAccountIds: string[]
    pageIds: string[]
    pixels: Array<{ assetId: string; accountIds: string[] }>
  }
}

const requestJson = async <T>(
  path: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<T> => {
  const response = await authFetch(`${API_BASE_URL}${path}`, options)
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body?.success === false) {
    throw new Error(body?.error || body?.message || `Request failed (${response.status})`)
  }
  return body.data as T
}

export const getMetaMigrationInventory = () => requestJson<MigrationInventory>(
  '/api/meta-business-credentials/migration-inventory',
)

export const getMetaBootstrapTokens = () => requestJson<BootstrapToken[]>(
  '/api/meta-business-credentials/bootstrap-tokens',
)

export const discoverMetaBusinesses = (bootstrapTokenId: string) => (
  requestJson<MetaBusiness[]>('/api/meta-business-credentials/discover-businesses', {
    method: 'POST',
    body: JSON.stringify({ bootstrapTokenId }),
    timeoutMs: 60000,
  })
)

export const inspectMetaBusiness = (
  bootstrapTokenId: string,
  businessId: string,
) => requestJson<BusinessInventory>('/api/meta-business-credentials/inspect-business', {
  method: 'POST',
  body: JSON.stringify({ bootstrapTokenId, businessId }),
  timeoutMs: 90000,
})

export const getMetaProvisionPlan = (input: ProvisionInput) => (
  requestJson<any>('/api/meta-business-credentials/provision-plan', {
    method: 'POST',
    body: JSON.stringify(input),
    timeoutMs: 90000,
  })
)

export const provisionMetaSystemUser = (input: ProvisionInput) => (
  requestJson<any>('/api/meta-business-credentials/provision', {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      confirmation: 'PROVISION_SYSTEM_USER',
    }),
    timeoutMs: 120000,
  })
)

export const validateMetaCredential = (credentialId: string) => (
  requestJson<any>(`/api/meta-business-credentials/${credentialId}/validate`, {
    method: 'POST',
    body: JSON.stringify({}),
    timeoutMs: 90000,
  })
)

export const deactivateMetaCredential = (credentialId: string) => (
  requestJson<any>(`/api/meta-business-credentials/${credentialId}/deactivate`, {
    method: 'POST',
    body: JSON.stringify({
      confirmation: 'DEACTIVATE_SYSTEM_USER_CREDENTIAL',
    }),
  })
)
