import fs from 'fs'
import path from 'path'

const mockMaterialAggregate = jest.fn()
const mockMaterialFind = jest.fn()
const mockMaterialCountDocuments = jest.fn()
const mockAccountFind = jest.fn()

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

const ORG_ID = '665000000000000000000001'

const createRequest = (query: any = {}) => ({
  query,
  user: {
    userId: '665000000000000000000002',
    organizationId: ORG_ID,
    role: 'org_admin',
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

describe('Facebook material smart groups', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockMaterialFind.mockReturnValue(mockListQuery())
    mockMaterialCountDocuments.mockResolvedValue(0)
  })

  it('resolves raw visible material fixtures before grouping and counts A+B once globally', async () => {
    const service = loadSmartGroupService()
    expect(service).toBeDefined()

    expect(service.resolveFacebookMaterialMembership).toEqual(expect.any(Function))
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

    const visible = fixtures.filter(material => (
      material.organizationId === ORG_ID && ['uploaded', 'ready'].includes(material.status)
    ))
    const resolved = visible.map(material => ({
      id: material._id,
      ...service.resolveFacebookMaterialMembership(material),
    }))
    expect(resolved).toEqual([
      { id: 'mapping-a-b', facebookRelated: true, accountIds: ['1111', '2222'] },
      { id: 'source-fallback', facebookRelated: true, accountIds: ['3333'] },
      { id: 'usage-fallback', facebookRelated: true, accountIds: ['4444'] },
      { id: 'facebook-unassigned', facebookRelated: true, accountIds: [] },
      { id: 'manual-unrelated', facebookRelated: false, accountIds: [] },
    ])

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
    expect(roots[0].children).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: '__all__', count: 4 }),
      expect.objectContaining({ key: '__unassigned__', count: 1 }),
      expect.objectContaining({ key: '1111', count: 1 }),
      expect.objectContaining({ key: '2222', count: 1 }),
      expect.objectContaining({ key: '3333', count: 1 }),
      expect.objectContaining({ key: '4444', count: 1 }),
    ]))

    const pipeline = mockMaterialAggregate.mock.calls[0][0]
    expect(pipeline[0].$match).toEqual({
      $and: [
        { status: { $in: ['uploaded', 'ready'] } },
        { organizationId: ORG_ID },
      ],
    })
    const unwindStages = JSON.stringify(pipeline).match(/\"\$unwind\"/g) || []
    expect(unwindStages).toHaveLength(1)
    expect(pipeline[1].$project.accountIds).toEqual(service.buildFacebookAccountIdsExpression())
    expect(pipeline[1].$project.facebookRelated).toEqual(service.buildFacebookRelatedExpression())
    expect(pipeline[2].$facet.global).toContainEqual({ $count: 'count' })
  })

  it('uses mapping, then source, then usage precedence in both aggregation and list filters', () => {
    const service = loadSmartGroupService()
    expect(service).toBeDefined()

    const accountIdsExpression = service.buildFacebookAccountIdsExpression()
    expect(accountIdsExpression.$let.in).toEqual({
      $cond: [
        { $gt: [{ $size: '$$mappingAccountIds' }, 0] },
        '$$mappingAccountIds',
        {
          $cond: [
            { $gt: [{ $size: '$$sourceAccountIds' }, 0] },
            '$$sourceAccountIds',
            '$$usageAccountIds',
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

    expect(root.children).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: '__unassigned__', label: '未归属账户', count: 1 }),
      expect.objectContaining({ key: '11111111', label: 'Shared Shop · 1111', status: 'active' }),
      expect.objectContaining({ key: '22222222', label: 'Shared Shop · 2222', status: 'disabled' }),
      expect.objectContaining({ key: '33333333', label: 'Facebook 账户 · 3333', status: 'unavailable' }),
    ]))
    expect(mockAccountFind).toHaveBeenCalledWith({
      $and: [
        { channel: 'facebook', accountId: { $in: expect.arrayContaining(['11111111', 'act_11111111']) } },
        { organizationId: ORG_ID },
      ],
    })
    expect(accountQuery.select).toHaveBeenCalledWith('accountId name status accountStatus disableReason')
    expect(accountQuery.select).not.toHaveBeenCalledWith(expect.stringContaining('token'))
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

    const filter = mockMaterialFind.mock.calls[0][0]
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

    const filter = mockMaterialFind.mock.calls[0][0]
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
    expect(mockMaterialFind).not.toHaveBeenCalled()
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
