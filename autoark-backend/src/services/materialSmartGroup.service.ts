import Account from '../models/Account'
import Material from '../models/Material'
import { getAccountIdsForQuery, normalizeForStorage } from '../utils/accountId'
import { combineFilters } from '../utils/accessControl'

export interface MaterialSmartGroupNode {
  key: string
  type: 'facebook-root' | 'facebook-account' | 'external-root' | 'external-provider' | 'external-package'
  label: string
  count: number
  status?: 'active' | 'disabled' | 'unavailable' | 'paused'
  children?: MaterialSmartGroupNode[]
}

export const FACEBOOK_ALL_SMART_GROUP_KEY = '__all__'
export const FACEBOOK_UNASSIGNED_SMART_GROUP_KEY = '__unassigned__'

const ACTIVE_MATERIAL_STATUSES = ['uploaded', 'ready']
const SMART_GROUP_KEY_MAX_LENGTH = 128
const SMART_GROUP_LABEL_MAX_LENGTH = 120

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

const mappingAccountIdsExpression = (): any => distinctNonemptyAccountIdsExpression(
  '$facebookMappings',
  'mapping',
  '$$mapping.accountId',
)

const usageAccountIdsExpression = (): any => distinctNonemptyAccountIdsExpression(
  '$usage.accounts',
  'usageAccountId',
  '$$usageAccountId',
)

export const buildFacebookAccountIdsExpression = (): any => ({
  $let: {
    vars: {
      mappingAccountIds: mappingAccountIdsExpression(),
      sourceAccountId: asCanonicalAccountIdExpression('$source.externalAccountId'),
      usageAccountIds: usageAccountIdsExpression(),
    },
    in: {
      $cond: [
        { $gt: [{ $size: '$$mappingAccountIds' }, 0] },
        '$$mappingAccountIds',
        {
          $cond: [
            { $ne: ['$$sourceAccountId', ''] },
            ['$$sourceAccountId'],
            '$$usageAccountIds',
          ],
        },
      ],
    },
  },
})

export const buildFacebookRelatedExpression = (): any => ({
  $or: [
    { $gt: [{ $size: { $ifNull: ['$facebookMappings', []] } }, 0] },
    {
      $eq: [
        { $toLower: asTrimmedStringExpression('$source.platform') },
        'facebook',
      ],
    },
    { $ne: [asCanonicalAccountIdExpression('$source.externalAccountId'), ''] },
    { $gt: [{ $size: usageAccountIdsExpression() }, 0] },
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

const buildFacebookSmartGroupPipeline = (materialFilter: any): any[] => [
  {
    $match: combineFilters(
      { status: { $in: ACTIVE_MATERIAL_STATUSES } },
      materialFilter,
    ),
  },
  {
    $project: {
      facebookRelated: buildFacebookRelatedExpression(),
      accountIds: buildFacebookAccountIdsExpression(),
    },
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

const safeLabelText = (value: any): string => String(value || '')
  .replace(/[\u0000-\u001F\u007F]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, SMART_GROUP_LABEL_MAX_LENGTH)

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
