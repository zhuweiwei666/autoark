import mongoose from 'mongoose'
import Account from '../models/Account'
import AiExecutionMandate from '../models/AiExecutionMandate'
import CopywritingPackage from '../models/CopywritingPackage'
import CreativeGroup from '../models/CreativeGroup'
import FacebookUser from '../models/FacebookUser'
import FbToken from '../models/FbToken'
import MetaBusinessCredential from '../models/MetaBusinessCredential'
import PlaybookVersion from '../models/PlaybookVersion'
import Product from '../models/Product'
import TargetingPackage from '../models/TargetingPackage'
import { combineFilters, objectIdValue } from '../utils/accessControl'
import { getAccountIdsForQuery, normalizeForStorage } from '../utils/accountId'
import { sanitizeOptimizerTargeting } from '../utils/optimizerTargeting'
import { resolvePublishingCredential } from './metaBusinessCredential.service'

const MAX_TARGET_ACCOUNTS = 20
const MAX_PORTABLE_MATERIALS = 10
type ExecutionAuthorizationType = 'system_user' | 'personal_user'

const cleanString = (value: any, max = 200): string =>
  String(value || '')
    .trim()
    .slice(0, max)

const uniqueStrings = (values: any[]): string[] =>
  Array.from(
    new Set(values.map((value) => cleanString(value, 300)).filter(Boolean)),
  )

const asNumber = (value: any, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const errorWithStatus = (
  message: string,
  statusCode = 400,
  code?: string,
  details?: any,
) => {
  const error: any = new Error(message)
  error.statusCode = statusCode
  if (code) error.code = code
  if (details) error.details = details
  return error
}

const orgConstraint = (organizationId?: any) =>
  organizationId
    ? { organizationId: objectIdValue(String(organizationId)) }
    : {
        $or: [{ organizationId: { $exists: false } }, { organizationId: null }],
      }

const findPlaybook = async (id: string, accessFilter: any = {}) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw errorWithStatus('打法版本 ID 无效')
  }
  const playbook: any = await PlaybookVersion.findOne(
    combineFilters({ _id: id }, accessFilter),
  ).lean()
  if (!playbook) throw errorWithStatus('打法版本不存在或无权访问', 404)
  return playbook
}

