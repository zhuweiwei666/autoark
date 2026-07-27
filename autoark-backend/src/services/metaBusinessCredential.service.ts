import mongoose from 'mongoose'
import Account from '../models/Account'
import FacebookApp from '../models/FacebookApp'
import FbToken from '../models/FbToken'
import FacebookUser from '../models/FacebookUser'
import MetaBusinessCredential from '../models/MetaBusinessCredential'
import Organization from '../models/Organization'
import { facebookClient } from '../integration/facebook/facebookClient'
import { normalizeForStorage } from '../utils/accountId'
import {
  decryptMetaToken,
  encryptMetaToken,
  fingerprintMetaToken,
} from '../utils/metaCredentialCrypto'
import { redactSensitiveData } from '../utils/sensitiveData'

const GRAPH_ID_PATTERN = /^[A-Za-z0-9_.-]+$/
const MAX_GRAPH_PAGES = 10
const GRAPH_PAGE_LIMIT = 100
const DEFAULT_SCOPES = [
  'ads_management',
  'ads_read',
  'business_management',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_ads',
]
const AD_ACCOUNT_TASKS = ['ADVERTISE', 'ANALYZE']
const PAGE_TASKS = ['ADVERTISE', 'ANALYZE']
const PIXEL_TASKS = ['ADVERTISE', 'ANALYZE']

type AssetKind = 'adAccounts' | 'pages' | 'pixels'
type MetaAsset = {
  assetId: string
  name?: string
  source: 'owned' | 'client' | 'assigned' | 'unknown'
  accountStatus?: number
  currency?: string
  timezoneName?: string
}

type DesiredPixel = {
  assetId: string
  accountIds: string[]
}

export interface ProvisionSystemUserInput {
  organizationId: string
  facebookAppId: string
  bootstrapTokenId: string
  businessId: string
  systemUserId?: string
  systemUserName?: string
  isDefault?: boolean
  assets: {
    adAccountIds?: string[]
    pageIds?: string[]
    pixels?: Array<string | { assetId?: string; id?: string; accountIds?: string[] }>
  }
}

type SafeEdgeResult = {
  items: any[]
  warning?: {
    edge: string
    message: string
    code?: number
    subcode?: number
  }
}

const inputError = (message: string, statusCode = 400) => {
  const error: any = new Error(message)
  error.statusCode = statusCode
  return error
}

const requiredObjectId = (value: any, field: string) => {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw inputError(`${field} is invalid`)
  }
  return id
}

const requiredGraphId = (value: any, field: string) => {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!id || !GRAPH_ID_PATTERN.test(id)) {
    throw inputError(`${field} is invalid`)
  }
  return id
}

const optionalGraphId = (value: any, field: string) => {
  if (value === undefined || value === null || value === '') return undefined
  return requiredGraphId(value, field)
}

const uniqueGraphIds = (values: any, field: string) => {
  if (values === undefined) return []
  if (!Array.isArray(values)) throw inputError(`${field} must be an array`)
  return Array.from(new Set(values.map((value, index) => (
    requiredGraphId(value, `${field}[${index}]`)
  ))))
}

const metaErrorSummary = (error: any) => ({
  message: String(error?.userMessage || error?.message || 'Meta Graph API request failed')
    .replace(/\bEAA[A-Za-z0-9_-]{12,}/g, '[REDACTED_FB_TOKEN]')
    .slice(0, 500),
  code: error?.code || error?.response?.error?.code || error?.response?.data?.error?.code,
  subcode: error?.subcode
    || error?.response?.error?.error_subcode
    || error?.response?.data?.error?.error_subcode,
})

const graphGetAll = async (
  endpoint: string,
  token: string,
  params: Record<string, any> = {},
) => {
  const items: any[] = []
  let after: string | undefined
  for (let page = 0; page < MAX_GRAPH_PAGES; page += 1) {
    const response = await facebookClient.get(endpoint, {
      ...params,
      access_token: token,
      limit: GRAPH_PAGE_LIMIT,
      ...(after ? { after } : {}),
    })
    const pageItems = Array.isArray(response?.data) ? response.data : []
    items.push(...pageItems)
    after = response?.paging?.cursors?.after
    if (!response?.paging?.next || !after) break
  }
  return items
}

const safeGraphEdge = async (
  edge: string,
  token: string,
  params: Record<string, any> = {},
): Promise<SafeEdgeResult> => {
  try {
    return { items: await graphGetAll(edge, token, params) }
  } catch (error: any) {
    return {
      items: [],
      warning: {
        edge,
        ...metaErrorSummary(error),
      },
    }
  }
}

const findBootstrapToken = async (bootstrapTokenId: string) => {
  const tokenId = requiredObjectId(bootstrapTokenId, 'bootstrapTokenId')
  const token: any = await FbToken.findOne({
    _id: tokenId,
    status: 'active',
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: null },
      { expiresAt: { $gt: new Date() } },
    ],
  }).lean()
  if (!token?.token) {
    throw inputError('Active bootstrap Facebook token not found', 404)
  }
  return token
}

const mapAdAccount = (
  value: any,
  source: MetaAsset['source'],
): MetaAsset | undefined => {
  const assetId = normalizeForStorage(value?.account_id || value?.id)
  if (!assetId) return undefined
  return {
    assetId,
    name: value?.name,
    source,
    accountStatus: value?.account_status,
    currency: value?.currency,
    timezoneName: value?.timezone_name,
  }
}

const mapAsset = (
  value: any,
  source: MetaAsset['source'],
): MetaAsset | undefined => {
  const assetId = value?.id ? String(value.id) : ''
  if (!assetId || !GRAPH_ID_PATTERN.test(assetId)) return undefined
  return {
    assetId,
    name: value?.name,
    source,
  }
}

