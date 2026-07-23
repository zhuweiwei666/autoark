/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'fs'
import path from 'path'
import express from 'express'
import request from 'supertest'

const mockMaterialAggregate = jest.fn()
const mockMaterialFind = jest.fn()
const mockMaterialCountDocuments = jest.fn()
const mockMaterialFindOne = jest.fn()
const mockOriginAggregate = jest.fn()
const mockAccountFind = jest.fn()
const mockStateLean = jest.fn()
const mockStateSelect = jest.fn(() => ({ lean: mockStateLean }))
const mockStateFindOne = jest.fn(() => ({ select: mockStateSelect }))

jest.mock('../src/models/Material', () => ({
  __esModule: true,
  default: {
    aggregate: mockMaterialAggregate,
    find: mockMaterialFind,
    findOne: mockMaterialFindOne,
    countDocuments: mockMaterialCountDocuments,
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

jest.mock('../src/middlewares/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    const role = req.get('x-test-role')
    if (role === 'super') {
      req.user = {
        userId: 'super-1',
        role: 'super_admin',
        permissions: [],
      }
    } else if (role === 'reader') {
      req.user = {
        userId: 'reader-1',
        organizationId: '665000000000000000000001',
        role: 'member',
        permissions: ['materials:external:read'],
      }
    } else {
      req.user = {
        userId: 'ordinary-1',
        organizationId: '665000000000000000000001',
        role: 'member',
        permissions: [],
      }
    }
    next()
  },
}))

const externalForbidden = { success: false, message: '权限不足' }
const placeholder = (_req: any, res: any) => res.json({ success: true })

jest.mock('../src/controllers/externalMaterial.controller', () => ({
  requireExternalMaterialRead: (req: any, res: any, next: any) => {
    if (
      req.user?.role !== 'super_admin' &&
      !req.user?.permissions?.includes('materials:external:read') &&
      !req.user?.permissions?.includes('materials:external:manage')
    ) {
      return res.status(403).json(externalForbidden)
    }
    return next()
  },
  requireExternalMaterialManage: (_req: any, _res: any, next: any) => next(),
  getGuangdadaExternalStatus: placeholder,
  syncGuangdadaExternal: placeholder,
  pauseGuangdadaExternal: placeholder,
  resumeGuangdadaExternal: placeholder,
}))

import materialRoutes from '../src/routes/material.routes'

const app = express()
app.use(express.json())
app.use('/api/materials', materialRoutes)

const VALID_MATERIAL_ID = '665000000000000000000010'
const PACKAGE_KEY = `pkg_${'a'.repeat(64)}`
const REUSED_MATERIAL_ID = '665000000000000000000011'

const listQuery = (rows: any[] = []) => {
  const query: any = {
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
    lean: jest.fn().mockResolvedValue(rows),
  }
  query.sort.mockReturnValue(query)
  query.skip.mockReturnValue(query)
  query.limit.mockReturnValue(query)
  return query
}

const materialOneQuery = (row: any) => {
  const query: any = {
    select: jest.fn(),
    lean: jest.fn().mockResolvedValue(row),
  }
  query.select.mockReturnValue(query)
  return query
}

const valueAtPath = (value: any, pathText: string): any => {
  if (!pathText) return value
  return pathText
    .split('.')
    .reduce((current, segment) => current?.[segment], value)
}

const evaluateMongoExpression = (
  expression: any,
  document: any,
  variables: Record<string, any> = {},
): any => {
  if (Array.isArray(expression)) {
    return expression.map((value) =>
      evaluateMongoExpression(value, document, variables),
    )
  }
  if (expression === null || typeof expression !== 'object') {
    if (typeof expression !== 'string' || !expression.startsWith('$'))
      return expression
    const reference = expression.slice(expression.startsWith('$$') ? 2 : 1)
    const [root, ...pathParts] = reference.split('.')
    const source = expression.startsWith('$$')
      ? variables[root]
      : document[root]
    return valueAtPath(source, pathParts.join('.'))
  }
  if ('$let' in expression) {
    const scoped = { ...variables }
    Object.entries(expression.$let.vars).forEach(([name, value]) => {
      scoped[name] = evaluateMongoExpression(value, document, variables)
    })
    return evaluateMongoExpression(expression.$let.in, document, scoped)
  }
  if ('$trim' in expression) {
    return String(
      evaluateMongoExpression(expression.$trim.input, document, variables) ??
        '',
    ).trim()
  }
  if ('$convert' in expression) {
    const value = evaluateMongoExpression(
      expression.$convert.input,
      document,
      variables,
    )
    if (value === null || value === undefined) {
      return evaluateMongoExpression(
        expression.$convert.onNull,
        document,
        variables,
      )
    }
    return String(value)
  }
  if ('$toLower' in expression) {
    return String(
      evaluateMongoExpression(expression.$toLower, document, variables),
    ).toLowerCase()
  }
  if ('$substrCP' in expression) {
    const [input, start, length] = expression.$substrCP.map((value: any) =>
      evaluateMongoExpression(value, document, variables),
    )
    return Array.from(String(input))
      .slice(start, start + length)
      .join('')
  }
  if ('$subtract' in expression) {
    const [left, right] = expression.$subtract.map((value: any) =>
      evaluateMongoExpression(value, document, variables),
    )
    return left - right
  }
  if ('$strLenCP' in expression) {
    return Array.from(
      String(
        evaluateMongoExpression(expression.$strLenCP, document, variables),
      ),
    ).length
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
  if ('$setUnion' in expression) {
    const values = expression.$setUnion.flatMap((value: any) =>
      evaluateMongoExpression(value, document, variables),
    )
    return [
      ...new Map(
        values.map((value: any) => [JSON.stringify(value), value]),
      ).values(),
    ]
  }
  if ('$map' in expression) {
    const input = evaluateMongoExpression(
      expression.$map.input,
      document,
      variables,
    )
    return input.map((value: any) =>
      evaluateMongoExpression(expression.$map.in, document, {
        ...variables,
        [expression.$map.as]: value,
      }),
    )
  }
  if ('$filter' in expression) {
    const input = evaluateMongoExpression(
      expression.$filter.input,
      document,
      variables,
    )
    return input.filter((value: any) =>
      evaluateMongoExpression(expression.$filter.cond, document, {
        ...variables,
        [expression.$filter.as]: value,
      }),
    )
  }
  if ('$cond' in expression) {
    const [condition, whenTrue, whenFalse] = expression.$cond
    return evaluateMongoExpression(condition, document, variables)
      ? evaluateMongoExpression(whenTrue, document, variables)
      : evaluateMongoExpression(whenFalse, document, variables)
  }
  for (const operator of ['$eq', '$ne', '$gt', '$in']) {
    if (operator in expression) {
      const [left, right] = expression[operator].map((value: any) =>
        evaluateMongoExpression(value, document, variables),
      )
      if (operator === '$eq') return left === right
      if (operator === '$ne') return left !== right
      if (operator === '$gt') return left > right
      return right.includes(left)
    }
  }
  if ('$and' in expression) {
    return expression.$and.every((value: any) =>
      evaluateMongoExpression(value, document, variables),
    )
  }
  if ('$or' in expression) {
    return expression.$or.some((value: any) =>
      evaluateMongoExpression(value, document, variables),
    )
  }
  if ('$not' in expression) {
    return !evaluateMongoExpression(expression.$not[0], document, variables)
  }
  return Object.fromEntries(
    Object.entries(expression).map(([key, value]) => [
      key,
      evaluateMongoExpression(value, document, variables),
    ]),
  )
}

describe('restricted external material queries and origin routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockMaterialFind.mockReturnValue(listQuery())
    mockMaterialCountDocuments.mockResolvedValue(0)
    mockMaterialAggregate.mockResolvedValue([{ data: [], total: [] }])
    mockMaterialFindOne.mockReturnValue(
      materialOneQuery({ _id: VALID_MATERIAL_ID }),
    )
    mockOriginAggregate.mockResolvedValue([{ data: [], total: [] }])
    mockStateLean.mockResolvedValue({ paused: false })
  })

  it('authorizes external-package queries before validation or database access', async () => {
    const response = await request(app)
      .get('/api/materials')
      .set('x-test-role', 'ordinary')
      .query({
        smartGroupType: 'external-package',
        smartGroupKey: PACKAGE_KEY,
      })

    expect(response.status).toBe(403)
    expect(response.body).toEqual(externalForbidden)
    expect(JSON.stringify(response.body)).not.toMatch(
      /external|guangdada|pkg_|count|material|https?:|config|redis|key/i,
    )
    expect(mockMaterialAggregate).not.toHaveBeenCalled()
    expect(mockMaterialFind).not.toHaveBeenCalled()
    expect(mockOriginAggregate).not.toHaveBeenCalled()
  })

  it.each([
    ['external-package', 'pkg_short'],
    ['external-package', `pkg_${'g'.repeat(64)}`],
    ['external-package', `${PACKAGE_KEY}extra`],
    ['unknown-group', PACKAGE_KEY],
    ['external-package', ''],
  ])(
    'strictly rejects invalid smart group type/key %s %s',
    async (smartGroupType, smartGroupKey) => {
      const response = await request(app)
        .get('/api/materials')
        .set('x-test-role', 'reader')
        .query({ smartGroupType, smartGroupKey })

      expect(response.status).toBe(400)
      expect(response.body).toEqual({
        success: false,
        error: '素材筛选参数无效',
      })
      expect(mockMaterialAggregate).not.toHaveBeenCalled()
      expect(mockOriginAggregate).not.toHaveBeenCalled()
    },
  )

  it('filters external package membership before one facet produces paged data and total', async () => {
    const row = {
      _id: REUSED_MATERIAL_ID,
      name: 'Reusable material',
      type: 'video',
      status: 'ready',
      storage: { url: 'https://cdn.example/reused.mp4' },
    }
    mockMaterialAggregate.mockResolvedValueOnce([
      {
        data: [row],
        total: [{ count: 1 }],
      },
    ])

    const response = await request(app)
      .get('/api/materials')
      .set('x-test-role', 'reader')
      .query({
        smartGroupType: 'external-package',
        smartGroupKey: PACKAGE_KEY,
        page: '99999999',
        pageSize: '999',
        search: 'Reusable',
        type: 'video',
        sortBy: 'name',
        sortOrder: 'asc',
      })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      success: true,
      data: {
        list: [row],
        total: 1,
        page: 10000,
        pageSize: 100,
        totalPages: 1,
      },
    })
    expect(mockMaterialFind).not.toHaveBeenCalled()
    expect(mockMaterialCountDocuments).not.toHaveBeenCalled()
    expect(mockOriginAggregate).not.toHaveBeenCalled()

    const pipeline = mockMaterialAggregate.mock.calls[0][0]
    const lookupIndex = pipeline.findIndex(
      (stage: any) => stage.$lookup?.as === '__externalPackageOrigins',
    )
    const membershipIndex = pipeline.findIndex(
      (stage: any) => stage.$match?.['__externalPackageOrigins.0'],
    )
    const facetIndex = pipeline.findIndex((stage: any) => stage.$facet)
    expect(lookupIndex).toBeGreaterThan(-1)
    expect(membershipIndex).toBeGreaterThan(lookupIndex)
    expect(facetIndex).toBeGreaterThan(membershipIndex)
    expect(pipeline.slice(0, facetIndex)).toEqual(
      expect.arrayContaining([
        {
          $match: expect.objectContaining({
            organizationId: { $in: [null] },
            status: { $in: ['uploaded', 'ready'] },
            type: 'video',
          }),
        },
        expect.objectContaining({
          $lookup: expect.objectContaining({
            from: 'materialoriginmappings',
            let: { materialId: '$_id' },
            pipeline: expect.arrayContaining([
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$materialId', '$$materialId'] },
                      { $eq: ['$provider', 'guangdada'] },
                      { $eq: ['$packageKey', PACKAGE_KEY] },
                    ],
                  },
                },
              },
              { $limit: 1 },
            ]),
          }),
        }),
      ]),
    )
    expect(
      pipeline
        .slice(0, facetIndex)
        .some(
          (stage: any) =>
            stage.$sort ||
            stage.$skip !== undefined ||
            stage.$limit !== undefined,
        ),
    ).toBe(false)
    expect(pipeline[facetIndex].$facet).toEqual({
      data: [
        { $sort: { name: 1, _id: 1 } },
        { $skip: 999900 },
        { $limit: 100 },
      ],
      total: [{ $count: 'count' }],
    })
    expect(JSON.stringify(pipeline)).not.toMatch(
      /\$in.*materialIds|providerAssetKey/,
    )
  })

  it('excludes external-only global records while retaining a Facebook-reused canonical', async () => {
    const facebookReused = {
      _id: REUSED_MATERIAL_ID,
      name: 'Facebook reusable',
      type: 'image',
      status: 'ready',
      source: {
        platform: 'guangdada',
        importedBy: 'external-material-sync',
      },
      facebookMappings: [{ accountId: '1234' }],
    }
    mockMaterialAggregate.mockResolvedValueOnce([
      {
        data: [facebookReused],
        total: [{ count: 1 }],
      },
    ])

    const response = await request(app)
      .get('/api/materials')
      .set('x-test-role', 'ordinary')

    expect(response.status).toBe(200)
    expect(response.body.data.list.map((row: any) => row._id)).toEqual([
      REUSED_MATERIAL_ID,
    ])
    const pipeline = mockMaterialAggregate.mock.calls[0][0]
    const originLookupIndex = pipeline.findIndex(
      (stage: any) => stage.$lookup?.as === '__externalOrigins',
    )
    expect(originLookupIndex).toBeGreaterThan(-1)
    const exclusion = pipeline[originLookupIndex + 1]
    expect(exclusion).toHaveProperty('$match.$expr')
    expect(JSON.stringify(exclusion)).toMatch(
      /__externalOrigins|source\.platform|source\.importedBy|facebookMappings|usage\.accounts/,
    )

    const externalOnly = {
      organizationId: null,
      source: {
        platform: 'guangdada',
        importedBy: 'external-material-sync',
      },
      facebookMappings: [],
      usage: { accounts: [] },
      __externalOrigins: [{ _id: 'origin-secret' }],
    }
    const reused = {
      ...externalOnly,
      facebookMappings: [{ accountId: '1234' }],
    }
    expect(evaluateMongoExpression(exclusion.$match.$expr, externalOnly)).toBe(
      false,
    )
    expect(evaluateMongoExpression(exclusion.$match.$expr, reused)).toBe(true)
    expect(JSON.stringify(response.body)).not.toContain('origin-secret')
  })

  it('returns the same fixed 403 for existing-looking and invalid origin IDs before queries', async () => {
    for (const id of [VALID_MATERIAL_ID, 'not-an-object-id']) {
      const response = await request(app)
        .get(`/api/materials/${id}/origins`)
        .set('x-test-role', 'ordinary')

      expect(response.status).toBe(403)
      expect(response.body).toEqual(externalForbidden)
      expect(JSON.stringify(response.body)).not.toMatch(
        /origin|guangdada|material|exists|invalid|id|https?:|count/i,
      )
    }
    expect(mockMaterialFindOne).not.toHaveBeenCalled()
    expect(mockOriginAggregate).not.toHaveBeenCalled()
  })

  it('returns a safe invalid-id response after authorization without a database lookup', async () => {
    const response = await request(app)
      .get('/api/materials/not-an-object-id/origins')
      .set('x-test-role', 'reader')

    expect(response.status).toBe(400)
    expect(response.body).toEqual({
      success: false,
      error: '请求无效',
    })
    expect(mockMaterialFindOne).not.toHaveBeenCalled()
    expect(mockOriginAggregate).not.toHaveBeenCalled()
  })

  it('only returns bounded safe origin summaries for an active global material', async () => {
    mockOriginAggregate.mockResolvedValueOnce([
      {
        data: [
          {
            provider: 'guangdada',
            packageName: ' com.example.app ',
            productName: ' Product\u0000Name ',
            advertiserName: ' Advertiser\u0007Name ',
            heat: 42.5,
            estimatedValue: Number.POSITIVE_INFINITY,
            firstSeenAt: new Date('2026-07-20T00:00:00.000Z'),
            lastSeenAt: new Date('2026-07-22T00:00:00.000Z'),
            mediaType: 'video',
            sourcePageUrl:
              'https://user:pass@example.com/path/to/ad?token=secret#private',
            providerAssetKey: 'provider-secret-key',
            lastMediaUrl: 'https://cdn.example/private.mp4?sig=secret',
            metadata: { raw: 'must-not-leak' },
          },
        ],
        total: [{ count: 2 }],
      },
    ])

    const response = await request(app)
      .get(`/api/materials/${VALID_MATERIAL_ID}/origins`)
      .set('x-test-role', 'reader')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      success: true,
      data: {
        origins: [
          {
            provider: '广大大',
            label: 'Product Name · com.example.app',
            advertiser: 'Advertiser Name',
            heat: 42.5,
            firstSeenAt: '2026-07-20T00:00:00.000Z',
            lastSeenAt: '2026-07-22T00:00:00.000Z',
            mediaType: 'video',
            sourcePageUrl: 'https://example.com/path/to/ad',
          },
        ],
        total: 2,
        hasMore: true,
      },
    })
    expect(mockMaterialFindOne).toHaveBeenCalledWith({
      _id: expect.anything(),
      organizationId: { $in: [null] },
      status: { $in: ['uploaded', 'ready'] },
    })
    const materialQuery = mockMaterialFindOne.mock.results[0].value
    expect(materialQuery.select).toHaveBeenCalledWith('_id')

    const pipeline = mockOriginAggregate.mock.calls[0][0]
    expect(pipeline[0].$match).toEqual({
      materialId: expect.anything(),
      provider: 'guangdada',
    })
    expect(pipeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          $group: expect.objectContaining({
            _id: '$providerAssetKey',
            origin: { $first: '$$ROOT' },
          }),
        }),
        expect.objectContaining({
          $facet: expect.objectContaining({
            data: expect.arrayContaining([
              { $limit: expect.any(Number) },
              expect.objectContaining({
                $project: expect.objectContaining({
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
                }),
              }),
            ]),
            total: [{ $count: 'count' }],
          }),
        }),
      ]),
    )
    const serialized = JSON.stringify(response.body)
    expect(serialized).not.toMatch(
      /provider-secret|lastMediaUrl|metadata|estimatedValue|token=|#private|user:pass|cdn\.example|mediaRole|mediaIndex/i,
    )
  })

  it('returns 404 without querying origins when the global active material is unavailable', async () => {
    mockMaterialFindOne.mockReturnValueOnce(materialOneQuery(null))

    const response = await request(app)
      .get(`/api/materials/${VALID_MATERIAL_ID}/origins`)
      .set('x-test-role', 'super')

    expect(response.status).toBe(404)
    expect(response.body).toEqual({
      success: false,
      error: '素材不可用',
    })
    expect(mockOriginAggregate).not.toHaveBeenCalled()
  })

  it('sanitizes material-list and origin database failures', async () => {
    const sentinel =
      'mongodb://user:secret@private-host/materials?api_key=unsafe'
    mockMaterialAggregate.mockRejectedValueOnce(new Error(sentinel))
    const listResponse = await request(app)
      .get('/api/materials')
      .set('x-test-role', 'ordinary')

    expect(listResponse.status).toBe(500)
    expect(listResponse.body).toEqual({
      success: false,
      error: '获取素材列表失败，请稍后重试',
    })
    expect(JSON.stringify(listResponse.body)).not.toContain(sentinel)

    mockOriginAggregate.mockRejectedValueOnce(new Error(sentinel))
    const originsResponse = await request(app)
      .get(`/api/materials/${VALID_MATERIAL_ID}/origins`)
      .set('x-test-role', 'reader')

    expect(originsResponse.status).toBe(500)
    expect(originsResponse.body).toEqual({
      success: false,
      error: '获取素材来源失败，请稍后重试',
    })
    expect(JSON.stringify(originsResponse.body)).not.toContain(sentinel)
  })

  it('registers external controls and origins before the dynamic GET route', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../src/routes/material.routes.ts'),
      'utf8',
    )
    const dynamicIndex = source.indexOf("router.get('/:id'")
    const originsIndex = source.indexOf("'/:id/origins'")

    expect(originsIndex).toBeGreaterThan(-1)
    expect(originsIndex).toBeLessThan(dynamicIndex)
    for (const route of [
      '/external/guangdada/status',
      '/external/guangdada/sync',
      '/external/guangdada/pause',
      '/external/guangdada/resume',
    ]) {
      expect(source.indexOf(route)).toBeGreaterThan(-1)
      expect(source.indexOf(route)).toBeLessThan(dynamicIndex)
    }
  })
})