const isHttpUrl = (value: any) => {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const parsed = new URL(value.trim())
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const landingDomain = (value: any): string | undefined => {
  if (!isHttpUrl(value)) return undefined
  return new URL(String(value).trim()).hostname.toLowerCase()
}

const sourceBoundary = (
  playbook: any,
  extraAccountIds: string[] = [],
  extraTokenIds: string[] = [],
) => ({
  mode: 'read_only_context',
  tokenIds: uniqueStrings([
    ...(playbook.source?.tokenIds || []),
    ...extraTokenIds,
  ]),
  accountIds: uniqueStrings([
    ...(playbook.source?.accountIds || []).map(normalizeForStorage),
    ...extraAccountIds.map(normalizeForStorage),
  ]),
  inheritedAssetsAllowed: false,
})

export const assertSourceExecutionIsolation = ({
  playbook,
  facebookTokenId,
  authorizationType = 'personal_user',
  accountIds,
  extraSourceAccountIds = [],
  extraSourceTokenIds = [],
}: {
  playbook: any
  facebookTokenId?: string
  authorizationType?: ExecutionAuthorizationType
  accountIds: string[]
  extraSourceAccountIds?: string[]
  extraSourceTokenIds?: string[]
}) => {
  const boundary = sourceBoundary(
    playbook,
    extraSourceAccountIds,
    extraSourceTokenIds,
  )
  if (
    authorizationType === 'personal_user' &&
    facebookTokenId &&
    boundary.tokenIds.includes(String(facebookTokenId))
  ) {
    throw errorWithStatus(
      '真人投手的来源 Token 只能读取上下文，不能授权给 AI 执行',
      409,
      'AI_SOURCE_TOKEN_FORBIDDEN',
    )
  }
  const overlappingAccounts = uniqueStrings(
    accountIds.map(normalizeForStorage),
  ).filter((accountId) => boundary.accountIds.includes(accountId))
  if (overlappingAccounts.length > 0) {
    throw errorWithStatus(
      `真人投手来源账户不可作为 AI 执行账户：${overlappingAccounts.join(', ')}`,
      409,
      'AI_SOURCE_ACCOUNT_FORBIDDEN',
      { accountIds: overlappingAccounts },
    )
  }
  return boundary
}

const portableCountries = (playbook: any, limit: number) =>
  uniqueStrings(
    (playbook.geography || [])
      .filter(
        (entry: any) =>
          entry?.dimension?.country &&
          entry.purchases > 0 &&
          entry.confidence >= 0.34,
      )
      .slice(0, limit)
      .map((entry: any) => entry.dimension.country),
  )

const portableTargetingFromPlaybook = (playbook: any, countryLimit: number) => {
  const sanitized = sanitizeOptimizerTargeting(
    JSON.parse(JSON.stringify(playbook.targeting?.value || {})),
  )
  const countries = portableCountries(playbook, countryLimit)
  if (countries.length > 0) {
    sanitized.targeting.geo_locations = { countries }
  }
  return {
    targeting: sanitized.targeting,
    countries,
    removedKeys: uniqueStrings([
      ...(playbook.targeting?.removedAccountScopedKeys || []),
      ...sanitized.removedKeys,
    ]),
  }
}

const createPortableTargetingPackage = async ({
  playbook,
  countryLimit,
  createdBy,
}: {
  playbook: any
  countryLimit: number
  createdBy?: string
}) => {
  const existing: any = await TargetingPackage.findOne({
    'sourceContext.playbookVersionId': playbook._id,
    'reusePolicy.scope': 'portable',
  })
  if (existing) return existing

  const portable = portableTargetingFromPlaybook(playbook, countryLimit)
  const label = cleanString(playbook.optimizerId, 50).replace(
    /[^\w\u4e00-\u9fa5-]+/g,
    '_',
  )
  const document = {
    name: `AI方法_${label}_v${playbook.version}_定向`,
    organizationId: playbook.organizationId,
    platform: 'facebook' as const,
    portableTargeting: portable.targeting,
    geoLocations: { countries: portable.countries },
    placement: {
      type: (Array.isArray(portable.targeting.publisher_platforms)
        ? 'manual'
        : 'automatic') as 'manual' | 'automatic',
      platforms: portable.targeting.publisher_platforms || [],
      devicePlatforms: portable.targeting.device_platforms || [],
    },
    optimizationGoal:
      playbook.structure?.optimizationGoal || 'OFFSITE_CONVERSIONS',
    reusePolicy: {
      scope: 'portable' as const,
      sourceMode: 'human_buyer_context' as const,
      accountScopedAssetsRemoved: true,
    },
    sourceContext: {
      playbookVersionId: playbook._id,
      optimizerId: playbook.optimizerId,
      tokenIds: playbook.source?.tokenIds || [],
      accountIds: playbook.source?.accountIds || [],
      generatedAt: new Date(),
    },
    deliveryInsights: {
      countries: (playbook.geography || []).slice(0, 20),
      placements: (playbook.placements || []).slice(0, 20),
      hours: (playbook.hours || []).slice(0, 24),
      hourTimezone: 'ad_account',
      recurringHourAutomationEnabled: false,
      removedAccountScopedKeys: portable.removedKeys,
    },
    description:
      '由真人投手只读数据提炼；不包含来源账户、Pixel、自定义受众或保存受众。',
    tags: [
      'AI可复用',
      `投手:${playbook.optimizerId}`,
      `打法:v${playbook.version}`,
    ],
    createdBy,
  }
  try {
    return await TargetingPackage.create(document)
  } catch (error: any) {
    if (error?.code !== 11000) throw error
    return TargetingPackage.findOne({
      'sourceContext.playbookVersionId': playbook._id,
      'reusePolicy.scope': 'portable',
    })
  }
}

const createPortableCreativeGroup = async ({
  playbook,
  materialLimit,
  createdBy,
}: {
  playbook: any
  materialLimit: number
  createdBy?: string
}) => {
  const existing: any = await CreativeGroup.findOne({
    'sourceContext.playbookVersionId': playbook._id,
    'reusePolicy.scope': 'portable',
  })
  if (existing) return existing

  const materials = (playbook.creatives?.materials || [])
    .filter(
      (material: any) =>
        ['image', 'video'].includes(material?.type) && isHttpUrl(material?.url),
    )
    .slice(0, materialLimit)
  if (materials.length === 0) {
    throw errorWithStatus(
      '打法中没有可导入 AutoArk 的稳定素材 URL',
      409,
      'PORTABLE_CREATIVE_EMPTY',
    )
  }
  const label = cleanString(playbook.optimizerId, 50).replace(
    /[^\w\u4e00-\u9fa5-]+/g,
    '_',
  )
  const document = {
    name: `AI方法_${label}_v${playbook.version}_创意`,
    organizationId: playbook.organizationId,
    platform: 'facebook' as const,
    materials: materials.map((material: any) => ({
      type: material.type as 'image' | 'video',
      url: material.url,
      name: material.name,
      thumbnail: material.thumbnailUrl,
      status: 'uploaded' as const,
      source: 'url_import' as const,
    })),
    config: { format: 'single' as const, dynamicCreative: false },
    reusePolicy: {
      scope: 'portable' as const,
      sourceMode: 'human_buyer_context' as const,
      requiresTargetUpload: true,
    },
    sourceContext: {
      playbookVersionId: playbook._id,
      optimizerId: playbook.optimizerId,
      tokenIds: playbook.source?.tokenIds || [],
      accountIds: playbook.source?.accountIds || [],
      generatedAt: new Date(),
    },
    performanceContext: {
      materials: materials.map((material: any) => ({
        materialId: material.materialId,
        performance: material.performance,
      })),
    },
    description:
      '由真人投手素材表现提炼；只保留 AutoArk URL，来源账户的 image hash/video id 不可复用。',
    tags: [
      'AI可复用',
      `投手:${playbook.optimizerId}`,
      `打法:v${playbook.version}`,
    ],
    createdBy,
  }
  try {
    return await CreativeGroup.create(document)
  } catch (error: any) {
    if (error?.code !== 11000) throw error
    return CreativeGroup.findOne({
      'sourceContext.playbookVersionId': playbook._id,
      'reusePolicy.scope': 'portable',
    })
  }
}

export const materializeReusableAssets = async ({
  playbookId,
  materialLimit: materialLimitInput = 5,
  countryLimit: countryLimitInput = 5,
  createdBy,
  accessFilter = {},
}: {
  playbookId: string
  materialLimit?: number
  countryLimit?: number
  createdBy?: string
  accessFilter?: any
}) => {
  const playbook = await findPlaybook(playbookId, accessFilter)
  if (!playbook.eligibility?.eligible) {
    throw errorWithStatus(
      '打法版本未达到可复用资产提炼门槛',
      409,
      'PLAYBOOK_NOT_ELIGIBLE',
      playbook.eligibility,
    )
  }
  const materialLimit = Math.min(
    MAX_PORTABLE_MATERIALS,
    Math.max(1, Math.round(asNumber(materialLimitInput, 5))),
  )
  const countryLimit = Math.min(
    20,
    Math.max(1, Math.round(asNumber(countryLimitInput, 5))),
  )
  const [targetingPackage, creativeGroup] = await Promise.all([
    createPortableTargetingPackage({
      playbook,
      countryLimit,
      createdBy,
    }),
    createPortableCreativeGroup({
      playbook,
      materialLimit,
      createdBy,
    }),
  ])
  return {
    playbookId: String(playbook._id),
    targetingPackage: targetingPackage.toObject(),
    creativeGroup: creativeGroup.toObject(),
    generatedCopywritingPackage: false,
    boundary:
      '来源文案和落地页不会生成执行文案包；产品必须由管理员选择的 AutoArk 文案包决定。',
  }
}

const candidatePagesForAccount = (snapshot: any, accountId: string) =>
  (snapshot.pages || []).filter((page: any) => {
    const explicitlyLinked = (page.accounts || []).some(
      (account: any) => normalizeForStorage(account.accountId) === accountId,
    )
    const sameTokenManaged =
      typeof page.accessToken === 'string' && page.accessToken.trim().length > 0
    return explicitlyLinked || sameTokenManaged
  })

const candidatePixelsForAccount = (snapshot: any, accountId: string) =>
  (snapshot.pixels || []).filter((pixel: any) =>
    (pixel.accounts || []).some(
      (account: any) => normalizeForStorage(account.accountId) === accountId,
    ),
  )

const buildSystemCredentialSnapshot = async (credential: any) => {
  const accountGrants = credential.assetGrants?.adAccounts || []
  const accountIds = uniqueStrings(
    accountGrants.map((grant: any) => normalizeForStorage(grant.assetId)),
  )
  const accounts: any[] =
    accountIds.length > 0
      ? await Account.find(
          combineFilters(
            {
              channel: 'facebook',
              accountId: { $in: getAccountIdsForQuery(accountIds) },
            },
            orgConstraint(credential.organizationId),
          ),
        )
          .select('accountId name status currency timezone organizationId')
          .lean()
      : []
  const accountById = new Map(
    accounts.map((account: any) => [
      normalizeForStorage(account.accountId),
      account,
    ]),
  )
  const linkedAccounts = accountIds.map((accountId) => ({ accountId }))

  return {
    fbUserName: credential.systemUserName,
    lastSyncedAt: credential.lastReconciledAt,
    syncStatus: 'completed',
    adAccounts: accountGrants.map((grant: any) => {
      const accountId = normalizeForStorage(grant.assetId)
      const account: any = accountById.get(accountId)
      return {
        accountId,
        name: grant.name || account?.name,
        status:
          grant.accountStatus !== undefined &&
          grant.accountStatus !== null &&
          Number.isFinite(Number(grant.accountStatus))
            ? Number(grant.accountStatus)
            : 1,
        currency: grant.currency || account?.currency,
        timezone: grant.timezoneName || account?.timezone,
      }
    }),
    pages: (credential.assetGrants?.pages || []).map((grant: any) => ({
      pageId: String(grant.assetId),
      name: grant.name,
      accounts: linkedAccounts,
    })),
    pixels: (credential.assetGrants?.pixels || []).map((grant: any) => ({
      pixelId: String(grant.assetId),
      name: grant.name,
      accounts:
        Array.isArray(grant.accountIds) && grant.accountIds.length > 0
          ? grant.accountIds.map((accountId: string) => ({
              accountId: normalizeForStorage(accountId),
            }))
          : linkedAccounts,
    })),
  }
}

const sanitizedTokenSnapshot = (
  token: any,
  snapshot: any,
  sourceAccountIds: Set<string>,
) => ({
  tokenId: String(token._id),
  authorizationType: 'personal_user' as const,
  fbUserId: token.fbUserId,
  fbUserName: token.fbUserName || snapshot?.fbUserName,
  status: token.status,
  lastSyncedAt: snapshot?.lastSyncedAt,
  syncStatus: snapshot?.syncStatus,
  executionRole: 'admin_assignable',
  accounts: (snapshot?.adAccounts || [])
    .map((account: any) => {
      const accountId = normalizeForStorage(account.accountId)
      const pixels = candidatePixelsForAccount(snapshot, accountId).map(
        (pixel: any) => ({
          pixelId: String(pixel.pixelId),
          name: pixel.name,
        }),
      )
      return {
        accountId,
        name: account.name,
        status: account.status,
        currency: account.currency,
        timezone: account.timezone,
        pages: candidatePagesForAccount(snapshot, accountId).map(
          (page: any) => ({
            pageId: page.pageId,
            name: page.name,
          }),
        ),
        pixels,
        pixelCount: pixels.length,
      }
    })
    .filter((account: any) => !sourceAccountIds.has(account.accountId)),
})

const sanitizedSystemCredentialSnapshot = async (
  credential: any,
  sourceAccountIds: Set<string>,
) => {
  const snapshot = await buildSystemCredentialSnapshot(credential)
  return {
    ...sanitizedTokenSnapshot(
      {
        _id: credential._id,
        fbUserId: credential.systemUserId,
        fbUserName: credential.systemUserName,
        status: credential.status,
      },
      snapshot,
      sourceAccountIds,
    ),
    authorizationType: 'system_user' as const,
    metaCredentialId: String(credential._id),
  }
}

const productCandidatesForCopy = (copywritingPackage: any, products: any[]) => {
  const copyId = String(copywritingPackage._id)
  const direct = products.filter((product) =>
    (product.copywritingPackageIds || []).some(
      (id: any) => String(id) === copyId,
    ),
  )
  if (direct.length > 0) return { products: direct, mode: 'explicit_link' }
  const identifier = cleanString(copywritingPackage.product?.identifier, 240)
  const domain = cleanString(
    copywritingPackage.product?.domain,
    255,
  ).toLowerCase()
  const inferred = products.filter(
    (product) =>
      (identifier && product.identifier === identifier) ||
      (domain &&
        cleanString(product.primaryDomain, 255).toLowerCase() === domain),
  )
  return { products: inferred, mode: 'package_metadata' }
}

const summarizeCopywritingPackage = (
  copywritingPackage: any,
  products: any[],
) => {
  const resolution = productCandidatesForCopy(copywritingPackage, products)
  const product =
    resolution.products.length === 1 ? resolution.products[0] : null
  const productPixelById = new Map(
    (product?.pixels || []).map((pixel: any) => [String(pixel.pixelId), pixel]),
  )
  const accountMappings = (product?.accounts || [])
    .filter((account: any) => account.status === 'active')
    .map((account: any) => {
      const pixelId = cleanString(account.throughPixelId, 160)
      const pixel: any = productPixelById.get(pixelId)
      return {
        accountId: normalizeForStorage(account.accountId),
        accountName: account.accountName,
        pixelId,
        pixelName: pixel?.pixelName,
        verified: Boolean(pixelId && pixel?.verified === true),
      }
    })
    .filter((mapping: any) => mapping.accountId && mapping.pixelId)
  const websiteUrl = copywritingPackage.links?.websiteUrl
  const blockers: string[] = []
  if (!isHttpUrl(websiteUrl)) blockers.push('文案包缺少有效投放链接')
  if (resolution.products.length === 0) blockers.push('文案包尚未解析到产品')
  if (resolution.products.length > 1) blockers.push('文案包匹配到多个产品')
  if (product && !(product.pixels || []).some((pixel: any) => pixel.verified)) {
    blockers.push('产品没有管理员已验证的 Pixel')
  }
  if (
    product &&
    !(product.accounts || []).some(
      (account: any) =>
        account.status === 'active' && cleanString(account.throughPixelId),
    )
  ) {
    blockers.push('产品没有绑定 Pixel 的活跃投放账户')
  }
  return {
    id: String(copywritingPackage._id),
    name: copywritingPackage.name,
    websiteUrl,
    productMetadata: copywritingPackage.product,
    product: product
      ? {
          id: String(product._id),
          name: product.name,
          identifier: product.identifier,
          primaryDomain: product.primaryDomain,
          verifiedPixelCount: (product.pixels || []).filter(
            (pixel: any) => pixel.verified,
          ).length,
          activeAccountCount: (product.accounts || []).filter(
            (account: any) => account.status === 'active',
          ).length,
          accountMappings,
          resolutionMode: resolution.mode,
        }
      : undefined,
    ready: blockers.length === 0,
    blockers,
  }
}

export const listExecutionSetup = async ({
  playbookId,
  accessFilter = {},
  tokenAccessFilter = {},
}: {
  playbookId: string
  accessFilter?: any
  tokenAccessFilter?: any
}) => {
  const playbook = await findPlaybook(playbookId, accessFilter)
  const sourceTokenIds = new Set(
    uniqueStrings(playbook.source?.tokenIds || []).map(String),
  )
  const sourceAccountIds = new Set(
    uniqueStrings((playbook.source?.accountIds || []).map(normalizeForStorage)),
  )
  const assetFilter = combineFilters(
    accessFilter,
    orgConstraint(playbook.organizationId),
  )
  const [
    allTokens,
    credentials,
    targetingPackages,
    creativeGroups,
    copyPackages,
    products,
    mandates,
  ] = await Promise.all([
    FbToken.find(
      combineFilters(
        {
          status: 'active',
          $or: [
            { expiresAt: { $exists: false } },
            { expiresAt: null },
            { expiresAt: { $gt: new Date() } },
          ],
        },
        tokenAccessFilter,
        orgConstraint(playbook.organizationId),
      ),
    )
      .select('_id userId status fbUserId fbUserName organizationId')
      .lean(),
    playbook.organizationId
      ? MetaBusinessCredential.find({
          status: 'active',
          ...orgConstraint(playbook.organizationId),
          $or: [
            { expiresAt: { $exists: false } },
            { expiresAt: null },
            { expiresAt: { $gt: new Date() } },
          ],
        })
          .sort({ isDefault: -1, updatedAt: -1 })
          .lean()
      : Promise.resolve([]),
    TargetingPackage.find(
      combineFilters({ 'reusePolicy.scope': 'portable' }, assetFilter),
    )
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
    CreativeGroup.find(
      combineFilters({ 'reusePolicy.scope': 'portable' }, assetFilter),
    )
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
    CopywritingPackage.find(
      combineFilters(
        { 'links.websiteUrl': { $exists: true, $ne: '' } },
        assetFilter,
      ),
    )
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean(),
    Product.find(combineFilters({ status: 'active' }, assetFilter))
      .select(
        'name identifier primaryDomain pixels accounts copywritingPackageIds status',
      )
      .lean(),
    AiExecutionMandate.find(
      combineFilters({ playbookVersionId: playbook._id }, assetFilter),
    )
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
  ])
  const tokens = allTokens.filter(
    (token: any) => !sourceTokenIds.has(String(token._id)),
  )
  const tokenIds = tokens.map((token: any) => token._id)
  const snapshots: any[] =
    tokenIds.length > 0
      ? await FacebookUser.find({
          tokenId: { $in: tokenIds },
          syncStatus: 'completed',
          ...orgConstraint(playbook.organizationId),
        }).lean()
      : []
  const snapshotByToken = new Map(
    snapshots.map((snapshot: any) => [String(snapshot.tokenId), snapshot]),
  )
  const systemAuthorizations = await Promise.all(
    credentials.map((credential: any) =>
      sanitizedSystemCredentialSnapshot(credential, sourceAccountIds),
    ),
  )
  const personalAuthorizations = tokens
    .map((token: any) => {
      const snapshot = snapshotByToken.get(String(token._id))
      return snapshot
        ? sanitizedTokenSnapshot(token, snapshot, sourceAccountIds)
        : null
    })
    .filter((item: any) => item && item.accounts.length > 0)
  return {
    playbookId: String(playbook._id),
    organizationId: playbook.organizationId,
    sourceBoundary: {
      mode: 'read_only_context',
      accountIds: Array.from(sourceAccountIds),
      tokenIds: Array.from(sourceTokenIds),
      selectableForExecution: false,
    },
    reusableAssets: {
      targetingPackages: targetingPackages.map((item: any) => ({
        id: String(item._id),
        name: item.name,
        sourceContext: item.sourceContext,
        deliveryInsights: item.deliveryInsights,
      })),
      creativeGroups: creativeGroups.map((item: any) => ({
        id: String(item._id),
        name: item.name,
        materialCount:
          item.materialStats?.totalCount || item.materials?.length || 0,
        sourceContext: item.sourceContext,
      })),
    },
    copywritingPackages: copyPackages.map((item: any) =>
      summarizeCopywritingPackage(item, products),
    ),
    tokens: [
      ...systemAuthorizations.filter((item: any) => item.accounts.length > 0),
      ...personalAuthorizations,
    ],
    mandates,
    requirements: [
      '真人来源账户与 Token 永远只读',
      '管理员明确分配 AI 执行凭证、账户和 Page；优先使用组织 System User',
      '管理员选择文案包；文案包决定产品和投放链接',
      '每个执行账户必须存在产品已验证 Pixel 映射',
      '定向包与创意组必须标记为跨账户可复用',
    ],
  }
}

const resolveProduct = async ({
  copywritingPackage,
  accessFilter,
  organizationId,
}: {
  copywritingPackage: any
  accessFilter: any
  organizationId?: any
}) => {
  const productFilter = combineFilters(
    { status: 'active' },
    accessFilter,
    orgConstraint(organizationId),
  )
  const direct: any[] = await Product.find(
    combineFilters(
      { copywritingPackageIds: copywritingPackage._id },
      productFilter,
    ),
  ).lean()
  let candidates = direct
  let resolutionMode = 'explicit_link'
  if (candidates.length === 0) {
    const identifier = cleanString(copywritingPackage.product?.identifier, 240)
    const domain = cleanString(
      copywritingPackage.product?.domain,
      255,
    ).toLowerCase()
    const alternatives: any[] = []
    if (identifier) alternatives.push({ identifier })
    if (domain) alternatives.push({ primaryDomain: domain })
    candidates =
      alternatives.length > 0
        ? await Product.find(
            combineFilters({ $or: alternatives }, productFilter),
          ).lean()
        : []
    resolutionMode = 'package_metadata'
  }
  if (candidates.length === 0) {
    throw errorWithStatus(
      '文案包尚未解析到唯一产品，请先在产品映射中完成关联',
      409,
      'COPY_PACKAGE_PRODUCT_UNRESOLVED',
    )
  }
  if (candidates.length > 1) {
    throw errorWithStatus(
      '文案包匹配到多个产品，管理员必须先消除歧义',
      409,
      'COPY_PACKAGE_PRODUCT_AMBIGUOUS',
      {
        products: candidates.map((product) => ({
          id: String(product._id),
          name: product.name,
        })),
      },
    )
  }
  return { product: candidates[0], resolutionMode }
}

const resolveSelection = async ({
  playbook,
  facebookTokenId,
  metaCredentialId,
  authorizationType: requestedAuthorizationType,
  accountAssignments,
  targetingPackageId,
  creativeGroupId,
  copywritingPackageId,
  accessFilter,
  tokenAccessFilter,
}: {
  playbook: any
  facebookTokenId?: string
  metaCredentialId?: string
  authorizationType?: ExecutionAuthorizationType
  accountAssignments: any[]
  targetingPackageId: string
  creativeGroupId: string
  copywritingPackageId: string
  accessFilter: any
  tokenAccessFilter: any
}) => {
  const authorizationType: ExecutionAuthorizationType =
    requestedAuthorizationType ||
    (metaCredentialId ? 'system_user' : 'personal_user')
  const authorizationId =
    authorizationType === 'system_user'
      ? cleanString(metaCredentialId, 160)
      : cleanString(facebookTokenId, 160)
  if (
    (authorizationType === 'system_user' && facebookTokenId) ||
    (authorizationType === 'personal_user' && metaCredentialId)
  ) {
    throw errorWithStatus(
      'AI 投放授权单只能绑定一种 Facebook 执行凭证',
      409,
      'AI_EXECUTION_CREDENTIAL_AMBIGUOUS',
    )
  }
  const ids = [
    authorizationId,
    targetingPackageId,
    creativeGroupId,
    copywritingPackageId,
  ]
  if (ids.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
    throw errorWithStatus('授权单包含无效资产 ID')
  }
  if (
    !Array.isArray(accountAssignments) ||
    accountAssignments.length === 0 ||
    accountAssignments.length > MAX_TARGET_ACCOUNTS
  ) {
    throw errorWithStatus(
      `AI 投放授权单需要 1-${MAX_TARGET_ACCOUNTS} 个执行账户`,
    )
  }
  const assetFilter = combineFilters(
    accessFilter,
    orgConstraint(playbook.organizationId),
  )
  const activeCredentialQuery = {
    _id: authorizationId,
    status: 'active',
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: null },
      { expiresAt: { $gt: new Date() } },
    ],
  }
  const [
    executionAuthorization,
    targetingPackage,
    creativeGroup,
    copywritingPackage,
  ] = await Promise.all([
    authorizationType === 'system_user'
      ? MetaBusinessCredential.findOne(
          combineFilters(
            activeCredentialQuery,
            orgConstraint(playbook.organizationId),
          ),
        ).lean()
      : FbToken.findOne(
          combineFilters(
            activeCredentialQuery,
            tokenAccessFilter,
            orgConstraint(playbook.organizationId),
          ),
        ).lean(),
    TargetingPackage.findOne(
      combineFilters(
        {
          _id: targetingPackageId,
          'reusePolicy.scope': 'portable',
        },
        assetFilter,
      ),
    ),
    CreativeGroup.findOne(
      combineFilters(
        {
          _id: creativeGroupId,
          'reusePolicy.scope': 'portable',
        },
        assetFilter,
      ),
    ),
    CopywritingPackage.findOne(
      combineFilters({ _id: copywritingPackageId }, assetFilter),
    ).lean(),
  ])
  if (!executionAuthorization) {
    throw errorWithStatus(
      'AI 执行 Facebook 凭证不存在、已失效或无权访问',
      404,
      'AI_EXECUTION_CREDENTIAL_UNAVAILABLE',
    )
  }
  if (!targetingPackage) {
    throw errorWithStatus(
      '所选定向包不是可跨账户复用的 AutoArk 定向包',
      409,
      'PORTABLE_TARGETING_REQUIRED',
    )
  }
  if (!creativeGroup) {
    throw errorWithStatus(
      '所选创意组不是可跨账户复用的 AutoArk 创意组',
      409,
      'PORTABLE_CREATIVE_REQUIRED',
    )
  }
  if (!copywritingPackage || !isHttpUrl(copywritingPackage.links?.websiteUrl)) {
    throw errorWithStatus(
      '管理员文案包不存在或缺少有效投放链接',
      409,
      'COPY_PACKAGE_URL_REQUIRED',
    )
  }
  const portableMaterials = (creativeGroup.materials || []).filter(
    (material: any) =>
      ['image', 'video'].includes(material.type) && isHttpUrl(material.url),
  )
  if (
    portableMaterials.length === 0 ||
    portableMaterials.length !== creativeGroup.materials.length
  ) {
    throw errorWithStatus(
      '可复用创意组的每个素材都必须有稳定 HTTP(S) URL',
      409,
      'PORTABLE_CREATIVE_URL_REQUIRED',
    )
  }

  const extraSourceAccountIds = uniqueStrings([
    ...(targetingPackage.sourceContext?.accountIds || []),
    ...(creativeGroup.sourceContext?.accountIds || []),
  ])
  const extraSourceTokenIds = uniqueStrings([
    ...(targetingPackage.sourceContext?.tokenIds || []),
    ...(creativeGroup.sourceContext?.tokenIds || []),
  ])
  const normalizedAssignments = accountAssignments.map((assignment: any) => ({
    ...assignment,
    accountId: normalizeForStorage(assignment?.accountId),
    pageId: cleanString(assignment?.pageId, 160),
  }))
  if (
    normalizedAssignments.some(
      (assignment: any) => !assignment.accountId || !assignment.pageId,
    )
  ) {
    throw errorWithStatus('每个 AI 执行账户都必须由管理员明确指定 Page')
  }
  const accountIds = normalizedAssignments.map(
    (assignment: any) => assignment.accountId,
  )
  if (uniqueStrings(accountIds).length !== accountIds.length) {
    throw errorWithStatus('AI 执行账户不能重复')
  }
  const boundary = assertSourceExecutionIsolation({
    playbook,
    authorizationType,
    facebookTokenId:
      authorizationType === 'personal_user'
        ? String(executionAuthorization._id)
        : undefined,
    accountIds,
    extraSourceAccountIds,
    extraSourceTokenIds,
  })

  let snapshot: any
  if (authorizationType === 'system_user') {
    snapshot = await buildSystemCredentialSnapshot(executionAuthorization)
  } else {
    const snapshots: any[] = await FacebookUser.find({
      tokenId: executionAuthorization._id,
      syncStatus: 'completed',
      ...orgConstraint(playbook.organizationId),
    }).lean()
    if (snapshots.length !== 1) {
      throw errorWithStatus(
        `AI 执行授权必须对应唯一且完成同步的 Facebook 资产快照，当前为 ${snapshots.length}`,
        409,
        'AI_EXECUTION_SNAPSHOT_AMBIGUOUS',
      )
    }
    snapshot = snapshots[0]
  }
  const { product, resolutionMode } = await resolveProduct({
    copywritingPackage,
    accessFilter,
    organizationId: playbook.organizationId,
  })
  const cachedAccountById = new Map(
    (snapshot.adAccounts || []).map((account: any) => [
      normalizeForStorage(account.accountId),
      account,
    ]),
  )
  const scopedAccounts: any[] = await Account.find(
    combineFilters(
      {
        channel: 'facebook',
        status: { $ne: 'disabled' },
        accountId: { $in: getAccountIdsForQuery(accountIds) },
      },
      assetFilter,
    ),
  )
    .select('accountId name status')
    .lean()
  const scopedAccountById = new Map(
    scopedAccounts.map((account: any) => [
      normalizeForStorage(account.accountId),
      account,
    ]),
  )
  const productAccountById = new Map(
    (product.accounts || [])
      .filter((account: any) => account.status === 'active')
      .map((account: any) => [normalizeForStorage(account.accountId), account]),
  )
  const productPixelById = new Map(
    (product.pixels || []).map((pixel: any) => [String(pixel.pixelId), pixel]),
  )

  const targets = normalizedAssignments.map((assignment: any) => {
    const cachedAccount: any = cachedAccountById.get(assignment.accountId)
    const scopedAccount: any = scopedAccountById.get(assignment.accountId)
    if (!cachedAccount || !scopedAccount) {
      throw errorWithStatus(
        `执行账户 ${assignment.accountId} 不在管理员所选授权或组织范围内`,
        409,
        'AI_ACCOUNT_NOT_GRANTED',
      )
    }
    if (cachedAccount.status !== 1) {
      throw errorWithStatus(
        `执行账户 ${assignment.accountId} 当前不可投放`,
        409,
        'AI_ACCOUNT_INACTIVE',
      )
    }
    const page = candidatePagesForAccount(snapshot, assignment.accountId).find(
      (candidate: any) => String(candidate.pageId) === assignment.pageId,
    )
    if (!page) {
      throw errorWithStatus(
        `执行账户 ${assignment.accountId} 无权使用管理员所选 Page`,
        409,
        'AI_PAGE_NOT_GRANTED',
      )
    }
    const productAccount: any = productAccountById.get(assignment.accountId)
    if (!productAccount) {
      throw errorWithStatus(
        `产品 ${product.name} 未授权给执行账户 ${assignment.accountId}`,
        409,
        'PRODUCT_ACCOUNT_NOT_ASSIGNED',
      )
    }
    const mappedPixelId = cleanString(productAccount.throughPixelId, 160)
    const productPixel: any = productPixelById.get(mappedPixelId)
    if (!mappedPixelId || !productPixel || productPixel.verified !== true) {
      throw errorWithStatus(
        `产品 ${product.name} 在账户 ${assignment.accountId} 没有管理员已验证的 Pixel 映射`,
        409,
        'VERIFIED_PRODUCT_PIXEL_REQUIRED',
      )
    }
    const pixel = candidatePixelsForAccount(
      snapshot,
      assignment.accountId,
    ).find((candidate: any) => String(candidate.pixelId) === mappedPixelId)
    if (!pixel) {
      throw errorWithStatus(
        `产品 Pixel ${mappedPixelId} 不属于执行账户 ${assignment.accountId} 的当前授权`,
        409,
        'PRODUCT_PIXEL_NOT_GRANTED',
      )
    }
    return {
      accountId: assignment.accountId,
      accountName: cleanString(
        assignment.accountName || cachedAccount.name || scopedAccount.name,
      ),
      currency: cleanString(cachedAccount.currency, 20),
      timezone: cleanString(cachedAccount.timezone, 80),
      pageId: String(page.pageId),
      pageName: page.name,
      instagramAccountId:
        cleanString(assignment.instagramAccountId, 160) || undefined,
      pixelId: mappedPixelId,
      pixelName: productPixel.pixelName || pixel.name,
      domain: landingDomain(copywritingPackage.links.websiteUrl),
      conversionEvent:
        cleanString(product.defaultConfig?.pixelEvent, 80) || 'PURCHASE',
    }
  })
  if (authorizationType === 'system_user') {
    const resolvedCredential = await resolvePublishingCredential({
      organizationId: playbook.organizationId,
      credentialId: executionAuthorization._id,
      adAccountIds: targets.map((target: any) => target.accountId),
      pageIds: targets.map((target: any) => target.pageId),
      pixelIds: targets.map((target: any) => target.pixelId),
    })
    if (!resolvedCredential) {
      throw errorWithStatus(
        '组织 System User 已失效、密文不可解密或不再覆盖所选账户、Page、Pixel',
        409,
        'AI_EXECUTION_CREDENTIAL_UNAVAILABLE',
      )
    }
  }
  const targetCurrencies = uniqueStrings(
    targets.map((target: any) => target.currency),
  )
  if (targetCurrencies.length !== 1) {
    throw errorWithStatus(
      '单个 AI 投放授权单的执行账户必须使用同一币种',
      409,
      'AI_TARGET_CURRENCY_AMBIGUOUS',
      { currencies: targetCurrencies },
    )
  }
  const sourceCurrencies = uniqueStrings(playbook.source?.currencies || [])
  if (
    sourceCurrencies.length === 1 &&
    sourceCurrencies[0] !== targetCurrencies[0]
  ) {
    throw errorWithStatus(
      `打法币种 ${sourceCurrencies[0]} 与执行账户币种 ${targetCurrencies[0]} 不一致`,
      409,
      'AI_CURRENCY_MISMATCH',
    )
  }
  const targeting = sanitizeOptimizerTargeting(
    targetingPackage.portableTargeting || {},
  ).targeting
  if (Object.keys(targeting).length === 0) {
    throw errorWithStatus(
      '可复用定向包没有可执行定向',
      409,
      'PORTABLE_TARGETING_EMPTY',
    )
  }
  return {
    authorizationType,
    authorizationId: String(executionAuthorization._id),
    token:
      authorizationType === 'personal_user'
        ? executionAuthorization
        : undefined,
    metaCredential:
      authorizationType === 'system_user' ? executionAuthorization : undefined,
    snapshot,
    targetingPackage,
    creativeGroup,
    copywritingPackage,
    product,
    productResolutionMode: resolutionMode,
    targets,
    currency: targetCurrencies[0],
    targeting,
    boundary,
  }
}

