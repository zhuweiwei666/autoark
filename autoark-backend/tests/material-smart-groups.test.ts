import fs from 'fs'
import path from 'path'

const mockMaterialAggregate = jest.fn()
const mockMaterialFind = jest.fn()
const mockMaterialCountDocuments = jest.fn()
const mockAccountFind = jest.fn()
const mockOriginAggregate = jest.fn()
const mockStateLean = jest.fn()
const mockStateSelect = jest.fn(() => ({ lean: mockStateLean }))
const mockStateFindOne = jest.fn(() => ({ select: mockStateSelect }))

jest.mock('../src/models/Material', () => ({
  __esModule: true,
  default: {
    aggregate: mockMaterialAggregate,
    find: mockMaterialFind,
    countDocuments: mockMaterialCountDocuments,
  },
}))

jest.mock('../src/models/Account', () => ({
  __esModule: true,
  default: {
    find: mockAccountFind,
    findOne: jest.fn(),
  },
}))

jest.mock('../src/models/MaterialOriginMapping', () => ({
  __esModule: true,
  default: {
    aggregate: mockOriginAggregate,
  },
}))

jest.mock('../src/models/ExternalMaterialSyncState', () => ({
  __esModule: true,
  default: {
    findOne: mockStateFindOne,
  },
}))

jest.mock('../src/models/Folder', () => ({
  __esModule: true,
  default: {},
}))

jest.mock('../src/models/Ad', () => ({
  __esModule: true,
  default: {},
}))

jest.mock('../src/services/r2Storage.service', () => ({
  uploadToR2: jest.fn(),
  deleteFromR2: jest.fn(),
  getObjectFromR2: jest.fn(),
  checkR2Config: jest.fn(),
  generatePresignedUploadUrl: jest.fn(),
  generatePresignedUploadUrls: jest.fn(),
  getPublicUrlForKey: jest.fn(),
}))

jest.mock('../src/services/materialTracking.service', () => ({
  calculateFingerprint: jest.fn(),
  checkDuplicate: jest.fn(),
  recordFacebookMapping: jest.fn(),
  findMaterialByFacebookId: jest.fn(),
  getReusableMaterials: jest.fn(),
  getMaterialFullData: jest.fn(),
  aggregateMetricsToMaterials: jest.fn(),
  recordAdMaterialMapping: jest.fn(),
  recordAdMaterialMappings: jest.fn(),
}))

import * as materialController from '../src/controllers/material.controller'
import logger from '../src/utils/logger'

const ORG_ID = '665000000000000000000001'

const createRequest = (query: any = {}, user: any = {}) => ({
  query,
  user: {
    userId: '665000000000000000000002',
    organizationId: ORG_ID,
    role: 'org_admin',
    permissions: [],
    ...user,
  },
}) as any

const createResponse = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
})

const mockListQuery = () => {
  const query: any = {
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
    lean: jest.fn().mockResolvedValue([]),
  }
  query.sort.mockReturnValue(query)
  query.skip.mockReturnValue(query)
  query.limit.mockReturnValue(query)
  return query
}

const mockAccountQuery = (accounts: any[]) => {
  const query: any = {
    select: jest.fn(),
    lean: jest.fn().mockResolvedValue(accounts),
  }
  query.select.mockReturnValue(query)
  mockAccountFind.mockReturnValue(query)
  return query
}

const loadSmartGroupService = (): any => {
  try {
    return jest.requireActual('../src/services/materialSmartGroup.service')
  } catch (_error) {
    return undefined
  }
}

const valueAtPath = (value: any, pathText: string): any => {
  if (!pathText) return value
  return pathText.split('.').reduce((current, segment) => current?.[segment], value)
}