const mergeAssets = (values: Array<MetaAsset | undefined>) => {
  const byId = new Map<string, MetaAsset>()
  values.filter(Boolean).forEach((asset) => {
    const current = asset as MetaAsset
    const existing = byId.get(current.assetId)
    if (!existing || existing.source === 'client') {
      byId.set(current.assetId, current)
    }
  })
  return Array.from(byId.values()).sort((left, right) => (
    String(left.name || left.assetId).localeCompare(String(right.name || right.assetId))
  ))
}

const normalizePixels = (values: ProvisionSystemUserInput['assets']['pixels']) => {
  if (values === undefined) return [] as DesiredPixel[]
  if (!Array.isArray(values)) throw inputError('assets.pixels must be an array')
  const byId = new Map<string, DesiredPixel>()
  values.forEach((value, index) => {
    const rawId = typeof value === 'string' ? value : value?.assetId || value?.id
    const assetId = requiredGraphId(rawId, `assets.pixels[${index}]`)
    const accountIds = typeof value === 'string'
      ? []
      : uniqueGraphIds(value.accountIds || [], `assets.pixels[${index}].accountIds`)
        .map(normalizeForStorage)
        .filter(Boolean)
    const current = byId.get(assetId)
    byId.set(assetId, {
      assetId,
      accountIds: Array.from(new Set([...(current?.accountIds || []), ...accountIds])),
    })
  })
  return Array.from(byId.values())
}

const normalizeProvisionInput = (input: ProvisionSystemUserInput) => ({
  organizationId: requiredObjectId(input?.organizationId, 'organizationId'),
  facebookAppId: requiredObjectId(input?.facebookAppId, 'facebookAppId'),
  bootstrapTokenId: requiredObjectId(input?.bootstrapTokenId, 'bootstrapTokenId'),
  businessId: requiredGraphId(input?.businessId, 'businessId'),
  systemUserId: optionalGraphId(input?.systemUserId, 'systemUserId'),
  systemUserName: typeof input?.systemUserName === 'string'
    ? input.systemUserName.trim().slice(0, 120)
    : '',
  isDefault: input?.isDefault !== false,
  assets: {
    adAccountIds: uniqueGraphIds(
      input?.assets?.adAccountIds || [],
      'assets.adAccountIds',
    ).map(normalizeForStorage).filter(Boolean),
    pageIds: uniqueGraphIds(input?.assets?.pageIds || [], 'assets.pageIds'),
    pixels: normalizePixels(input?.assets?.pixels),
  },
})

const getRequestedAssetCount = (input: ReturnType<typeof normalizeProvisionInput>) => (
  input.assets.adAccountIds.length
  + input.assets.pageIds.length
  + input.assets.pixels.length
)

const getAssetEndpoint = (kind: AssetKind, assetId: string) => (
  kind === 'adAccounts' ? `/act_${normalizeForStorage(assetId)}` : `/${assetId}`
)

const getAssetTasks = (kind: AssetKind) => {
  if (kind === 'adAccounts') return AD_ACCOUNT_TASKS
  if (kind === 'pages') return PAGE_TASKS
  return PIXEL_TASKS
}

const checkAssignedUser = async (
  token: string,
  businessId: string,
  systemUserId: string,
  kind: AssetKind,
  assetId: string,
) => {
  const endpoint = `${getAssetEndpoint(kind, assetId)}/assigned_users`
  const result = await safeGraphEdge(endpoint, token, {
    business: businessId,
    fields: 'id,name,user_type',
  })
  return {
    assigned: result.items.some((user) => String(user?.id) === systemUserId),
    warning: result.warning,
  }
}

const buildAssetGrant = (
  asset: MetaAsset,
  kind: AssetKind,
  accountIds: string[] = [],
) => ({
  assetId: asset.assetId,
  name: asset.name,
  tasks: getAssetTasks(kind),
  source: asset.source,
  accountIds,
  accountStatus: asset.accountStatus,
  currency: asset.currency,
  timezoneName: asset.timezoneName,
  readbackVerifiedAt: new Date(),
})

const validateRequestedAssets = (
  input: ReturnType<typeof normalizeProvisionInput>,
  inventory: Awaited<ReturnType<typeof inspectBusiness>>,
) => {
  const available = {
    adAccounts: new Map(inventory.assets.adAccounts.map((item) => [item.assetId, item])),
    pages: new Map(inventory.assets.pages.map((item) => [item.assetId, item])),
    pixels: new Map(inventory.assets.pixels.map((item) => [item.assetId, item])),
  }
  const missing = {
    adAccountIds: input.assets.adAccountIds.filter((id) => !available.adAccounts.has(id)),
    pageIds: input.assets.pageIds.filter((id) => !available.pages.has(id)),
    pixelIds: input.assets.pixels
      .map((pixel) => pixel.assetId)
      .filter((id) => !available.pixels.has(id)),
  }
  if (missing.adAccountIds.length || missing.pageIds.length || missing.pixelIds.length) {
    throw inputError(
      `Requested Meta assets are not visible in business ${input.businessId}: ${JSON.stringify(missing)}`,
    )
  }
  return available
}

export const listCredentials = async (organizationId?: string) => {
  const query: any = {}
  if (organizationId) {
    query.organizationId = requiredObjectId(organizationId, 'organizationId')
  }
  return MetaBusinessCredential.find(query)
    .sort({ organizationId: 1, isDefault: -1, updatedAt: -1 })
    .lean()
}

export const listBootstrapTokens = async () => {
  const tokens: any[] = await FbToken.find({})
    .select(
      '_id userId organizationId optimizer status fbUserId fbUserName '
      + 'lastCheckedAt lastValidationAttemptAt expiresAt lastAuthAppId updatedAt',
    )
    .sort({ status: 1, updatedAt: -1 })
    .lean()
  return tokens.map((token) => ({
    id: String(token._id),
    userId: token.userId,
    organizationId: token.organizationId ? String(token.organizationId) : undefined,
    optimizer: token.optimizer,
    status: token.status,
    fbUserId: token.fbUserId,
    fbUserName: token.fbUserName,
    lastCheckedAt: token.lastCheckedAt,
    lastValidationAttemptAt: token.lastValidationAttemptAt,
    expiresAt: token.expiresAt,
    lastAuthAppId: token.lastAuthAppId,
    updatedAt: token.updatedAt,
  }))
}

