import mongoose from 'mongoose'
import Material from '../models/Material'
import MaterialOriginMapping from '../models/MaterialOriginMapping'
import { buildFacebookRelatedExpression } from './materialSmartGroup.service'

const ACTIVE_MATERIAL_STATUSES = ['uploaded', 'ready'] as const
const EXTERNAL_PROVIDER = 'guangdada'
const EXTERNAL_ORIGIN_LIMIT = 50
const EXTERNAL_PACKAGE_KEY_PATTERN = /^pkg_[a-f0-9]{64}$/
const SAFE_LABEL_MAX_LENGTH = 120
const SAFE_URL_MAX_LENGTH = 2048
const SAFE_METRIC_MAX = 1_000_000_000_000

export interface MaterialPageQuery {
  filter: any
  sort: Record<string, 1 | -1>
  skip: number
  pageSize: number
  externalPackageKey?: string
  excludeExternalOnly?: boolean
}

export interface MaterialPageResult {
  list: any[]
  total: number
}

export interface MaterialOriginResult {
  origins: Array<Record<string, unknown>>
  total: number
  hasMore: boolean
}

const MISSING_SCOPE_VALUE = Symbol('missing-scope-value')

const scopeConditionMatches = (
  condition: any,
  value: unknown | typeof MISSING_SCOPE_VALUE,
): boolean => {
  if (condition === null) {
    return value === null || value === MISSING_SCOPE_VALUE
  }
  if (
    condition instanceof RegExp ||
    Array.isArray(condition) ||
    typeof condition !== 'object'
  ) {
    return false
  }

  const entries = Object.entries(condition)
  if (
    entries.length === 0 ||
    entries.some(([operator]) => !operator.startsWith('$'))
  ) {
    return false
  }

  return entries.every(([operator, operand]) => {
    if (operator === '$eq') return scopeConditionMatches(operand, value)
    if (operator === '$in') {
      return (
        Array.isArray(operand) &&
        operand.some((candidate) => scopeConditionMatches(candidate, value))
      )
    }
    if (operator === '$exists') {
      return Boolean(operand) === (value !== MISSING_SCOPE_VALUE)
    }
    if (operator === '$ne') {
      if (value === MISSING_SCOPE_VALUE && operand === null) return false
      return !scopeConditionMatches(operand, value)
    }
    if (operator === '$nin') {
      if (value === MISSING_SCOPE_VALUE) return true
      return (
        Array.isArray(operand) &&
        !operand.some((candidate) => scopeConditionMatches(candidate, value))
      )
    }
    if (operator === '$not') return !scopeConditionMatches(operand, value)
    return true
  })
}

const filterMayMatchGlobalState = (
  filter: any,
  organizationId: null | typeof MISSING_SCOPE_VALUE,
): boolean => {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter))
    return true

  return Object.entries(filter).every(([field, condition]) => {
    if (field === '$and') {
      return (
        !Array.isArray(condition) ||
        condition.every((part) =>
          filterMayMatchGlobalState(part, organizationId),
        )
      )
    }
    if (field === '$or') {
      return (
        !Array.isArray(condition) ||
        condition.some((part) =>
          filterMayMatchGlobalState(part, organizationId),
        )
      )
    }
    if (field === 'organizationId') {
      return scopeConditionMatches(condition, organizationId)
    }
    if (field === 'createdBy') {
      return scopeConditionMatches(condition, MISSING_SCOPE_VALUE)
    }
    return true
  })
}

export const materialFilterMayMatchGlobal = (filter: any): boolean =>
  filterMayMatchGlobalState(filter, null) ||
  filterMayMatchGlobalState(filter, MISSING_SCOPE_VALUE)

const asTrimmedStringExpression = (input: any): any => ({
  $trim: {
    input: {
      $convert: {
        input,
        to: 'string',
        onError: '',
        onNull: '',
      },
    },
  },
})

