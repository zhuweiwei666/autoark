import Account from '../models/Account'
import ExternalMaterialSyncState from '../models/ExternalMaterialSyncState'
import { resolveExternalMaterialRuntime } from './externalMaterialRuntime.service'
import Material from '../models/Material'
import MaterialOriginMapping from '../models/MaterialOriginMapping'
import { getAccountIdsForQuery, normalizeForStorage } from '../utils/accountId'
import { combineFilters } from '../utils/accessControl'

export interface MaterialSmartGroupNode {
  key: string
  type: 'facebook-root' | 'facebook-account' | 'external-root' | 'external-provider' | 'external-package'
  label: string
  count: number
  status?: 'active' | 'disabled' | 'unavailable' | 'paused'
  paused?: boolean
  children?: MaterialSmartGroupNode[]
}

export interface FacebookMaterialMembership {
  facebookRelated: boolean
  accountIds: string[]
}

export const FACEBOOK_ALL_SMART_GROUP_KEY = '__all__'
export const FACEBOOK_UNASSIGNED_SMART_GROUP_KEY = '__unassigned__'

const ACTIVE_MATERIAL_STATUSES = ['uploaded', 'ready']
const SMART_GROUP_KEY_MAX_LENGTH = 128
const SMART_GROUP_LABEL_MAX_LENGTH = 120
const EXTERNAL_PACKAGE_KEY_PATTERN = /^pkg_[a-f0-9]{64}$/
const EXTERNAL_PROVIDER = 'guangdada'

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

const asCanonicalAccountIdExpression = (input: any): any => ({
  $let: {
    vars: { value: asTrimmedStringExpression(input) },
    in: {
      $cond: [
        { $eq: [{ $toLower: { $substrCP: ['$$value', 0, 4] } }, 'act_'] },
        {
          $substrCP: [
            '$$value',
            4,
            { $subtract: [{ $strLenCP: '$$value' }, 4] },
          ],
        },
        '$$value',
      ],
    },
  },
})

const distinctNonemptyAccountIdsExpression = (input: any, item: string, value: any): any => ({
  $setUnion: [
    {
      $filter: {
        input: {
          $map: {
            input: { $ifNull: [input, []] },
            as: item,
            in: asCanonicalAccountIdExpression(value),
          },
        },
        as: 'accountId',
        cond: { $ne: ['$$accountId', ''] },
      },
    },
    [],
  ],
})

type FacebookAccountIdSource = {
  path: string
  cardinality: 'scalar' | 'array'
  leafPath?: string
}

const FACEBOOK_ACCOUNT_ID_SOURCES: readonly FacebookAccountIdSource[] = [
  { path: 'facebookMappings', cardinality: 'array', leafPath: 'accountId' },
  { path: 'source.externalAccountId', cardinality: 'scalar' },
  { path: 'usage.accounts', cardinality: 'array' },
]
const FACEBOOK_PLATFORM_PATH = 'source.platform'

const valueAtMaterialPath = (value: any, path: string): any => path
  .split('.')
  .reduce((current, segment) => current?.[segment], value)

const distinctMaterialAccountIds = (values: any[]): string[] => [
  ...new Set(values.map(value => normalizeForStorage(value)).filter(Boolean)),
]

const accountIdValuesFromMaterial = (material: any, source: FacebookAccountIdSource): any[] => {
  const value = valueAtMaterialPath(material, source.path)
  if (source.cardinality === 'scalar') return [value]
  if (!Array.isArray(value)) return []
  return source.leafPath
    ? value.map(item => valueAtMaterialPath(item, source.leafPath!))
    : value
}

const accountIdSourceExpression = (source: FacebookAccountIdSource, index: number): any => {
  const fieldReference = `$${source.path}`
  if (source.cardinality === 'scalar') {
    return {
      $let: {
        vars: { accountId: asCanonicalAccountIdExpression(fieldReference) },
        in: {
          $cond: [
            { $ne: ['$$accountId', ''] },
            ['$$accountId'],
            [],
          ],
        },
      },
    }
  }

  const item = `source${index}Item`
  const valueReference = source.leafPath ? `$$${item}.${source.leafPath}` : `$$${item}`
  return distinctNonemptyAccountIdsExpression(fieldReference, item, valueReference)
}