export const getMigrationInventory = async () => {
  const [organizations, apps, accounts, snapshots, credentials] = await Promise.all([
    Organization.find({})
      .select('_id name status')
      .sort({ name: 1 })
      .lean(),
    FacebookApp.find({ status: 'active' })
      .select('_id appId appName status validation config.enabledForBulkAds')
      .sort({ appName: 1 })
      .lean(),
    Account.find({
      channel: 'facebook',
      organizationId: { $exists: true, $ne: null },
    })
      .select('accountId name organizationId status operator')
      .sort({ organizationId: 1, name: 1 })
      .lean(),
    FacebookUser.find({
      organizationId: { $exists: true, $ne: null },
    })
      .select(
        'organizationId tokenId fbUserId fbUserName lastSyncedAt syncStatus '
        + 'adAccounts.accountId adAccounts.name '
        + 'pages.pageId pages.name pages.accounts.accountId '
        + 'pixels.pixelId pixels.name pixels.accounts.accountId',
      )
      .lean(),
    MetaBusinessCredential.find({})
      .sort({ organizationId: 1, isDefault: -1, updatedAt: -1 })
      .lean(),
  ])

  const accountByOrganization = new Map<string, any[]>()
  accounts.forEach((account: any) => {
    const organizationId = String(account.organizationId)
    const list = accountByOrganization.get(organizationId) || []
    list.push({
      assetId: normalizeForStorage(account.accountId),
      name: account.name,
      status: account.status,
      operator: account.operator,
    })
    accountByOrganization.set(organizationId, list)
  })

  const snapshotByOrganization = new Map<string, any[]>()
  snapshots.forEach((snapshot: any) => {
    const organizationId = String(snapshot.organizationId)
    const list = snapshotByOrganization.get(organizationId) || []
    list.push(snapshot)
    snapshotByOrganization.set(organizationId, list)
  })

  const credentialByOrganization = new Map<string, any[]>()
  credentials.forEach((credential: any) => {
    const organizationId = String(credential.organizationId)
    const list = credentialByOrganization.get(organizationId) || []
    list.push(credential)
    credentialByOrganization.set(organizationId, list)
  })

  const dedupeSuggestedAssets = (
    values: any[],
    idField: 'pageId' | 'pixelId',
    accountIds: Set<string>,
  ) => {
    const byId = new Map<string, any>()
    values.forEach((asset: any) => {
      const assetId = String(asset?.[idField] || '')
      if (!assetId) return
      const linkedAccountIds = (asset.accounts || [])
        .map((item: any) => normalizeForStorage(item?.accountId))
        .filter(Boolean)
      if (
        linkedAccountIds.length > 0
        && !linkedAccountIds.some((accountId: string) => accountIds.has(accountId))
      ) {
        return
      }
      const existing = byId.get(assetId)
      byId.set(assetId, {
        assetId,
        name: asset.name || existing?.name,
        accountIds: Array.from(new Set([
          ...(existing?.accountIds || []),
          ...linkedAccountIds.filter((accountId: string) => accountIds.has(accountId)),
        ])),
      })
    })
    return Array.from(byId.values())
  }

  return {
    apps: apps.map((app: any) => ({
      id: String(app._id),
      appId: String(app.appId),
      appName: app.appName,
      status: app.status,
      isValid: app.validation?.isValid === true,
      enabledForBulkAds: app.config?.enabledForBulkAds !== false,
    })),
    organizations: organizations.map((organization: any) => {
      const organizationId = String(organization._id)
      const assignedAccounts = accountByOrganization.get(organizationId) || []
      const accountIds = new Set(
        assignedAccounts.map((account) => normalizeForStorage(account.assetId)),
      )
      const organizationSnapshots = snapshotByOrganization.get(organizationId) || []
      const pages = dedupeSuggestedAssets(
        organizationSnapshots.flatMap((snapshot) => snapshot.pages || []),
        'pageId',
        accountIds,
      )
      const pixels = dedupeSuggestedAssets(
        organizationSnapshots.flatMap((snapshot) => snapshot.pixels || []),
        'pixelId',
        accountIds,
      )
      const organizationCredentials = credentialByOrganization.get(organizationId) || []

      return {
        id: organizationId,
        name: organization.name,
        status: organization.status,
        suggestedAssets: {
          adAccounts: assignedAccounts,
          pages,
          pixels,
        },
        sourceSnapshots: organizationSnapshots.map((snapshot: any) => ({
          tokenId: snapshot.tokenId ? String(snapshot.tokenId) : undefined,
          fbUserId: snapshot.fbUserId,
          fbUserName: snapshot.fbUserName,
          lastSyncedAt: snapshot.lastSyncedAt,
          syncStatus: snapshot.syncStatus,
        })),
        credentials: organizationCredentials.map((credential: any) => ({
          id: String(credential._id),
          status: credential.status,
          isDefault: credential.isDefault,
          businessId: credential.businessId,
          businessName: credential.businessName,
          systemUserId: credential.systemUserId,
          systemUserName: credential.systemUserName,
          tokenFingerprint: credential.tokenFingerprint,
          lastValidatedAt: credential.lastValidatedAt,
          expiresAt: credential.expiresAt,
          assetCounts: {
            adAccounts: credential.assetGrants?.adAccounts?.length || 0,
            pages: credential.assetGrants?.pages?.length || 0,
            pixels: credential.assetGrants?.pixels?.length || 0,
          },
        })),
      }
    }),
  }
}

export const discoverBusinesses = async (bootstrapTokenId: string) => {
  const token = await findBootstrapToken(bootstrapTokenId)
  const businesses = await graphGetAll('/me/businesses', token.token, {
    fields: 'id,name,verification_status,primary_page,timezone_id,vertical',
  })
  return businesses.map((business) => ({
    id: String(business.id),
    name: business.name,
    verificationStatus: business.verification_status,
    primaryPage: business.primary_page,
    timezoneId: business.timezone_id,
    vertical: business.vertical,
  }))
}