export const createExecutionMandate = async ({
  playbookId,
  name,
  facebookTokenId,
  metaCredentialId,
  authorizationType,
  accounts,
  targetingPackageId,
  creativeGroupId,
  copywritingPackageId,
  defaultDailyBudget,
  maximumDailyBudget,
  createdBy,
  accessFilter = {},
  tokenAccessFilter = {},
}: {
  playbookId: string
  name?: string
  facebookTokenId?: string
  metaCredentialId?: string
  authorizationType?: ExecutionAuthorizationType
  accounts: any[]
  targetingPackageId: string
  creativeGroupId: string
  copywritingPackageId: string
  defaultDailyBudget?: number
  maximumDailyBudget?: number
  createdBy?: string
  accessFilter?: any
  tokenAccessFilter?: any
}) => {
  if (!createdBy) throw errorWithStatus('管理员身份缺失', 401)
  const playbook = await findPlaybook(playbookId, accessFilter)
  if (!playbook.eligibility?.eligible) {
    throw errorWithStatus(
      '打法版本未达到 AI 执行门槛',
      409,
      'PLAYBOOK_NOT_ELIGIBLE',
      playbook.eligibility,
    )
  }
  const selection = await resolveSelection({
    playbook,
    facebookTokenId,
    metaCredentialId,
    authorizationType,
    accountAssignments: accounts,
    targetingPackageId,
    creativeGroupId,
    copywritingPackageId,
    accessFilter,
    tokenAccessFilter,
  })
  const playbookMaximum = Math.max(
    1,
    asNumber(playbook.guardrails?.maximumPilotDailyBudget, 50),
  )
  const maxBudget = Math.max(1, asNumber(maximumDailyBudget, playbookMaximum))
  if (maxBudget > playbookMaximum) {
    throw errorWithStatus(
      `授权单日预算上限不能超过打法护栏 ${playbookMaximum}`,
      409,
      'AI_BUDGET_LIMIT_EXCEEDED',
    )
  }
  const defaultBudget = Math.max(
    1,
    asNumber(
      defaultDailyBudget,
      playbook.guardrails?.suggestedPilotDailyBudget || 20,
    ),
  )
  if (defaultBudget > maxBudget) {
    throw errorWithStatus(
      '默认日预算不能超过授权单日预算上限',
      409,
      'AI_DEFAULT_BUDGET_EXCEEDED',
    )
  }
  const mandate: any = await AiExecutionMandate.create({
    organizationId: playbook.organizationId,
    scopeKey: playbook.scopeKey,
    name:
      cleanString(name, 120) ||
      `AI授权_${playbook.optimizerId}_v${playbook.version}_${Date.now()}`,
    status: 'active',
    playbookVersionId: playbook._id,
    optimizerId: playbook.optimizerId,
    sourceBoundary: selection.boundary,
    authorizationType: selection.authorizationType,
    ...(selection.authorizationType === 'system_user'
      ? { metaCredentialId: selection.metaCredential._id }
      : {
          facebookTokenId: (selection.token as any)._id,
          facebookTokenOwnerUserId: (selection.token as any).userId,
        }),
    accounts: selection.targets,
    targetingPackageId: selection.targetingPackage._id,
    creativeGroupId: selection.creativeGroup._id,
    copywritingPackageId: selection.copywritingPackage._id,
    productId: selection.product._id,
    productSnapshot: {
      name: selection.product.name,
      identifier: selection.product.identifier,
      landingUrl: selection.copywritingPackage.links.websiteUrl,
      landingDomain: landingDomain(
        selection.copywritingPackage.links.websiteUrl,
      ),
      resolutionMode: selection.productResolutionMode,
    },
    budget: {
      defaultDailyBudget: defaultBudget,
      maximumDailyBudget: maxBudget,
      currency: selection.currency,
    },
    readiness: {
      ready: true,
      checkedAt: new Date(),
      checks: {
        sourceIsolation: true,
        tokenAndAccounts: true,
        pages: true,
        portableTargetingPackage: true,
        portableCreativeGroup: true,
        copywritingPackage: true,
        product: true,
        verifiedProductPixels: true,
      },
      warnings: [
        '高转化小时已写入定向包上下文；当前不会自动启用广告或自动分时开关。',
      ],
    },
    permissions: {
      accountAssignment: 'admin_explicit',
      metaWriteMode: 'paused_only',
      automaticActivationAllowed: false,
      automaticScalingAllowed: false,
    },
    approvedBy: createdBy,
    approvedAt: new Date(),
    createdBy,
    updatedBy: createdBy,
  })
  return mandate.toObject()
}