const accountIdsBySourceFromMaterial = (material: any): string[][] => (
  FACEBOOK_ACCOUNT_ID_SOURCES.map(source => distinctMaterialAccountIds(
    accountIdValuesFromMaterial(material, source),
  ))
)

export const resolveFacebookMaterialMembership = (material: any): FacebookMaterialMembership => {
  const accountIdsBySource = accountIdsBySourceFromMaterial(material)
  const accountIds = accountIdsBySource.find(values => values.length > 0) || []
  const mappingRows = valueAtMaterialPath(material, FACEBOOK_ACCOUNT_ID_SOURCES[0].path)
  const sourcePlatform = valueAtMaterialPath(material, FACEBOOK_PLATFORM_PATH)

  return {
    facebookRelated: (
      (Array.isArray(mappingRows) && mappingRows.length > 0) ||
      String(sourcePlatform || '').trim().toLowerCase() === 'facebook' ||
      accountIdsBySource.slice(1).some(values => values.length > 0)
    ),
    accountIds,
  }
}

export const buildFacebookAccountIdsExpression = (): any => {
  const sourceVariable = (index: number) => `source${index}AccountIds`
  const variables = Object.fromEntries(FACEBOOK_ACCOUNT_ID_SOURCES.map((source, index) => (
    [sourceVariable(index), accountIdSourceExpression(source, index)]
  )))
  const inExpression = FACEBOOK_ACCOUNT_ID_SOURCES
    .map((_source, index) => sourceVariable(index))
    .slice(0, -1)
    .reduceRight<any>((fallback, variable) => ({
      $cond: [
        { $gt: [{ $size: `$$${variable}` }, 0] },
        `$$${variable}`,
        fallback,
      ],
    }), `$$${sourceVariable(FACEBOOK_ACCOUNT_ID_SOURCES.length - 1)}`)

  return {
    $let: {
      vars: variables,
      in: inExpression,
    },
  }
}

export const buildFacebookRelatedExpression = (): any => ({
  $or: [
    {
      $gt: [{
        $size: { $ifNull: [`$${FACEBOOK_ACCOUNT_ID_SOURCES[0].path}`, []] },
      }, 0],
    },
    {
      $eq: [
        { $toLower: asTrimmedStringExpression(`$${FACEBOOK_PLATFORM_PATH}`) },
        'facebook',
      ],
    },
    ...FACEBOOK_ACCOUNT_ID_SOURCES.slice(1).map((source, index) => ({
      $gt: [{ $size: accountIdSourceExpression(source, index + 1) }, 0],
    })),
  ],
})

export const buildFacebookSmartGroupFilter = (key: string): any => {
  const safeKey = String(key || '').trim().slice(0, SMART_GROUP_KEY_MAX_LENGTH)
  if (safeKey === FACEBOOK_ALL_SMART_GROUP_KEY) {
    return { $expr: buildFacebookRelatedExpression() }
  }
  if (safeKey === FACEBOOK_UNASSIGNED_SMART_GROUP_KEY) {
    return {
      $expr: {
        $and: [
          buildFacebookRelatedExpression(),
          { $eq: [{ $size: buildFacebookAccountIdsExpression() }, 0] },
        ],
      },
    }
  }

  const accountId = normalizeForStorage(safeKey)
  if (!accountId) return { _id: null }

  return {
    $expr: {
      $gt: [
        {
          $size: {
            $setIntersection: [
              buildFacebookAccountIdsExpression(),
              getAccountIdsForQuery([accountId]),
            ],
          },
        },
        0,
      ],
    },
  }
}

export const buildFacebookMembershipProjection = (): any => ({
  facebookRelated: buildFacebookRelatedExpression(),
  accountIds: buildFacebookAccountIdsExpression(),
})