export const inspectBusiness = async (
  bootstrapTokenId: string,
  businessIdValue: string,
) => {
  const token = await findBootstrapToken(bootstrapTokenId)
  const businessId = requiredGraphId(businessIdValue, 'businessId')
  const business = await facebookClient.get(`/${businessId}`, {
    access_token: token.token,
    fields: 'id,name,verification_status,primary_page,timezone_id,vertical',
  })

  const edgeDefinitions = [
    {
      key: 'systemUsers',
      edge: `/${businessId}/system_users`,
      fields: 'id,name,role,created_time,created_by',
    },
    {
      key: 'ownedAdAccounts',
      edge: `/${businessId}/owned_ad_accounts`,
      fields: 'id,account_id,name,account_status,currency,timezone_name',
    },
    {
      key: 'clientAdAccounts',
      edge: `/${businessId}/client_ad_accounts`,
      fields: 'id,account_id,name,account_status,currency,timezone_name',
    },
    {
      key: 'ownedPages',
      edge: `/${businessId}/owned_pages`,
      fields: 'id,name',
    },
    {
      key: 'clientPages',
      edge: `/${businessId}/client_pages`,
      fields: 'id,name',
    },
    {
      key: 'ownedPixels',
      edge: `/${businessId}/owned_pixels`,
      fields: 'id,name,owner_business,is_created_by_business,last_fired_time',
    },
    {
      key: 'clientPixels',
      edge: `/${businessId}/client_pixels`,
      fields: 'id,name,owner_business,is_created_by_business,last_fired_time',
    },
    {
      key: 'ownedApps',
      edge: `/${businessId}/owned_apps`,
      fields: 'id,name',
    },
    {
      key: 'clientApps',
      edge: `/${businessId}/client_apps`,
      fields: 'id,name',
    },
  ] as const

  const results = await Promise.all(edgeDefinitions.map(async (definition) => ({
    key: definition.key,
    result: await safeGraphEdge(definition.edge, token.token, {
      fields: definition.fields,
    }),
  })))
  const byKey = Object.fromEntries(results.map(({ key, result }) => [key, result])) as any
  const warnings = results
    .map(({ result }) => result.warning)
    .filter(Boolean)

  const adAccounts = mergeAssets([
    ...byKey.ownedAdAccounts.items.map((value: any) => mapAdAccount(value, 'owned')),
    ...byKey.clientAdAccounts.items.map((value: any) => mapAdAccount(value, 'client')),
  ])
  const pages = mergeAssets([
    ...byKey.ownedPages.items.map((value: any) => mapAsset(value, 'owned')),
    ...byKey.clientPages.items.map((value: any) => mapAsset(value, 'client')),
  ])
  const pixels = mergeAssets([
    ...byKey.ownedPixels.items.map((value: any) => mapAsset(value, 'owned')),
    ...byKey.clientPixels.items.map((value: any) => mapAsset(value, 'client')),
  ])
  const apps = mergeAssets([
    ...byKey.ownedApps.items.map((value: any) => mapAsset(value, 'owned')),
    ...byKey.clientApps.items.map((value: any) => mapAsset(value, 'client')),
  ])

  const cachedAccounts: any[] = adAccounts.length > 0
    ? await Account.find({
        channel: 'facebook',
        accountId: { $in: adAccounts.map((account) => account.assetId) },
      })
      .select('accountId organizationId name operator status')
      .lean()
    : []
  const cachedById = new Map(cachedAccounts.map((account) => [
    normalizeForStorage(account.accountId),
    {
      organizationId: account.organizationId ? String(account.organizationId) : undefined,
      name: account.name,
      operator: account.operator,
      status: account.status,
    },
  ]))

  return {
    business: {
      id: String(business.id),
      name: business.name,
      verificationStatus: business.verification_status,
      primaryPage: business.primary_page,
      timezoneId: business.timezone_id,
      vertical: business.vertical,
    },
    systemUsers: byKey.systemUsers.items.map((systemUser: any) => ({
      id: String(systemUser.id),
      name: systemUser.name,
      role: systemUser.role,
      createdTime: systemUser.created_time,
      createdBy: systemUser.created_by,
    })),
    assets: {
      adAccounts: adAccounts.map((account) => ({
        ...account,
        cachedAssignment: cachedById.get(account.assetId),
      })),
      pages,
      pixels,
      apps,
    },
    warnings,
  }
}