export const resolveExecutionMandate = async ({
  mandateId,
  playbook,
  accessFilter = {},
  tokenAccessFilter = {},
}: {
  mandateId: string
  playbook: any
  accessFilter?: any
  tokenAccessFilter?: any
}) => {
  if (!mongoose.Types.ObjectId.isValid(mandateId)) {
    throw errorWithStatus('AI 投放授权单 ID 无效')
  }
  const mandate: any = await AiExecutionMandate.findOne(
    combineFilters(
      {
        _id: mandateId,
        status: 'active',
        playbookVersionId: playbook._id,
      },
      accessFilter,
      orgConstraint(playbook.organizationId),
    ),
  ).lean()
  if (!mandate) {
    throw errorWithStatus(
      'AI 投放授权单不存在、已撤销或不属于当前打法',
      409,
      'AI_EXECUTION_MANDATE_REQUIRED',
    )
  }
  if (
    mandate.permissions?.metaWriteMode !== 'paused_only' ||
    mandate.permissions?.automaticActivationAllowed === true ||
    mandate.readiness?.ready !== true
  ) {
    throw errorWithStatus(
      'AI 投放授权单不满足 PAUSED 安全执行要求',
      409,
      'AI_EXECUTION_MANDATE_NOT_READY',
    )
  }
  const authorizationType: ExecutionAuthorizationType =
    mandate.authorizationType ||
    (mandate.metaCredentialId ? 'system_user' : 'personal_user')
  const selection = await resolveSelection({
    playbook,
    authorizationType,
    facebookTokenId:
      authorizationType === 'personal_user'
        ? String(mandate.facebookTokenId || '')
        : undefined,
    metaCredentialId:
      authorizationType === 'system_user'
        ? String(mandate.metaCredentialId || '')
        : undefined,
    accountAssignments: mandate.accounts,
    targetingPackageId: String(mandate.targetingPackageId),
    creativeGroupId: String(mandate.creativeGroupId),
    copywritingPackageId: String(mandate.copywritingPackageId),
    accessFilter,
    tokenAccessFilter,
  })
  if (String(selection.product._id) !== String(mandate.productId)) {
    throw errorWithStatus(
      '文案包对应产品已变化，必须由管理员重新创建授权单',
      409,
      'AI_MANDATE_PRODUCT_CHANGED',
    )
  }
  if (
    cleanString(selection.copywritingPackage.links?.websiteUrl, 2000) !==
    cleanString(mandate.productSnapshot?.landingUrl, 2000)
  ) {
    throw errorWithStatus(
      '文案包投放链接已变化，必须由管理员重新创建授权单',
      409,
      'AI_MANDATE_LANDING_URL_CHANGED',
    )
  }
  const storedPixels = new Map(
    (mandate.accounts || []).map((account: any) => [
      normalizeForStorage(account.accountId),
      String(account.pixelId),
    ]),
  )
  const changedPixelAccount = selection.targets.find(
    (target: any) =>
      storedPixels.get(target.accountId) !== String(target.pixelId),
  )
  if (changedPixelAccount) {
    throw errorWithStatus(
      `账户 ${changedPixelAccount.accountId} 的产品 Pixel 映射已变化，必须重新授权`,
      409,
      'AI_MANDATE_PIXEL_CHANGED',
    )
  }
  return { mandate, ...selection }
}