export const buildFacebookSmartGroupPipeline = (materialFilter: any): any[] => [
  {
    $match: combineFilters(
      { status: { $in: ACTIVE_MATERIAL_STATUSES } },
      materialFilter,
    ),
  },
  {
    $project: buildFacebookMembershipProjection(),
  },
  {
    $facet: {
      global: [
        { $match: { facebookRelated: true } },
        { $count: 'count' },
      ],
      accounts: [
        { $match: { facebookRelated: true } },
        {
          $project: {
            memberships: {
              $cond: [
                { $gt: [{ $size: '$accountIds' }, 0] },
                '$accountIds',
                [FACEBOOK_UNASSIGNED_SMART_GROUP_KEY],
              ],
            },
          },
        },
        { $unwind: '$memberships' },
        { $group: { _id: '$memberships', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ],
    },
  },
]

export const buildExternalSmartGroupPipeline = ({
  materialCollectionName = Material.collection?.name || 'materials',
}: {
  materialCollectionName?: string
} = {}): any[] => [
  {
    $match: {
      provider: EXTERNAL_PROVIDER,
      packageKey: { $regex: EXTERNAL_PACKAGE_KEY_PATTERN },
    },
  },
  {
    $lookup: {
      from: materialCollectionName,
      let: { materialId: '$materialId' },
      pipeline: [
        {
          $match: {
            $expr: { $eq: ['$_id', '$$materialId'] },
            organizationId: { $in: [null] },
            status: { $in: ACTIVE_MATERIAL_STATUSES },
          },
        },
        { $project: { _id: 1 } },
      ],
      as: 'material',
    },
  },
  { $match: { 'material.0': { $exists: true } } },
  {
    $facet: {
      global: [
        { $group: { _id: '$materialId' } },
        { $count: 'count' },
      ],
      packages: [
        {
          $group: {
            _id: {
              packageKey: '$packageKey',
              materialId: '$materialId',
            },
            packageName: { $max: '$packageName' },
            productName: { $max: '$productName' },
          },
        },
        {
          $group: {
            _id: '$_id.packageKey',
            packageName: { $max: '$packageName' },
            productName: { $max: '$productName' },
            count: { $sum: 1 },
          },
        },
        { $sort: { productName: 1, packageName: 1, _id: 1 } },
      ],
    },
  },
]

const safeLabelText = (value: any): string => String(value || '')
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u001F\u007F]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, SMART_GROUP_LABEL_MAX_LENGTH)

const safeCount = (value: any): number => {
  const count = Number(value)
  return Number.isFinite(count) && count > 0
    ? Math.min(10_000_000, Math.trunc(count))
    : 0
}

const externalPackageLabel = (productName: any, packageName: any): string => {
  const product = safeLabelText(productName)
  const packageLabel = safeLabelText(packageName)
  if (product && packageLabel && product !== packageLabel) {
    return safeLabelText(`${product} · ${packageLabel}`)
  }
  return product || packageLabel || '未识别产品'
}

const safeLastFour = (accountId: string): string => {
  const suffix = accountId.slice(-4).replace(/[^a-zA-Z0-9_-]/g, '•')
  return suffix || '未知'
}

const accountNodeStatus = (account: any): MaterialSmartGroupNode['status'] => {
  if (!account) return 'unavailable'
  const status = String(account.status || '').trim().toLowerCase()
  if (
    (status && status !== 'active') ||
    (account.accountStatus !== undefined && account.accountStatus !== null && Number(account.accountStatus) !== 1) ||
    Number(account.disableReason || 0) > 0
  ) {
    return 'disabled'
  }
  return 'active'
}