const evaluateMongoExpression = (
  expression: any,
  document: any,
  variables: Record<string, any> = {},
): any => {
  if (Array.isArray(expression)) {
    return expression.map(value => evaluateMongoExpression(value, document, variables))
  }
  if (expression === null || typeof expression !== 'object') {
    if (typeof expression !== 'string' || !expression.startsWith('$')) return expression
    const reference = expression.slice(expression.startsWith('$$') ? 2 : 1)
    const [root, ...path] = reference.split('.')
    const source = expression.startsWith('$$') ? variables[root] : document[root]
    return valueAtPath(source, path.join('.'))
  }

  if ('$let' in expression) {
    const scoped = { ...variables }
    Object.entries(expression.$let.vars).forEach(([name, value]) => {
      scoped[name] = evaluateMongoExpression(value, document, variables)
    })
    return evaluateMongoExpression(expression.$let.in, document, scoped)
  }
  if ('$trim' in expression) {
    return String(evaluateMongoExpression(expression.$trim.input, document, variables) ?? '').trim()
  }
  if ('$convert' in expression) {
    const value = evaluateMongoExpression(expression.$convert.input, document, variables)
    if (value === null || value === undefined) {
      return evaluateMongoExpression(expression.$convert.onNull, document, variables)
    }
    if (expression.$convert.to !== 'string') throw new Error('Unsupported $convert target')
    return String(value)
  }
  if ('$cond' in expression) {
    const [condition, whenTrue, whenFalse] = expression.$cond
    return evaluateMongoExpression(condition, document, variables)
      ? evaluateMongoExpression(whenTrue, document, variables)
      : evaluateMongoExpression(whenFalse, document, variables)
  }
  if ('$eq' in expression || '$ne' in expression || '$gt' in expression) {
    const operator = '$eq' in expression ? '$eq' : '$ne' in expression ? '$ne' : '$gt'
    const [left, right] = expression[operator].map((value: any) => (
      evaluateMongoExpression(value, document, variables)
    ))
    if (operator === '$eq') return left === right
    if (operator === '$ne') return left !== right
    return left > right
  }
  if ('$toLower' in expression) {
    return String(evaluateMongoExpression(expression.$toLower, document, variables)).toLowerCase()
  }
  if ('$substrCP' in expression) {
    const [input, start, length] = expression.$substrCP.map((value: any) => (
      evaluateMongoExpression(value, document, variables)
    ))
    return Array.from(String(input)).slice(start, start + length).join('')
  }
  if ('$subtract' in expression) {
    const [left, right] = expression.$subtract.map((value: any) => (
      evaluateMongoExpression(value, document, variables)
    ))
    return left - right
  }
  if ('$strLenCP' in expression) {
    return Array.from(String(evaluateMongoExpression(expression.$strLenCP, document, variables))).length
  }
  if ('$setUnion' in expression) {
    const values = expression.$setUnion.flatMap((value: any) => (
      evaluateMongoExpression(value, document, variables)
    ))
    return [...new Map(values.map((value: any) => [JSON.stringify(value), value])).values()]
  }
  if ('$filter' in expression) {
    const input = evaluateMongoExpression(expression.$filter.input, document, variables)
    return input.filter((value: any) => evaluateMongoExpression(
      expression.$filter.cond,
      document,
      { ...variables, [expression.$filter.as]: value },
    ))
  }
  if ('$map' in expression) {
    const input = evaluateMongoExpression(expression.$map.input, document, variables)
    return input.map((value: any) => evaluateMongoExpression(
      expression.$map.in,
      document,
      { ...variables, [expression.$map.as]: value },
    ))
  }
  if ('$ifNull' in expression) {
    const [value, fallback] = expression.$ifNull
    const evaluated = evaluateMongoExpression(value, document, variables)
    return evaluated === null || evaluated === undefined
      ? evaluateMongoExpression(fallback, document, variables)
      : evaluated
  }
  if ('$size' in expression) {
    return evaluateMongoExpression(expression.$size, document, variables).length
  }
  if ('$or' in expression) {
    return expression.$or.some((value: any) => evaluateMongoExpression(value, document, variables))
  }

  return Object.fromEntries(Object.entries(expression).map(([key, value]) => (
    [key, evaluateMongoExpression(value, document, variables)]
  )))
}

const matchesMongoFilter = (document: any, filter: any): boolean => {
  if (filter.$and) return filter.$and.every((part: any) => matchesMongoFilter(document, part))
  return Object.entries(filter).every(([pathText, expected]: [string, any]) => {
    const actual = valueAtPath(document, pathText)
    if (expected && typeof expected === 'object' && '$in' in expected) {
      return expected.$in.includes(actual)
    }
    return actual === expected
  })
}