export const buildProvisionPlan = async (rawInput: ProvisionSystemUserInput) => {
  const input = normalizeProvisionInput(rawInput)
  if (getRequestedAssetCount(input) === 0) {
    throw inputError('At least one ad account, Page, or Pixel is required')
  }

  const [organization, app, inventory] = await Promise.all([
    Organization.findById(input.organizationId).select('_id name status').lean(),
    FacebookApp.findById(input.facebookAppId)
      .select('_id appId appName status validation config')
      .lean(),
    inspectBusiness(input.bootstrapTokenId, input.businessId),
  ])
  if (!organization) throw inputError('Organization not found', 404)
  if (organization.status !== 'active') {
    throw inputError('Organization must be active before provisioning Meta assets')
  }
  if (!app) throw inputError('Facebook App not found', 404)
  if (app.status !== 'active' || app.validation?.isValid !== true) {
    throw inputError('Facebook App is not active and credential-valid')
  }

  const availableAppIds = new Set(inventory.assets.apps.map((item) => item.assetId))
  if (!availableAppIds.has(String(app.appId))) {
    throw inputError(
      `Facebook App ${app.appId} is not owned by or shared with business ${input.businessId}`,
    )
  }

  const available = validateRequestedAssets(input, inventory)
  let systemUser = input.systemUserId
    ? inventory.systemUsers.find((item) => item.id === input.systemUserId)
    : undefined
  if (input.systemUserId && !systemUser) {
    throw inputError('Selected System User is not part of the selected business')
  }
  if (!systemUser && input.systemUserName) {
    systemUser = inventory.systemUsers.find((item) => item.name === input.systemUserName)
  }
  if (systemUser && systemUser.role !== 'EMPLOYEE') {
    throw inputError(
      'Selected System User must use the EMPLOYEE role; create a dedicated least-privilege publisher instead',
    )
  }

  const bootstrapToken = await findBootstrapToken(input.bootstrapTokenId)
  const desiredAssets: Array<{
    kind: AssetKind
    assetId: string
    name?: string
    source: MetaAsset['source']
    accountIds: string[]
    accountStatus?: number
    currency?: string
    timezoneName?: string
  }> = [
    ...input.assets.adAccountIds.map((assetId) => ({
      kind: 'adAccounts' as const,
      assetId,
      name: available.adAccounts.get(assetId)?.name,
      source: available.adAccounts.get(assetId)?.source || 'unknown' as const,
      accountIds: [] as string[],
      accountStatus: available.adAccounts.get(assetId)?.accountStatus,
      currency: available.adAccounts.get(assetId)?.currency,
      timezoneName: available.adAccounts.get(assetId)?.timezoneName,
    })),
    ...input.assets.pageIds.map((assetId) => ({
      kind: 'pages' as const,
      assetId,
      name: available.pages.get(assetId)?.name,
      source: available.pages.get(assetId)?.source || 'unknown' as const,
      accountIds: [] as string[],
      accountStatus: undefined,
      currency: undefined,
      timezoneName: undefined,
    })),
    ...input.assets.pixels.map((pixel) => ({
      kind: 'pixels' as const,
      assetId: pixel.assetId,
      name: available.pixels.get(pixel.assetId)?.name,
      source: available.pixels.get(pixel.assetId)?.source || 'unknown' as const,
      accountIds: pixel.accountIds,
      accountStatus: undefined,
      currency: undefined,
      timezoneName: undefined,
    })),
  ]

  const assignmentChecks = systemUser
    ? await Promise.all(desiredAssets.map(async (asset) => ({
        ...asset,
        ...await checkAssignedUser(
          bootstrapToken.token,
          input.businessId,
          systemUser!.id,
          asset.kind,
          asset.assetId,
        ),
      })))
    : desiredAssets.map((asset) => ({ ...asset, assigned: false }))
  const existingCredential: any = systemUser
    ? await MetaBusinessCredential.findOne({
        organizationId: input.organizationId,
        businessId: input.businessId,
        systemUserId: systemUser.id,
        facebookAppId: input.facebookAppId,
      }).lean()
    : null

  return {
    input,
    organization: {
      id: String(organization._id),
      name: organization.name,
      status: organization.status,
    },
    app: {
      id: String(app._id),
      appId: String(app.appId),
      appName: app.appName,
    },
    business: inventory.business,
    systemUser: systemUser || null,
    existingCredential: existingCredential
      ? {
          id: String(existingCredential._id),
          status: existingCredential.status,
          tokenFingerprint: existingCredential.tokenFingerprint,
          lastValidatedAt: existingCredential.lastValidatedAt,
          lastReconciledAt: existingCredential.lastReconciledAt,
        }
      : null,
    willCreateSystemUser: !systemUser,
    desiredAssets: assignmentChecks.map((asset) => ({
      kind: asset.kind,
      assetId: asset.assetId,
      name: asset.name,
      source: asset.source,
      tasks: getAssetTasks(asset.kind),
      accountIds: asset.accountIds,
      accountStatus: asset.accountStatus,
      currency: asset.currency,
      timezoneName: asset.timezoneName,
      assigned: asset.assigned,
      action: asset.assigned ? 'none' : 'assign',
      warning: (asset as any).warning,
    })),
    mutations: {
      createSystemUser: !systemUser,
      assignAssetCount: assignmentChecks.filter((asset) => !asset.assigned).length,
      generateAccessToken: !existingCredential || existingCredential.status !== 'active',
      createOrUpdateCredential: true,
    },
    warnings: inventory.warnings,
  }
}

const createSystemUser = async (
  token: string,
  businessId: string,
  name: string,
) => {
  const result = await facebookClient.post(`/${businessId}/system_users`, {
    access_token: token,
    name,
    role: 'EMPLOYEE',
  })
  const id = result?.id ? String(result.id) : ''
  if (!id) throw new Error('Meta did not return a System User ID')
  return { id, name, role: 'EMPLOYEE' }
}

const assignAndReadBackAsset = async (
  token: string,
  businessId: string,
  systemUserId: string,
  asset: {
    kind: AssetKind
    assetId: string
    name?: string
    source: MetaAsset['source']
    accountIds: string[]
    accountStatus?: number
    currency?: string
    timezoneName?: string
    assigned: boolean
  },
) => {
  const endpoint = `${getAssetEndpoint(asset.kind, asset.assetId)}/assigned_users`
  if (!asset.assigned) {
    await facebookClient.post(endpoint, {
      access_token: token,
      user: systemUserId,
      tasks: JSON.stringify(getAssetTasks(asset.kind)),
    })
  }
  const readback = await checkAssignedUser(
    token,
    businessId,
    systemUserId,
    asset.kind,
    asset.assetId,
  )
  if (!readback.assigned) {
    throw new Error(
      `Meta assignment readback failed for ${asset.kind}:${asset.assetId}`,
    )
  }
  return buildAssetGrant(
    {
      assetId: asset.assetId,
      name: asset.name,
      source: asset.source,
      accountStatus: asset.accountStatus,
      currency: asset.currency,
      timezoneName: asset.timezoneName,
    },
    asset.kind,
    asset.accountIds,
  )
}