export const listExecutionMandates = async ({
  playbookId,
  status,
  accessFilter = {},
}: {
  playbookId?: string
  status?: string
  accessFilter?: any
} = {}) => {
  if (playbookId && !mongoose.Types.ObjectId.isValid(playbookId)) {
    throw errorWithStatus('打法版本 ID 无效')
  }
  const query = combineFilters(
    accessFilter,
    playbookId ? { playbookVersionId: playbookId } : {},
    status && ['active', 'revoked'].includes(status) ? { status } : {},
  )
  return AiExecutionMandate.find(query)
    .sort({ createdAt: -1 })
    .limit(100)
    .lean()
}

export const revokeExecutionMandate = async ({
  id,
  revokedBy,
  reason,
  accessFilter = {},
}: {
  id: string
  revokedBy?: string
  reason?: string
  accessFilter?: any
}) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw errorWithStatus('AI 投放授权单 ID 无效')
  }
  const mandate: any = await AiExecutionMandate.findOneAndUpdate(
    combineFilters({ _id: id, status: 'active' }, accessFilter),
    {
      $set: {
        status: 'revoked',
        revokedBy,
        revokedAt: new Date(),
        revokeReason: cleanString(reason, 500),
        updatedBy: revokedBy,
      },
    },
    { new: true },
  )
  if (!mandate) {
    throw errorWithStatus(
      '授权单不存在、无权访问或已撤销',
      404,
      'AI_EXECUTION_MANDATE_NOT_ACTIVE',
    )
  }
  return mandate.toObject()
}