export const getFacebookMaterialSmartGroups = async ({
  materialFilter,
  accountFilter,
}: {
  materialFilter: any
  accountFilter: any
}): Promise<MaterialSmartGroupNode[]> => {
  const [aggregation] = await Material.aggregate(buildFacebookSmartGroupPipeline(materialFilter))
  const globalCount = Number(aggregation?.global?.[0]?.count || 0)
  const countByAccount = new Map<string, number>()

  for (const row of aggregation?.accounts || []) {
    const key = row?._id === FACEBOOK_UNASSIGNED_SMART_GROUP_KEY
      ? FACEBOOK_UNASSIGNED_SMART_GROUP_KEY
      : normalizeForStorage(String(row?._id || '').slice(0, SMART_GROUP_KEY_MAX_LENGTH))
    if (!key) continue
    countByAccount.set(key, (countByAccount.get(key) || 0) + Number(row?.count || 0))
  }

  const accountIds = [...countByAccount.keys()].filter(key => (
    key !== FACEBOOK_UNASSIGNED_SMART_GROUP_KEY && key !== FACEBOOK_ALL_SMART_GROUP_KEY
  ))
  const accountDocs: any[] = accountIds.length > 0
    ? await Account.find(combineFilters(
      {
        channel: 'facebook',
        accountId: { $in: getAccountIdsForQuery(accountIds) },
      },
      accountFilter,
    ))
      .select('accountId name status accountStatus disableReason')
      .lean()
    : []

  const accountById = new Map<string, any>()
  for (const account of accountDocs) {
    const accountId = normalizeForStorage(account?.accountId)
    if (accountId && !accountById.has(accountId)) accountById.set(accountId, account)
  }

  const baseNameById = new Map<string, string>()
  const nameFrequency = new Map<string, number>()
  for (const accountId of accountIds) {
    const name = safeLabelText(accountById.get(accountId)?.name)
    if (!name) continue
    baseNameById.set(accountId, name)
    const collisionKey = name.toLocaleLowerCase()
    nameFrequency.set(collisionKey, (nameFrequency.get(collisionKey) || 0) + 1)
  }

  const accountNodes = accountIds.map<MaterialSmartGroupNode>((accountId) => {
    const account = accountById.get(accountId)
    const baseName = baseNameById.get(accountId)
    const hasDuplicateName = baseName
      ? (nameFrequency.get(baseName.toLocaleLowerCase()) || 0) > 1
      : false
    const label = baseName
      ? `${baseName}${hasDuplicateName ? ` · ${safeLastFour(accountId)}` : ''}`
      : `Facebook 账户 · ${safeLastFour(accountId)}`

    return {
      key: accountId,
      type: 'facebook-account',
      label,
      count: countByAccount.get(accountId) || 0,
      status: accountNodeStatus(account),
    }
  }).sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key))

  const root: MaterialSmartGroupNode = {
    key: 'facebook',
    type: 'facebook-root',
    label: 'Facebook',
    count: globalCount,
    children: [
      {
        key: FACEBOOK_ALL_SMART_GROUP_KEY,
        type: 'facebook-account',
        label: '全部 Facebook 素材',
        count: globalCount,
      },
      {
        key: FACEBOOK_UNASSIGNED_SMART_GROUP_KEY,
        type: 'facebook-account',
        label: '未归属账户',
        count: countByAccount.get(FACEBOOK_UNASSIGNED_SMART_GROUP_KEY) || 0,
      },
      ...accountNodes,
    ],
  }

  return [root]
}

export const getExternalMaterialSmartGroups = async (): Promise<MaterialSmartGroupNode[]> => {
  const [aggregationRows, state] = await Promise.all([
    MaterialOriginMapping.aggregate(buildExternalSmartGroupPipeline()),
    ExternalMaterialSyncState.findOne({ provider: EXTERNAL_PROVIDER })
      .select('paused recurringEnabled')
      .lean(),
  ])
  const aggregation = aggregationRows?.[0]
  const globalCount = safeCount(aggregation?.global?.[0]?.count)
  const packages = (aggregation?.packages || [])
    .map((row: any): MaterialSmartGroupNode | undefined => {
      const key = String(row?._id || '').trim()
      if (!EXTERNAL_PACKAGE_KEY_PATTERN.test(key)) return undefined
      return {
        key,
        type: 'external-package',
        label: externalPackageLabel(row?.productName, row?.packageName),
        count: safeCount(row?.count),
      }
    })
    .filter((row: MaterialSmartGroupNode | undefined): row is MaterialSmartGroupNode => Boolean(row))
    .sort((a: MaterialSmartGroupNode, b: MaterialSmartGroupNode) => (
      a.label.localeCompare(b.label) || a.key.localeCompare(b.key)
    ))
  const paused = state?.paused === true
  const runtime = resolveExternalMaterialRuntime({
    paused,
    recurringEnabled: state?.recurringEnabled !== false,
  })
  const provider: MaterialSmartGroupNode = {
    key: EXTERNAL_PROVIDER,
    type: 'external-provider',
    label: '广大大',
    count: globalCount,
    paused,
    status: runtime.status,
    children: packages,
  }

  return [{
    key: 'external',
    type: 'external-root',
    label: '外部优质素材',
    count: globalCount,
    children: [provider],
  }]
}