describe('Facebook material smart groups', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.EXTERNAL_MATERIAL_SYNC_ENABLED = 'true'
    process.env.GUANGDADA_API_KEY = 'unit-test-provider-key'
    mockMaterialFind.mockReturnValue(mockListQuery())
    mockMaterialCountDocuments.mockResolvedValue(0)
    mockOriginAggregate.mockResolvedValue([{ global: [], packages: [] }])
    mockStateLean.mockResolvedValue({ paused: false })
  })

  afterEach(() => {
    delete process.env.EXTERNAL_MATERIAL_SYNC_ENABLED
    delete process.env.GUANGDADA_API_KEY
  })

  it('resolves raw visible material fixtures before grouping and counts A+B once globally', async () => {
    const service = loadSmartGroupService()
    expect(service).toBeDefined()

    expect(service.resolveFacebookMaterialMembership).toEqual(expect.any(Function))
    expect(service.buildFacebookSmartGroupPipeline).toEqual(expect.any(Function))
    const fixtures = [
      {
        _id: 'mapping-a-b',
        organizationId: ORG_ID,
        status: 'uploaded',
        facebookMappings: [
          { accountId: '1111' },
          { accountId: '2222' },
          { accountId: 'act_1111' },
        ],
        source: { platform: 'facebook', externalAccountId: '3333' },
        usage: { accounts: ['4444'] },
      },
      {
        _id: 'source-fallback',
        organizationId: ORG_ID,
        status: 'ready',
        facebookMappings: [{ accountId: ' ' }],
        source: { platform: 'facebook', externalAccountId: '3333' },
        usage: { accounts: ['4444'] },
      },
      {
        _id: 'usage-fallback',
        organizationId: ORG_ID,
        status: 'uploaded',
        facebookMappings: [],
        source: { platform: 'facebook' },
        usage: { accounts: ['4444', 'act_4444'] },
      },
      {
        _id: 'facebook-unassigned',
        organizationId: ORG_ID,
        status: 'ready',
        source: { platform: 'facebook' },
        usage: { accounts: [] },
      },
      {
        _id: 'manual-unrelated',
        organizationId: ORG_ID,
        status: 'uploaded',
        source: { type: 'upload' },
        usage: { accounts: [] },
      },
      {
        _id: 'foreign-tenant',
        organizationId: '665000000000000000000099',
        status: 'ready',
        facebookMappings: [{ accountId: '9999' }],
      },
      {
        _id: 'inactive-visible-tenant',
        organizationId: ORG_ID,
        status: 'processing',
        facebookMappings: [{ accountId: '8888' }],
      },
    ]

    const expectedPipeline = service.buildFacebookSmartGroupPipeline({ organizationId: ORG_ID })
    expect(expectedPipeline[0].$match).toEqual({
      $and: [
        { status: { $in: ['uploaded', 'ready'] } },
        { organizationId: ORG_ID },
      ],
    })
    const projection = expectedPipeline[1].$project
    const visible = fixtures.filter(material => matchesMongoFilter(material, expectedPipeline[0].$match))
    const resolved = visible.map(material => ({
      id: material._id,
      ...evaluateMongoExpression(projection, material),
    }))
    expect(resolved).toEqual([
      { id: 'mapping-a-b', facebookRelated: true, accountIds: ['1111', '2222'] },
      { id: 'source-fallback', facebookRelated: true, accountIds: ['3333'] },
      { id: 'usage-fallback', facebookRelated: true, accountIds: ['4444'] },
      { id: 'facebook-unassigned', facebookRelated: true, accountIds: [] },
      { id: 'manual-unrelated', facebookRelated: false, accountIds: [] },
    ])
    visible.forEach((material, index) => {
      expect(service.resolveFacebookMaterialMembership(material)).toEqual({
        facebookRelated: resolved[index].facebookRelated,
        accountIds: resolved[index].accountIds,
      })
    })

    const related = resolved.filter(material => material.facebookRelated)
    const countByAccount = new Map<string, number>()
    related.forEach((material) => {
      const memberships = material.accountIds.length > 0
        ? material.accountIds
        : ['__unassigned__']
      memberships.forEach((accountId: string) => {
        countByAccount.set(accountId, (countByAccount.get(accountId) || 0) + 1)
      })
    })

    mockMaterialAggregate.mockResolvedValue([{
      global: [{ count: related.length }],
      accounts: [...countByAccount].map(([_id, count]) => ({ _id, count })),
    }])
    mockAccountQuery([
      { accountId: '1111', name: 'Alpha', status: 'active', accountStatus: 1 },
      { accountId: '2222', name: 'Beta', status: 'active', accountStatus: 1 },
      { accountId: '3333', name: 'Gamma', status: 'active', accountStatus: 1 },
      { accountId: '4444', name: 'Delta', status: 'active', accountStatus: 1 },
    ])

    const roots = await service.getFacebookMaterialSmartGroups({
      materialFilter: { organizationId: ORG_ID },
      accountFilter: { organizationId: ORG_ID },
    })

    expect(roots).toHaveLength(1)
    expect(roots[0]).toMatchObject({
      key: 'facebook',
      type: 'facebook-root',
      label: 'Facebook',
      count: 4,
    })
    expect(roots[0].children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: '__all__', count: 4 }),
        expect.objectContaining({ key: '__unassigned__', count: 1 }),
        expect.objectContaining({
          key: '__optimizer_unassigned__',
          type: 'facebook-optimizer',
          count: 4,
        }),
      ]),
    )
    const unassignedOptimizer = roots[0].children.find(
      (node: { key: string }) => node.key === '__optimizer_unassigned__',
    )
    expect(unassignedOptimizer.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: '1111', count: 1 }),
        expect.objectContaining({ key: '2222', count: 1 }),
        expect.objectContaining({ key: '3333', count: 1 }),
        expect.objectContaining({ key: '4444', count: 1 }),
      ]),
    )

    const pipeline = mockMaterialAggregate.mock.calls[0][0]
    expect(pipeline).toEqual(expectedPipeline)
    const unwindStages = JSON.stringify(pipeline).match(/\"\$unwind\"/g) || []
    expect(unwindStages).toHaveLength(1)
    expect(pipeline[1].$project.accountIds).toEqual(service.buildFacebookAccountIdsExpression())
    expect(pipeline[1].$project.facebookRelated).toEqual(service.buildFacebookRelatedExpression())
    expect(pipeline[2].$facet.global).toContainEqual({ $count: 'count' })
    expect(pipeline[2].$facet.accounts).toContainEqual({
      $group: {
        _id: '$memberships',
        count: { $sum: 1 },
        materialIds: { $addToSet: '$materialId' },
      },
    })
  })

  it('uses mapping, then source, then usage precedence in both aggregation and list filters', () => {
    const service = loadSmartGroupService()
    expect(service).toBeDefined()

    const accountIdsExpression = service.buildFacebookAccountIdsExpression()
    expect(accountIdsExpression.$let.in).toEqual({
      $cond: [
        { $gt: [{ $size: '$$source0AccountIds' }, 0] },
        '$$source0AccountIds',
        {
          $cond: [
            { $gt: [{ $size: '$$source1AccountIds' }, 0] },
            '$$source1AccountIds',
            '$$source2AccountIds',
          ],
        },
      ],
    })

    const accountFilter = service.buildFacebookSmartGroupFilter('1234')
    expect(accountFilter).toEqual({
      $expr: {
        $gt: [
          {
            $size: {
              $setIntersection: [
                accountIdsExpression,
                ['1234', 'act_1234'],
              ],
            },
          },
          0,
        ],
      },
    })
  })

  it('groups accounts by optimizer and deduplicates reused materials in optimizer counts', async () => {
    const service = loadSmartGroupService()
    expect(service).toBeDefined()

    mockMaterialAggregate.mockResolvedValue([
      {
        global: [{ count: 5 }],
        accounts: [
          {
            _id: '11111111',
            count: 2,
            materialIds: ['material-a', 'material-shared'],
          },
          {
            _id: '22222222',
            count: 2,
            materialIds: ['material-shared', 'material-b'],
          },
          { _id: '33333333', count: 1, materialIds: ['material-c'] },
          { _id: '44444444', count: 1, materialIds: ['material-d'] },
          {
            _id: '__unassigned__',
            count: 1,
            materialIds: ['material-unassigned'],
          },
        ],
      },
    ])
    const accountQuery = mockAccountQuery([
      {
        accountId: '11111111',
        name: 'Alpha',
        operator: ' Alice\u0000 ',
        status: 'active',
        accountStatus: 1,
      },
      {
        accountId: '22222222',
        name: 'Beta',
        operator: 'alice',
        status: 'active',
        accountStatus: 1,
      },
      {
        accountId: '33333333',
        name: 'Gamma',
        operator: 'Bob',
        status: 'active',
        accountStatus: 1,
      },
      {
        accountId: '44444444',
        name: 'Delta',
        operator: ' ',
        status: 'active',
        accountStatus: 1,
      },
    ])

    const [root] = await service.getFacebookMaterialSmartGroups({
      materialFilter: { organizationId: ORG_ID },
      accountFilter: { organizationId: ORG_ID },
    })

    expect(root.children).toEqual([
      expect.objectContaining({
        key: '__all__',
        type: 'facebook-account',
        count: 5,
      }),
      expect.objectContaining({
        type: 'facebook-optimizer',
        label: 'Alice',
        count: 3,
        children: [
          expect.objectContaining({
            key: '11111111',
            label: 'Alpha',
            count: 2,
          }),
          expect.objectContaining({ key: '22222222', label: 'Beta', count: 2 }),
        ],
      }),
      expect.objectContaining({
        type: 'facebook-optimizer',
        label: 'Bob',
        count: 1,
        children: [
          expect.objectContaining({
            key: '33333333',
            label: 'Gamma',
            count: 1,
          }),
        ],
      }),
      expect.objectContaining({
        key: '__optimizer_unassigned__',
        type: 'facebook-optimizer',
        label: '未分配优化师',
        count: 1,
        children: [
          expect.objectContaining({
            key: '44444444',
            label: 'Delta',
            count: 1,
          }),
        ],
      }),
      expect.objectContaining({
        key: '__unassigned__',
        type: 'facebook-account',
        label: '未归属账户',
        count: 1,
      }),
    ])
    expect(accountQuery.select).toHaveBeenCalledWith(
      'accountId name operator status accountStatus disableReason',
    )
    expect(accountQuery.select).not.toHaveBeenCalledWith(
      expect.stringContaining('token'),
    )
  })

  it('keeps duplicate, disabled, unavailable, and unassigned groups visible with safe labels', async () => {
    const service = loadSmartGroupService()
    expect(service).toBeDefined()

    mockMaterialAggregate.mockResolvedValue([{
      global: [{ count: 5 }],
      accounts: [
        { _id: '11111111', count: 2 },
        { _id: '22222222', count: 1 },
        { _id: '33333333', count: 1 },
        { _id: '__unassigned__', count: 1 },
      ],
    }])
    const accountQuery = mockAccountQuery([
      { accountId: '11111111', name: 'Shared Shop', status: 'active', accountStatus: 1 },
      { accountId: '22222222', name: 'Shared Shop', status: 'disabled', accountStatus: 2 },
      // 33333333 intentionally unavailable in the request user's account scope.
    ])

    const [root] = await service.getFacebookMaterialSmartGroups({
      materialFilter: { organizationId: ORG_ID },
      accountFilter: { organizationId: ORG_ID },
    })

    expect(root.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: '__unassigned__',
          label: '未归属账户',
          count: 1,
        }),
        expect.objectContaining({
          key: '__optimizer_unassigned__',
          type: 'facebook-optimizer',
          label: '未分配优化师',
          count: 4,
        }),
      ]),
    )
    const unassignedOptimizer = root.children.find(
      (node: { key: string }) => node.key === '__optimizer_unassigned__',
    )
    expect(unassignedOptimizer.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: '11111111',
          label: 'Shared Shop · 1111',
          status: 'active',
        }),
        expect.objectContaining({
          key: '22222222',
          label: 'Shared Shop · 2222',
          status: 'disabled',
        }),
        expect.objectContaining({
          key: '33333333',
          label: 'Facebook 账户 · 3333',
          status: 'unavailable',
        }),
      ]),
    )
    expect(mockAccountFind).toHaveBeenCalledWith({
      $and: [
        { channel: 'facebook', accountId: { $in: expect.arrayContaining(['11111111', 'act_11111111']) } },
        { organizationId: ORG_ID },
      ],
    })
    expect(accountQuery.select).toHaveBeenCalledWith(
      'accountId name operator status accountStatus disableReason',
    )
    expect(accountQuery.select).not.toHaveBeenCalledWith(
      expect.stringContaining('token'),
    )
  })

  it('marks only Facebook-related materials without recoverable accounts as unassigned', () => {
    const service = loadSmartGroupService()
    expect(service).toBeDefined()

    const unassigned = service.buildFacebookSmartGroupFilter('__unassigned__')
    expect(unassigned.$expr.$and[0]).toEqual(service.buildFacebookRelatedExpression())
    expect(unassigned.$expr.$and[1]).toEqual({
      $eq: [{ $size: service.buildFacebookAccountIdsExpression() }, 0],
    })

    const all = service.buildFacebookSmartGroupFilter('__all__')
    expect(all).toEqual({ $expr: service.buildFacebookRelatedExpression() })
    expect(JSON.stringify(service.buildFacebookRelatedExpression())).toContain('source.platform')
    expect(JSON.stringify(service.buildFacebookRelatedExpression())).toContain('facebookMappings')
    expect(JSON.stringify(service.buildFacebookRelatedExpression())).toContain('usage.accounts')
  })

  it('applies a sanitized Facebook account smart-group filter to GET /materials without using folder', async () => {
    const service = loadSmartGroupService()
    expect(service).toBeDefined()
    const res = createResponse()

    await materialController.getMaterialList(createRequest({
      smartGroupType: 'facebook-account',
      smartGroupKey: '  act_1234  ',
    }), res as any)

    const filter = mockMaterialAggregate.mock.calls[0][0][0].$match
    expect(filter).toEqual({
      $and: [
        {
          $and: [
            { status: { $in: ['uploaded', 'ready'] } },
            { organizationId: expect.anything() },
          ],
        },
        service.buildFacebookSmartGroupFilter('1234'),
      ],
    })
    expect(JSON.stringify(filter)).not.toContain('folder')
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ list: [], total: 0 }),
    }))
  })

  it.each([
    ['__all__', 'all'],
    ['__unassigned__', 'unassigned'],
  ])('applies the exact %s Facebook membership condition to GET /materials', async (key, kind) => {
    const service = loadSmartGroupService()
    expect(service).toBeDefined()
    const res = createResponse()

    await materialController.getMaterialList(createRequest({
      smartGroupType: 'facebook-account',
      smartGroupKey: key,
    }), res as any)

    const filter = mockMaterialAggregate.mock.calls[0][0][0].$match
    const appliedSmartGroupFilter = filter.$and[1]
    if (kind === 'all') {
      expect(appliedSmartGroupFilter).toEqual({
        $expr: service.buildFacebookRelatedExpression(),
      })
    } else {
      expect(appliedSmartGroupFilter).toEqual({
        $expr: {
          $and: [
            service.buildFacebookRelatedExpression(),
            { $eq: [{ $size: service.buildFacebookAccountIdsExpression() }, 0] },
          ],
        },
      })
    }
    expect(JSON.stringify(filter)).not.toContain('folder')
  })

  it('returns the future-compatible root array and does not write a smart-group key to Material.folder', async () => {
    const service = loadSmartGroupService()
    expect(service).toBeDefined()
    mockMaterialAggregate.mockResolvedValue([{ global: [], accounts: [] }])
    mockAccountQuery([])
    const res = createResponse()

    expect((materialController as any).getMaterialSmartGroups).toEqual(expect.any(Function))
    await (materialController as any).getMaterialSmartGroups(createRequest(), res as any)

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [expect.objectContaining({ key: 'facebook', type: 'facebook-root' })],
    })
    const serialized = JSON.stringify((res.json as jest.Mock).mock.calls[0][0])
    expect(serialized).not.toMatch(/external-root|external-provider|external-package|广大大|外部优质素材/)
    expect(mockOriginAggregate).not.toHaveBeenCalled()
    expect(mockStateFindOne).not.toHaveBeenCalled()
    expect(mockMaterialFind).not.toHaveBeenCalled()
  })

  it('appends a restricted external/provider/package tree with unique material counts and safe labels', async () => {
    const service = loadSmartGroupService()
    expect(service).toBeDefined()
    expect(service.buildExternalSmartGroupPipeline).toEqual(expect.any(Function))

    const packageA = `pkg_${'a'.repeat(64)}`
    const packageB = `pkg_${'b'.repeat(64)}`
    mockMaterialAggregate.mockResolvedValue([{ global: [], accounts: [] }])
    mockAccountQuery([])
    mockOriginAggregate.mockResolvedValue([{
      global: [{ count: 3 }],
      packages: [
        {
          _id: packageB,
          productName: '  Same Name ',
          packageName: 'Same Name',
          count: 1,
        },
        {
          _id: packageA,
          productName: ' Product\u0000Name ',
          packageName: ' com.example.package ',
          count: 2,
        },
      ],
    }])
    mockStateLean.mockResolvedValue({ paused: false, pauseReason: 'must-not-leak' })
    const res = createResponse()

    await materialController.getMaterialSmartGroups(createRequest({}, {
      permissions: ['materials:external:read'],
    }), res as any)

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [
        expect.objectContaining({ key: 'facebook', type: 'facebook-root' }),
        {
          key: 'external',
          type: 'external-root',
          label: '外部优质素材',
          count: 3,
          children: [{
            key: 'guangdada',
            type: 'external-provider',
            label: '广大大',
            count: 3,
            paused: false,
            status: 'active',
            children: [
              {
                key: packageA,
                type: 'external-package',
                label: 'Product Name · com.example.package',
                count: 2,
              },
              {
                key: packageB,
                type: 'external-package',
                label: 'Same Name',
                count: 1,
              },
            ],
          }],
        },
      ],
    })
    expect(JSON.stringify((res.json as jest.Mock).mock.calls[0][0])).not.toMatch(
      /pauseReason|providerAssetKey|redis|job|run|config/i,
    )

    const pipeline = mockOriginAggregate.mock.calls[0][0]
    expect(pipeline[0]).toEqual({
      $match: {
        provider: 'guangdada',
        packageKey: { $regex: /^pkg_[a-f0-9]{64}$/ },
      },
    })
    expect(pipeline).toEqual(expect.arrayContaining([
      expect.objectContaining({
        $lookup: expect.objectContaining({
          from: 'materials',
          pipeline: expect.arrayContaining([
            {
              $match: {
                $expr: { $eq: ['$_id', '$$materialId'] },
                organizationId: { $in: [null] },
                status: { $in: ['uploaded', 'ready'] },
              },
            },
          ]),
        }),
      }),
    ]))
    const facet = pipeline.find((stage: any) => stage.$facet).$facet
    expect(facet.global).toEqual([
      { $group: { _id: '$materialId' } },
      { $count: 'count' },
    ])
    expect(facet.packages).toEqual([
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
    ])
    expect(JSON.stringify(pipeline)).not.toMatch(
      /providerAssetKey|\$addToSet|\$size/,
    )
  })

  it('returns only a safe paused boolean and status badge for the external provider', async () => {
    const packageKey = `pkg_${'c'.repeat(64)}`
    mockMaterialAggregate.mockResolvedValue([{ global: [], accounts: [] }])
    mockAccountQuery([])
    mockOriginAggregate.mockResolvedValue([{
      global: [{ count: 1 }],
      packages: [{
        _id: packageKey,
        productName: '',
        packageName: '',
        count: 1,
      }],
    }])
    mockStateLean.mockResolvedValue({
      paused: true,
      pauseReason: 'manual-secret-reason',
      recurringEnabled: false,
      backfillCursor: 'secret-cursor',
    })
    const res = createResponse()

    await materialController.getMaterialSmartGroups(createRequest({}, {
      permissions: ['materials:external:read'],
    }), res as any)

    const body = (res.json as jest.Mock).mock.calls[0][0]
    expect(body.data[1].children[0]).toEqual(expect.objectContaining({
      paused: true,
      status: 'paused',
      children: [expect.objectContaining({
        key: packageKey,
        label: '未识别产品',
      })],
    }))
    expect(JSON.stringify(body)).not.toMatch(
      /manual-secret|pauseReason|recurringEnabled|backfillCursor|secret-cursor/i,
    )
  })

  it.each([
    ['false', 'unit-test-provider-key', 'disabled'],
    ['true', '', 'unavailable'],
    ['true', 'unit-test-provider-key', 'active'],
  ])(
    'reports the external provider as %s/%s => %s',
    async (featureFlag, apiKey, expectedStatus) => {
      process.env.EXTERNAL_MATERIAL_SYNC_ENABLED = featureFlag
      process.env.GUANGDADA_API_KEY = apiKey
      const service = loadSmartGroupService()
      mockOriginAggregate.mockResolvedValue([{ global: [], packages: [] }])
      mockStateLean.mockResolvedValue({ paused: false })

      const groups = await service.getExternalMaterialSmartGroups()

      expect(groups[0].children[0]).toEqual(expect.objectContaining({
        status: expectedStatus,
      }))
    },
  )

  it('fails closed with a generic smart-group error when external provider state cannot be read', async () => {
    const sentinel = 'mongodb://private-host/state?credential=secret'
    mockMaterialAggregate.mockResolvedValue([{ global: [], accounts: [] }])
    mockAccountQuery([])
    mockOriginAggregate.mockResolvedValue([{ global: [], packages: [] }])
    mockStateLean.mockRejectedValueOnce(new Error(sentinel))
    const loggerSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger)
    const res = createResponse()

    try {
      await materialController.getMaterialSmartGroups(createRequest({}, {
        permissions: ['materials:external:read'],
      }), res as any)

      expect(res.status).toHaveBeenCalledWith(500)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: '获取素材智能分组失败，请稍后重试',
      })
      expect(JSON.stringify((res.json as jest.Mock).mock.calls[0][0])).not.toContain(sentinel)
      expect(loggerSpy).toHaveBeenCalledWith('[Material] Get smart groups failed')
      expect(JSON.stringify(loggerSpy.mock.calls)).not.toMatch(
        /mongodb:\/\/|private-host|credential|secret/i,
      )
    } finally {
      loggerSpy.mockRestore()
    }
  })

  it('logs smart-group failures without exposing infrastructure details to the caller', async () => {
    const sentinel = 'mongodb://internal-user:sentinel-secret@private-host/materials'
    const failure = new Error(sentinel)
    mockMaterialAggregate.mockRejectedValueOnce(failure)
    const loggerSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger)
    const res = createResponse()

    try {
      await (materialController as any).getMaterialSmartGroups(createRequest(), res as any)

      expect(loggerSpy).toHaveBeenCalledWith('[Material] Get smart groups failed')
      expect(JSON.stringify(loggerSpy.mock.calls)).not.toMatch(
        /mongodb:\/\/|internal-user|sentinel-secret|private-host/i,
      )
      expect(res.status).toHaveBeenCalledWith(500)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: '获取素材智能分组失败，请稍后重试',
      })
      expect(JSON.stringify((res.json as jest.Mock).mock.calls[0][0])).not.toContain(sentinel)
    } finally {
      loggerSpy.mockRestore()
    }
  })

  it('registers /smart-groups before dynamic material routes', () => {
    const routeSource = fs.readFileSync(
      path.resolve(__dirname, '../src/routes/material.routes.ts'),
      'utf8',
    )
    const smartGroupIndex = routeSource.indexOf("router.get('/smart-groups'")
    const dynamicIndex = routeSource.indexOf("router.get('/:id'")

    expect(smartGroupIndex).toBeGreaterThan(-1)
    expect(dynamicIndex).toBeGreaterThan(smartGroupIndex)
  })
})