const generateSystemUserToken = async (
  bootstrapToken: string,
  businessId: string,
  systemUserId: string,
  appId: string,
) => {
  const response = await facebookClient.post(`/${businessId}/system_user_access_tokens`, {
    access_token: bootstrapToken,
    system_user_id: systemUserId,
    asset: JSON.stringify([appId]),
    scope: JSON.stringify(DEFAULT_SCOPES),
    set_token_expires_in_60_days: false,
  })
  const token = response?.access_token
  if (!token || typeof token !== 'string') {
    throw new Error('Meta did not return a System User access token')
  }
  return token
}

export const validateSystemUserToken = async (
  token: string,
  app: any,
  desiredAssets: Array<{
    kind: AssetKind
    assetId: string
  }>,
) => {
  const appAccessToken = `${app.appId}|${app.appSecret}`
  let debugData: any
  let debugWarning: any
  try {
    const debug = await facebookClient.get('/debug_token', {
      input_token: token,
      access_token: appAccessToken,
    })
    debugData = debug?.data
  } catch (error: any) {
    debugWarning = metaErrorSummary(error)
  }
  if (debugData) {
    if (debugData.is_valid !== true) {
      throw inputError('Generated System User token is not valid', 502)
    }
    const grantedScopes = new Set(
      Array.isArray(debugData.scopes)
        ? debugData.scopes.map((scope: any) => String(scope))
        : [],
    )
    const missingScopes = DEFAULT_SCOPES.filter((scope) => !grantedScopes.has(scope))
    if (missingScopes.length > 0) {
      throw inputError(
        `Generated System User token is missing required scopes: ${missingScopes.join(', ')}`,
        502,
      )
    }
  }

  const checks = await Promise.all(desiredAssets.map(async (asset) => {
    const endpoint = getAssetEndpoint(asset.kind, asset.assetId)
    try {
      const data = await facebookClient.get(endpoint, {
        access_token: token,
        fields: asset.kind === 'adAccounts'
          ? 'id,account_id,name,account_status'
          : 'id,name',
      })
      return {
        kind: asset.kind,
        assetId: asset.assetId,
        ok: Boolean(data?.id),
      }
    } catch (error: any) {
      return {
        kind: asset.kind,
        assetId: asset.assetId,
        ok: false,
        error: metaErrorSummary(error),
      }
    }
  }))
  const failures = checks.filter((check) => !check.ok)
  if (failures.length > 0) {
    throw inputError(
      `Generated System User token cannot read all assigned assets: ${JSON.stringify(failures)}`,
      502,
    )
  }

  return {
    debugData,
    debugWarning,
    checks,
  }
}

export const provisionSystemUser = async (
  rawInput: ProvisionSystemUserInput,
  actorUserId?: string,
) => {
  const plan = await buildProvisionPlan(rawInput)
  const bootstrapToken = await findBootstrapToken(plan.input.bootstrapTokenId)
  const app: any = await FacebookApp.findById(plan.input.facebookAppId)
    .select('+appSecret')
    .lean()
  if (!app?.appSecret) throw inputError('Facebook App secret is unavailable', 500)

  const systemUser = plan.systemUser || await createSystemUser(
    bootstrapToken.token,
    plan.input.businessId,
    plan.input.systemUserName
      || `AutoArk Publisher ${plan.organization.name}`.slice(0, 120),
  )

  const grants = await Promise.all(plan.desiredAssets.map((asset) => (
    assignAndReadBackAsset(
      bootstrapToken.token,
      plan.input.businessId,
      systemUser.id,
      asset,
    )
  )))
  const existingCredential: any = await MetaBusinessCredential.findOne({
    organizationId: plan.input.organizationId,
    businessId: plan.input.businessId,
    systemUserId: systemUser.id,
    facebookAppId: plan.input.facebookAppId,
  }).select('+tokenCiphertext')

  let systemToken: string | undefined
  let validation: Awaited<ReturnType<typeof validateSystemUserToken>> | undefined
  let tokenReused = false
  if (existingCredential?.status === 'active' && existingCredential.tokenCiphertext) {
    try {
      const existingToken = decryptMetaToken(existingCredential.tokenCiphertext)
      validation = await validateSystemUserToken(
        existingToken,
        app,
        plan.desiredAssets,
      )
      systemToken = existingToken
      tokenReused = true
    } catch {
      // A broken or revoked token is rotated below. Do not surface its value or
      // decryption failure in logs/audit metadata.
    }
  }
  if (!systemToken || !validation) {
    systemToken = await generateSystemUserToken(
      bootstrapToken.token,
      plan.input.businessId,
      systemUser.id,
      plan.app.appId,
    )
    validation = await validateSystemUserToken(
      systemToken,
      app,
      plan.desiredAssets,
    )
  }
  const now = new Date()
  const debugExpiresAt = Number(validation.debugData?.expires_at || 0)
  const expiresAt = debugExpiresAt > 0
    ? new Date(debugExpiresAt * 1000)
    : undefined

  if (plan.input.isDefault) {
    await MetaBusinessCredential.updateMany(
      {
        organizationId: plan.input.organizationId,
        status: 'active',
      },
      { $set: { isDefault: false } },
    )
  }

  const mergeGrantList = (kind: AssetKind) => {
    const byId = new Map<string, any>()
    ;(existingCredential?.assetGrants?.[kind] || []).forEach((grant: any) => {
      byId.set(String(grant.assetId), grant.toObject?.() || grant)
    })
    grants.forEach((grant, index) => {
      if (plan.desiredAssets[index].kind === kind) {
        byId.set(String(grant.assetId), grant)
      }
    })
    return Array.from(byId.values())
  }
  const groupedGrants = {
    adAccounts: mergeGrantList('adAccounts'),
    pages: mergeGrantList('pages'),
    pixels: mergeGrantList('pixels'),
  }

  const credential: any = await MetaBusinessCredential.findOneAndUpdate(
    {
      organizationId: plan.input.organizationId,
      businessId: plan.input.businessId,
      systemUserId: systemUser.id,
      facebookAppId: plan.input.facebookAppId,
    },
    {
      $set: {
        credentialType: 'system_user',
        status: 'active',
        isDefault: plan.input.isDefault,
        businessName: plan.business.name,
        systemUserName: systemUser.name,
        systemUserRole: systemUser.role || 'EMPLOYEE',
        tokenCiphertext: tokenReused
          ? existingCredential.tokenCiphertext
          : encryptMetaToken(systemToken),
        tokenFingerprint: fingerprintMetaToken(systemToken),
        scopes: Array.isArray(validation.debugData?.scopes)
          ? validation.debugData.scopes
          : DEFAULT_SCOPES,
        lastValidatedAt: now,
        lastReconciledAt: now,
        assetGrants: groupedGrants,
        updatedBy: actorUserId,
        ...(expiresAt ? { expiresAt } : {}),
      },
      $unset: {
        lastValidationError: 1,
        ...(!expiresAt ? { expiresAt: 1 } : {}),
      },
      $setOnInsert: {
        organizationId: plan.input.organizationId,
        facebookAppId: plan.input.facebookAppId,
        businessId: plan.input.businessId,
        systemUserId: systemUser.id,
        createdBy: actorUserId,
      },
    },
    { upsert: true, new: true, runValidators: true },
  )

  return {
    credential: credential.toJSON(),
    readback: {
      systemUserCreated: plan.willCreateSystemUser,
      systemUserId: systemUser.id,
      assignedAssetCount: grants.length,
      tokenFingerprint: credential.tokenFingerprint,
      tokenReused,
      tokenRotated: !tokenReused,
      tokenValidatedAt: now,
      debugWarning: validation.debugWarning,
      assetChecks: validation.checks,
    },
  }
}