const externalOnlyExpression = (): any => ({
  $and: [
    {
      $gt: [{ $size: { $ifNull: ['$__externalOrigins', []] } }, 0],
    },
    {
      $in: [{ $ifNull: ['$organizationId', null] }, [null]],
    },
    {
      $eq: [
        { $toLower: asTrimmedStringExpression('$source.platform') },
        EXTERNAL_PROVIDER,
      ],
    },
    {
      $eq: [
        { $toLower: asTrimmedStringExpression('$source.importedBy') },
        'external-material-sync',
      ],
    },
    {
      $eq: [buildFacebookRelatedExpression(), false],
    },
  ],
})

const externalOriginLookup = (originCollectionName: string): any => ({
  $lookup: {
    from: originCollectionName,
    let: { materialId: '$_id' },
    pipeline: [
      {
        $match: {
          $expr: {
            $and: [
              { $eq: ['$materialId', '$$materialId'] },
              { $eq: ['$provider', EXTERNAL_PROVIDER] },
            ],
          },
        },
      },
      { $project: { _id: 1 } },
      { $limit: 1 },
    ],
    as: '__externalOrigins',
  },
})

const externalPackageLookup = (
  packageKey: string,
  originCollectionName: string,
): any => ({
  $lookup: {
    from: originCollectionName,
    let: { materialId: '$_id' },
    pipeline: [
      {
        $match: {
          $expr: {
            $and: [
              { $eq: ['$materialId', '$$materialId'] },
              { $eq: ['$provider', EXTERNAL_PROVIDER] },
              { $eq: ['$packageKey', packageKey] },
            ],
          },
        },
      },
      { $limit: 1 },
      { $project: { _id: 1 } },
    ],
    as: '__externalPackageOrigins',
  },
})

export const isExternalPackageKey = (value: unknown): value is string =>
  typeof value === 'string' && EXTERNAL_PACKAGE_KEY_PATTERN.test(value)

export const buildMaterialPagePipeline = ({
  filter,
  sort,
  skip,
  pageSize,
  externalPackageKey,
  excludeExternalOnly = false,
  originCollectionName = MaterialOriginMapping.collection?.name ||
    'materialoriginmappings',
}: MaterialPageQuery & { originCollectionName?: string }): any[] => {
  const pipeline: any[] = [{ $match: filter }]

  if (externalPackageKey) {
    pipeline.push(
      externalPackageLookup(externalPackageKey, originCollectionName),
      { $match: { '__externalPackageOrigins.0': { $exists: true } } },
      { $project: { __externalPackageOrigins: 0 } },
    )
  }

  if (excludeExternalOnly && materialFilterMayMatchGlobal(filter)) {
    pipeline.push(
      externalOriginLookup(originCollectionName),
      { $match: { $expr: { $not: [externalOnlyExpression()] } } },
      { $project: { __externalOrigins: 0 } },
    )
  }

  pipeline.push({
    $facet: {
      data: [{ $sort: sort }, { $skip: skip }, { $limit: pageSize }],
      total: [{ $count: 'count' }],
    },
  })
  return pipeline
}

const safeCount = (value: unknown): number => {
  const count = Number(value)
  return Number.isFinite(count) && count > 0
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(count))
    : 0
}

export const queryMaterialPage = async (
  query: MaterialPageQuery,
): Promise<MaterialPageResult> => {
  const [result] = await Material.aggregate(buildMaterialPagePipeline(query))
  return {
    list: Array.isArray(result?.data) ? result.data : [],
    total: safeCount(result?.total?.[0]?.count),
  }
}

