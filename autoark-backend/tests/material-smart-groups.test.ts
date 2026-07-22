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

  it('counts a material mapped to A+B once globally and once in each account group', async () => {
    const service = loadSmartGroupService()
    expect(service).toBeDefined()

    mockMaterialAggregate.mockResolvedValue([{
      global: [{ count: 1 }],
      accounts: [
        { _id: '1111', count: 1 },
        { _id: '2222', count: 1 },
      ],
    }])
    mockAccountQuery([
      { accountId: '1111', name: 'Alpha', status: 'active', accountStatus: 1 },
      { accountId: '2222', name: 'Beta', status: 'active', accountStatus: 1 },
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
      count: 1,
    })
    expect(roots[0].children).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: '__all__', count: 1 }),
      expect.objectContaining({ key: '1111', count: 1 }),
      expect.objectContaining({ key: '2222', count: 1 }),
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
            { $ne: ['$$sourceAccountId', ''] },
            ['$$sourceAccountId'],
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