const grantIds = (credential: any, kind: AssetKind) => new Set(
  (credential?.assetGrants?.[kind] || [])
    .map((grant: any) => String(grant.assetId))
    .filter(Boolean),
)

export const credentialCoversAssets = (
  credential: any,
  assets: {
    adAccountIds?: string[]
    pageIds?: string[]
    pixelIds?: string[]
  },
) => {
  const requestedAccounts = (assets.adAccountIds || [])
    .map(normalizeForStorage)
    .filter(Boolean)
  const requestedPages = (assets.pageIds || []).filter(Boolean)
  const requestedPixels = (assets.pixelIds || []).filter(Boolean)
  const accounts = grantIds(credential, 'adAccounts')
  const pages = grantIds(credential, 'pages')
  const pixels = grantIds(credential, 'pixels')
  return requestedAccounts.every((id) => accounts.has(id))
    && requestedPages.every((id) => pages.has(id))
    && requestedPixels.every((id) => pixels.has(id))
}

export const resolvePublishingCredential = async (input: {
  organizationId?: any
  credentialId?: any
  adAccountIds?: string[]
  pageIds?: string[]
  pixelIds?: string[]
}) => {
  if (!input.organizationId) return null
  const organizationId = requiredObjectId(
    String(input.organizationId),
    'organizationId',
  )
  const query: any = {
    organizationId,
    status: 'active',
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: null },
      { expiresAt: { $gt: new Date() } },
    ],
  }
  if (input.credentialId) {
    query._id = requiredObjectId(String(input.credentialId), 'metaCredentialId')
  }

  const credentials: any[] = await MetaBusinessCredential.find(query)
    .select('+tokenCiphertext')
    .sort({ isDefault: -1, updatedAt: -1 })
  for (const credential of credentials) {
    if (!credentialCoversAssets(credential, {
      adAccountIds: input.adAccountIds,
      pageIds: input.pageIds,
      pixelIds: input.pixelIds,
    })) {
      continue
    }
    try {
      return {
        credential,
        token: decryptMetaToken(credential.tokenCiphertext),
      }
    } catch {
      // A broken local ciphertext must not make a healthy secondary
      // organization credential unreachable.
    }
  }
  return null
}

export type MetaOperationalAuthorization = {
  authorizationType: 'system_user' | 'personal'
  token: string
  metaCredentialId?: string
  legacyTokenId?: string
}

/**
 * Resolve the credential used by unattended Meta operations.
 *
 * Organization System Users always take precedence when they cover the exact
 * ad account. A personal credential is accepted only as an explicit legacy
 * fallback so unmigrated organizations keep working during rollout.
 */
export const resolveAccountOperationalAuthorization = async (input: {
  accountId: string
  organizationId?: any
  legacyToken?: string
  legacyTokenId?: any
}): Promise<MetaOperationalAuthorization | null> => {
  const accountId = normalizeForStorage(input.accountId)
  if (!accountId) return null

  if (
    input.organizationId
    && mongoose.Types.ObjectId.isValid(String(input.organizationId))
  ) {
    const resolved = await resolvePublishingCredential({
      organizationId: input.organizationId,
      adAccountIds: [accountId],
    })
    if (resolved) {
      return {
        authorizationType: 'system_user',
        token: resolved.token,
        metaCredentialId: String(resolved.credential._id),
      }
    }
  }

  if (!input.legacyToken) return null
  return {
    authorizationType: 'personal',
    token: input.legacyToken,
    legacyTokenId: input.legacyTokenId
      ? String(input.legacyTokenId)
      : undefined,
  }
}