export const buildMaterialOriginPipeline = (
  materialId: mongoose.Types.ObjectId,
): any[] => [
  {
    $match: {
      materialId,
      provider: EXTERNAL_PROVIDER,
    },
  },
  { $sort: { lastSeenAt: -1, firstSeenAt: 1, _id: 1 } },
  {
    $group: {
      _id: '$providerAssetKey',
      origin: { $first: '$$ROOT' },
    },
  },
  { $replaceRoot: { newRoot: '$origin' } },
  { $sort: { lastSeenAt: -1, firstSeenAt: 1, _id: 1 } },
  {
    $facet: {
      data: [
        { $limit: EXTERNAL_ORIGIN_LIMIT },
        {
          $project: {
            _id: 0,
            provider: 1,
            packageName: 1,
            productName: 1,
            advertiserName: 1,
            heat: 1,
            estimatedValue: 1,
            firstSeenAt: 1,
            lastSeenAt: 1,
            mediaType: 1,
            sourcePageUrl: 1,
          },
        },
      ],
      total: [{ $count: 'count' }],
    },
  },
]

const safeText = (value: unknown): string =>
  String(value || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SAFE_LABEL_MAX_LENGTH)

const safeOriginLabel = (
  productName: unknown,
  packageName: unknown,
): string => {
  const product = safeText(productName)
  const packageLabel = safeText(packageName)
  if (product && packageLabel && product !== packageLabel) {
    return safeText(`${product} · ${packageLabel}`)
  }
  return product || packageLabel || '未识别产品'
}

const safeMetric = (value: unknown): number | undefined => {
  const metric = Number(value)
  if (!Number.isFinite(metric) || metric < 0) return undefined
  return Math.min(SAFE_METRIC_MAX, metric)
}

const safeDate = (value: unknown): Date | undefined => {
  const date = value instanceof Date ? value : new Date(String(value || ''))
  return Number.isFinite(date.getTime()) ? date : undefined
}

const safeSourcePageUrl = (value: unknown): string | undefined => {
  const text =
    typeof value === 'string' ? value.trim().slice(0, SAFE_URL_MAX_LENGTH) : ''
  if (!text) return undefined

  try {
    const url = new URL(text)
    if (url.protocol !== 'https:') return undefined
    const sanitized = `${url.origin}${url.pathname || '/'}`
    return sanitized.slice(0, SAFE_URL_MAX_LENGTH)
  } catch {
    return undefined
  }
}

const safeOriginSummary = (row: any): Record<string, unknown> => {
  const advertiser = safeText(row?.advertiserName)
  const heat = safeMetric(row?.heat)
  const estimatedValue = safeMetric(row?.estimatedValue)
  const firstSeenAt = safeDate(row?.firstSeenAt)
  const lastSeenAt = safeDate(row?.lastSeenAt)
  const mediaType =
    row?.mediaType === 'image' || row?.mediaType === 'video'
      ? row.mediaType
      : undefined
  const sourcePageUrl = safeSourcePageUrl(row?.sourcePageUrl)

  return {
    provider: '广大大',
    label: safeOriginLabel(row?.productName, row?.packageName),
    ...(advertiser ? { advertiser } : {}),
    ...(heat !== undefined ? { heat } : {}),
    ...(estimatedValue !== undefined ? { estimatedValue } : {}),
    ...(firstSeenAt ? { firstSeenAt } : {}),
    ...(lastSeenAt ? { lastSeenAt } : {}),
    ...(mediaType ? { mediaType } : {}),
    ...(sourcePageUrl ? { sourcePageUrl } : {}),
  }
}

export const queryMaterialOrigins = async (
  materialIdText: string,
): Promise<MaterialOriginResult | null> => {
  const materialId = new mongoose.Types.ObjectId(materialIdText)
  const material = await Material.findOne({
    _id: materialId,
    organizationId: { $in: [null] },
    status: { $in: ACTIVE_MATERIAL_STATUSES },
  })
    .select('_id')
    .lean()
  if (!material) return null

  const [result] = await MaterialOriginMapping.aggregate(
    buildMaterialOriginPipeline(materialId),
  )
  const total = safeCount(result?.total?.[0]?.count)
  if (total === 0) return null
  const origins = (Array.isArray(result?.data) ? result.data : [])
    .slice(0, EXTERNAL_ORIGIN_LIMIT)
    .map(safeOriginSummary)
  return {
    origins,
    total,
    hasMore: total > origins.length,
  }
}