export const resolveAgentOperationalAuthorization = async (input: {
  organizationId?: any
  adAccountIds?: string[]
  legacyTokenIds?: any[]
}): Promise<MetaOperationalAuthorization | null> => {
  const requestedAccountIds = Array.from(new Set(
    (input.adAccountIds || [])
      .map(normalizeForStorage)
      .filter(Boolean),
  ))
  const legacyTokenIds = Array.isArray(input.legacyTokenIds)
    ? input.legacyTokenIds.filter(Boolean)
    : []

  // A legacy token-only scope cannot be safely translated into an organization
  // credential unless the agent also pins its exact ad-account scope.
  if (
    input.organizationId
    && mongoose.Types.ObjectId.isValid(String(input.organizationId))
    && (requestedAccountIds.length > 0 || legacyTokenIds.length === 0)
  ) {
    const resolved = await resolvePublishingCredential({
      organizationId: input.organizationId,
      adAccountIds: requestedAccountIds,
    })
    if (resolved) {
      return {
        authorizationType: 'system_user',
        token: resolved.token,
        metaCredentialId: String(resolved.credential._id),
      }
    }
  }

  const query: any = {
    status: 'active',
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: null },
      { expiresAt: { $gt: new Date() } },
    ],
  }
  if (
    input.organizationId
    && mongoose.Types.ObjectId.isValid(String(input.organizationId))
  ) {
    query.organizationId = input.organizationId
  }
  if (legacyTokenIds.length > 0) {
    query._id = { $in: legacyTokenIds }
  }
  const token: any = await FbToken.findOne(query)
    .sort({ updatedAt: -1 })
    .lean()
  if (!token?.token) return null
  return {
    authorizationType: 'personal',
    token: token.token,
    legacyTokenId: String(token._id),
  }
}

export const recordOperationalCredentialFailure = async (
  credentialIdValue: any,
  error: any,
) => {
  if (!credentialIdValue) return false
  const summary = metaErrorSummary(error)
  if (Number(summary.code) !== 190) return false
  const credentialId = requiredObjectId(
    String(credentialIdValue),
    'metaCredentialId',
  )
  const result = await MetaBusinessCredential.updateOne(
    { _id: credentialId, status: 'active' },
    {
      $set: {
        status: 'invalid',
        isDefault: false,
        lastValidationError: summary.message,
      },
    },
  )
  return result.modifiedCount > 0
}

export const getOrganizationAuthorization = async (
  organizationId: string,
  preferredCredentialId?: string,
) => {
  const resolved = await resolvePublishingCredential({
    organizationId,
    credentialId: preferredCredentialId,
  })
  if (!resolved) return null
  const credential: any = resolved.credential
  return {
    authorizationType: 'system_user',
    tokenId: String(credential._id),
    credentialId: String(credential._id),
    businessId: credential.businessId,
    businessName: credential.businessName,
    systemUserId: credential.systemUserId,
    systemUserName: credential.systemUserName,
    status: credential.status,
    lastValidatedAt: credential.lastValidatedAt,
    lastReconciledAt: credential.lastReconciledAt,
    expiresAt: credential.expiresAt,
    tokenFingerprint: credential.tokenFingerprint,
    assets: {
      adAccounts: (credential.assetGrants?.adAccounts || []).map((grant: any) => ({
        id: `act_${normalizeForStorage(grant.assetId)}`,
        account_id: normalizeForStorage(grant.assetId),
        name: grant.name,
        source: grant.source,
        account_status: 1,
      })),
      pages: (credential.assetGrants?.pages || []).map((grant: any) => ({
        id: grant.assetId,
        pageId: grant.assetId,
        name: grant.name,
        source: grant.source,
      })),
      pixels: (credential.assetGrants?.pixels || []).map((grant: any) => ({
        id: grant.assetId,
        pixelId: grant.assetId,
        name: grant.name,
        source: grant.source,
        accounts: (grant.accountIds || []).map((accountId: string) => ({
          accountId,
        })),
      })),
    },
  }
}

export const refreshCredential = async (
  credentialIdValue: string,
  actorUserId?: string,
) => {
  const credentialId = requiredObjectId(credentialIdValue, 'credentialId')
  const credential: any = await MetaBusinessCredential.findById(credentialId)
    .select('+tokenCiphertext')
  if (!credential) throw inputError('Meta credential not found', 404)

  const token = decryptMetaToken(credential.tokenCiphertext)
  const desiredAssets = [
    ...(credential.assetGrants?.adAccounts || []).map((grant: any) => ({
      kind: 'adAccounts' as const,
      assetId: grant.assetId,
    })),
    ...(credential.assetGrants?.pages || []).map((grant: any) => ({
      kind: 'pages' as const,
      assetId: grant.assetId,
    })),
    ...(credential.assetGrants?.pixels || []).map((grant: any) => ({
      kind: 'pixels' as const,
      assetId: grant.assetId,
    })),
  ]
  const app: any = await FacebookApp.findById(credential.facebookAppId)
    .select('+appSecret')
    .lean()
  if (!app?.appSecret) throw inputError('Facebook App secret is unavailable', 500)

  try {
    const validation = await validateSystemUserToken(token, app, desiredAssets)
    credential.status = 'active'
    credential.lastValidatedAt = new Date()
    credential.lastValidationError = undefined
    credential.updatedBy = actorUserId
    await credential.save()
    return {
      credential: credential.toJSON(),
      checks: validation.checks,
      debugWarning: validation.debugWarning,
    }
  } catch (error: any) {
    const summary = metaErrorSummary(error)
    if (summary.code === 190) credential.status = 'invalid'
    credential.lastValidationError = summary.message
    credential.updatedBy = actorUserId
    await credential.save()
    throw error
  }
}

export const deactivateCredential = async (
  credentialIdValue: string,
  actorUserId?: string,
) => {
  const credentialId = requiredObjectId(credentialIdValue, 'credentialId')
  const credential: any = await MetaBusinessCredential.findByIdAndUpdate(
    credentialId,
    {
      $set: {
        status: 'inactive',
        isDefault: false,
        updatedBy: actorUserId,
      },
    },
    { new: true },
  )
  if (!credential) throw inputError('Meta credential not found', 404)
  return credential.toJSON()
}

export const safeProvisionResult = (value: any) => redactSensitiveData(value)

export default {
  listCredentials,
  listBootstrapTokens,
  getMigrationInventory,
  discoverBusinesses,
  inspectBusiness,
  buildProvisionPlan,
  provisionSystemUser,
  resolvePublishingCredential,
  resolveAccountOperationalAuthorization,
  resolveAgentOperationalAuthorization,
  recordOperationalCredentialFailure,
  getOrganizationAuthorization,
  refreshCredential,
  deactivateCredential,
}
