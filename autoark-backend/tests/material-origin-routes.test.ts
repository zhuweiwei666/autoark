/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'fs'
import path from 'path'
import { randomBytes } from 'crypto'
import express from 'express'
import request from 'supertest'
import { Db, MongoClient, ObjectId } from 'mongodb'

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
import logger from '../src/utils/logger'
import { buildMaterialPagePipeline } from '../src/services/materialQuery.service'
import { buildExternalSmartGroupPipeline } from '../src/services/materialSmartGroup.service'

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

const comparableMongoValue = (value: any): any => {
  if (value?.toHexString instanceof Function) return value.toHexString()
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(comparableMongoValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        comparableMongoValue(child),
      ]),
    )
  }
  return value
}

const mongoValuesEqual = (left: any, right: any): boolean =>
  JSON.stringify(comparableMongoValue(left)) ===
  JSON.stringify(comparableMongoValue(right))

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
  if ('$setIntersection' in expression) {
    const [left, right] = expression.$setIntersection.map((value: any) =>
      evaluateMongoExpression(value, document, variables),
    )
    return left.filter((value: any) =>
      right.some((candidate: any) => mongoValuesEqual(value, candidate)),
    )
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
      if (operator === '$eq') return mongoValuesEqual(left, right)
      if (operator === '$ne') return !mongoValuesEqual(left, right)
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

const matchesFixtureFilter = (
  document: any,
  filter: any,
  variables: Record<string, any> = {},
): boolean =>
  Object.entries(filter).every(([pathText, expected]: [string, any]) => {
    if (pathText === '$and') {
      return expected.every((part: any) =>
        matchesFixtureFilter(document, part, variables),
      )
    }
    if (pathText === '$or') {
      return expected.some((part: any) =>
        matchesFixtureFilter(document, part, variables),
      )
    }
    if (pathText === '$expr') {
      return Boolean(evaluateMongoExpression(expected, document, variables))
    }

    const actual = valueAtPath(document, pathText)
    if (expected instanceof RegExp) {
      return expected.test(String(actual ?? ''))
    }
    if (expected?.toHexString instanceof Function) {
      return mongoValuesEqual(actual, expected)
    }
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      return Object.entries(expected).every(
        ([operator, operand]: [string, any]) => {
          if (operator === '$exists') return (actual !== undefined) === operand
          if (operator === '$in') {
            const values = actual === undefined ? [null] : [actual].flat()
            return values.some((value) =>
              operand.some((candidate: any) =>
                mongoValuesEqual(value, candidate),
              ),
            )
          }
          if (operator === '$ne') return !mongoValuesEqual(actual, operand)
          if (operator === '$eq') return mongoValuesEqual(actual, operand)
          if (operator === '$regex') {
            const pattern =
              operand instanceof RegExp
                ? operand
                : new RegExp(String(operand), expected.$options || '')
            return pattern.test(String(actual ?? ''))
          }
          if (operator === '$options') return true
          throw new Error(`Unsupported fixture match operator: ${operator}`)
        },
      )
    }
    return mongoValuesEqual(actual, expected)
  })

const fixtureProject = (
  document: any,
  specification: Record<string, any>,
  variables: Record<string, any>,
): any => {
  const entries = Object.entries(specification)
  const inclusion = entries.some(([, value]) => value !== 0)
  if (!inclusion) {
    const projected = { ...document }
    for (const [pathText] of entries) delete projected[pathText]
    return projected
  }

  const projected: Record<string, any> = {}
  if (specification._id !== 0 && document._id !== undefined) {
    projected._id = document._id
  }
  for (const [field, expression] of entries) {
    if (field === '_id') continue
    if (expression === 1) {
      if (document[field] !== undefined) projected[field] = document[field]
    } else if (expression !== 0) {
      projected[field] = evaluateMongoExpression(
        expression,
        document,
        variables,
      )
    }
  }
  return projected
}

const compareFixtureValues = (left: any, right: any): number => {
  const a = comparableMongoValue(left)
  const b = comparableMongoValue(right)
  if (a === b) return 0
  if (a === undefined || a === null) return -1
  if (b === undefined || b === null) return 1
  return a < b ? -1 : 1
}

const executeFixturePipeline = (
  input: any[],
  pipeline: any[],
  collections: Record<string, any[]>,
  variables: Record<string, any> = {},
): any[] => {
  let documents = [...input]
  for (const stage of pipeline) {
    if (stage.$match) {
      documents = documents.filter((document) =>
        matchesFixtureFilter(document, stage.$match, variables),
      )
    } else if (stage.$lookup) {
      documents = documents.map((document) => {
        const lookupVariables = Object.fromEntries(
          Object.entries(stage.$lookup.let || {}).map(([name, expression]) => [
            name,
            evaluateMongoExpression(expression, document, variables),
          ]),
        )
        return {
          ...document,
          [stage.$lookup.as]: executeFixturePipeline(
            collections[stage.$lookup.from] || [],
            stage.$lookup.pipeline || [],
            collections,
            { ...variables, ...lookupVariables },
          ),
        }
      })
    } else if (stage.$unwind) {
      const pathText = String(
        typeof stage.$unwind === 'string' ? stage.$unwind : stage.$unwind.path,
      ).replace(/^\$/, '')
      documents = documents.flatMap((document) => {
        const values = valueAtPath(document, pathText)
        return Array.isArray(values)
          ? values.map((value) => ({ ...document, [pathText]: value }))
          : []
      })
    } else if (stage.$group) {
      const groups: Array<{ key: any; rows: any[] }> = []
      for (const document of documents) {
        const key = evaluateMongoExpression(
          stage.$group._id,
          document,
          variables,
        )
        let group = groups.find((candidate) =>
          mongoValuesEqual(candidate.key, key),
        )
        if (!group) {
          group = { key, rows: [] }
          groups.push(group)
        }
        group.rows.push(document)
      }
      documents = groups.map(({ key, rows }) => {
        const grouped: Record<string, any> = { _id: key }
        for (const [field, accumulator] of Object.entries(stage.$group)) {
          if (field === '_id') continue
          const [operator, expression] = Object.entries(
            accumulator as Record<string, any>,
          )[0]
          const values = rows.map((row) =>
            expression === '$$ROOT'
              ? row
              : evaluateMongoExpression(expression, row, variables),
          )
          if (operator === '$addToSet') {
            grouped[field] = values.filter(
              (value, index) =>
                values.findIndex((candidate) =>
                  mongoValuesEqual(candidate, value),
                ) === index,
            )
          } else if (operator === '$max') {
            grouped[field] = values.reduce((maximum, value) =>
              compareFixtureValues(value, maximum) > 0 ? value : maximum,
            )
          } else if (operator === '$sum') {
            grouped[field] = values.reduce(
              (sum, value) => sum + Number(value),
              0,
            )
          } else if (operator === '$first') {
            grouped[field] = values[0]
          } else {
            throw new Error(`Unsupported fixture group operator: ${operator}`)
          }
        }
        return grouped
      })
    } else if (stage.$project) {
      documents = documents.map((document) =>
        fixtureProject(document, stage.$project, variables),
      )
    } else if (stage.$sort) {
      const sort = Object.entries(stage.$sort) as Array<[string, number]>
      documents.sort((left, right) => {
        for (const [pathText, direction] of sort) {
          const compared = compareFixtureValues(
            valueAtPath(left, pathText),
            valueAtPath(right, pathText),
          )
          if (compared !== 0) return compared * direction
        }
        return 0
      })
    } else if (stage.$skip !== undefined) {
      documents = documents.slice(stage.$skip)
    } else if (stage.$limit !== undefined) {
      documents = documents.slice(0, stage.$limit)
    } else if (stage.$count) {
      documents =
        documents.length > 0 ? [{ [stage.$count]: documents.length }] : []
    } else if (stage.$facet) {
      const source = [...documents]
      documents = [
        Object.fromEntries(
          Object.entries(stage.$facet).map(([name, facetPipeline]) => [
            name,
            executeFixturePipeline(
              source,
              facetPipeline as any[],
              collections,
              variables,
            ),
          ]),
        ),
      ]
    } else if (stage.$replaceRoot) {
      documents = documents.map((document) =>
        evaluateMongoExpression(
          stage.$replaceRoot.newRoot,
          document,
          variables,
        ),
      )
    } else {
      throw new Error(
        `Unsupported fixture pipeline stage: ${Object.keys(stage)[0]}`,
      )
    }
  }
  return documents
}

const FIXTURE_MATERIAL_COLLECTION = 'fixture_materials'
const FIXTURE_ORIGIN_COLLECTION = 'fixture_material_origins'
const SECOND_PACKAGE_KEY = `pkg_${'b'.repeat(64)}`
const fixtureIds = {
  externalAlpha: new ObjectId('665000000000000000000101'),
  externalBeta: new ObjectId('665000000000000000000102'),
  externalImage: new ObjectId('665000000000000000000103'),
  externalOtherPackage: new ObjectId('665000000000000000000104'),
  facebookReused: new ObjectId('665000000000000000000105'),
  normal: new ObjectId('665000000000000000000106'),
  inactive: new ObjectId('665000000000000000000107'),
  private: new ObjectId('665000000000000000000108'),
  invalidPackage: new ObjectId('665000000000000000000109'),
}

const externalSource = {
  platform: 'guangdada',
  importedBy: 'external-material-sync',
}

const fixtureMaterials = [
  {
    _id: fixtureIds.externalAlpha,
    name: 'Alpha',
    organizationId: null,
    status: 'ready',
    type: 'video',
    source: externalSource,
  },
  {
    _id: fixtureIds.externalBeta,
    name: 'Beta',
    organizationId: null,
    status: 'uploaded',
    type: 'video',
    source: externalSource,
  },
  {
    _id: fixtureIds.externalImage,
    name: 'Delta image',
    organizationId: null,
    status: 'ready',
    type: 'image',
    source: externalSource,
  },
  {
    _id: fixtureIds.externalOtherPackage,
    name: 'Other package',
    organizationId: null,
    status: 'ready',
    type: 'video',
    source: externalSource,
  },
  {
    _id: fixtureIds.facebookReused,
    name: 'Gamma',
    organizationId: null,
    status: 'ready',
    type: 'video',
    source: externalSource,
    facebookMappings: [{ accountId: '1234' }],
  },
  {
    _id: fixtureIds.normal,
    name: 'Normal upload',
    organizationId: null,
    status: 'ready',
    type: 'video',
    source: { platform: 'upload' },
  },
  {
    _id: fixtureIds.inactive,
    name: 'Inactive external',
    organizationId: null,
    status: 'processing',
    type: 'video',
    source: externalSource,
  },
  {
    _id: fixtureIds.private,
    name: 'Private external',
    organizationId: new ObjectId('665000000000000000000999'),
    status: 'ready',
    type: 'video',
    source: externalSource,
  },
  {
    _id: fixtureIds.invalidPackage,
    name: 'Invalid package',
    organizationId: null,
    status: 'ready',
    type: 'video',
    source: externalSource,
  },
]

const fixtureOrigins = [
  {
    _id: new ObjectId('665000000000000000000201'),
    materialId: fixtureIds.externalAlpha,
    provider: 'guangdada',
    providerAssetKey: 'alpha-1',
    packageKey: PACKAGE_KEY,
    packageName: 'com.example.one',
    productName: 'Example One',
  },
  {
    _id: new ObjectId('665000000000000000000202'),
    materialId: fixtureIds.externalAlpha,
    provider: 'guangdada',
    providerAssetKey: 'alpha-2',
    packageKey: PACKAGE_KEY,
    packageName: 'com.example.one',
    productName: 'Example One',
  },
  {
    _id: new ObjectId('665000000000000000000203'),
    materialId: fixtureIds.externalBeta,
    provider: 'guangdada',
    providerAssetKey: 'beta-1',
    packageKey: PACKAGE_KEY,
    packageName: 'com.example.one',
    productName: 'Example One',
  },
  {
    _id: new ObjectId('665000000000000000000204'),
    materialId: fixtureIds.externalImage,
    provider: 'guangdada',
    providerAssetKey: 'image-1',
    packageKey: PACKAGE_KEY,
    packageName: 'com.example.one',
    productName: 'Example One',
  },
  {
    _id: new ObjectId('665000000000000000000205'),
    materialId: fixtureIds.externalOtherPackage,
    provider: 'guangdada',
    providerAssetKey: 'other-1',
    packageKey: SECOND_PACKAGE_KEY,
    packageName: 'com.example.two',
    productName: 'Example Two',
  },
  {
    _id: new ObjectId('665000000000000000000206'),
    materialId: fixtureIds.facebookReused,
    provider: 'guangdada',
    providerAssetKey: 'reused-1',
    packageKey: PACKAGE_KEY,
    packageName: 'com.example.one',
    productName: 'Example One',
  },
  {
    _id: new ObjectId('665000000000000000000207'),
    materialId: fixtureIds.inactive,
    provider: 'guangdada',
    providerAssetKey: 'inactive-1',
    packageKey: PACKAGE_KEY,
  },
  {
    _id: new ObjectId('665000000000000000000208'),
    materialId: fixtureIds.private,
    provider: 'guangdada',
    providerAssetKey: 'private-1',
    packageKey: PACKAGE_KEY,
  },
  {
    _id: new ObjectId('665000000000000000000209'),
    materialId: fixtureIds.invalidPackage,
    provider: 'guangdada',
    providerAssetKey: 'invalid-1',
    packageKey: 'pkg_invalid',
  },
]

const externalPageQuery = {
  filter: {
    organizationId: { $in: [null] },
    status: { $in: ['uploaded', 'ready'] },
    type: 'video',
    $or: [{ name: { $regex: /a/i } }],
  },
  sort: { name: 1, _id: 1 } as const,
  skip: 1,
  pageSize: 1,
  externalPackageKey: PACKAGE_KEY,
}

describe('production material aggregation pipeline semantics', () => {
  it('counts unique active global materials for valid package groups only', () => {
    const pipeline = buildExternalSmartGroupPipeline({
      materialCollectionName: FIXTURE_MATERIAL_COLLECTION,
    })
    const [result] = executeFixturePipeline(fixtureOrigins, pipeline, {
      [FIXTURE_MATERIAL_COLLECTION]: fixtureMaterials,
    })

    expect(result.global).toEqual([{ count: 5 }])
    expect(result.packages).toEqual([
      expect.objectContaining({ _id: PACKAGE_KEY, count: 4 }),
      expect.objectContaining({ _id: SECOND_PACKAGE_KEY, count: 1 }),
    ])
    expect(result.packages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ _id: 'pkg_invalid' })]),
    )
  })

  it('applies package, search, type, sort, page, and total through the production page pipeline', () => {
    const pipeline = buildMaterialPagePipeline({
      ...externalPageQuery,
      originCollectionName: FIXTURE_ORIGIN_COLLECTION,
    })
    const [result] = executeFixturePipeline(fixtureMaterials, pipeline, {
      [FIXTURE_ORIGIN_COLLECTION]: fixtureOrigins,
    })

    expect(result.data.map((row: any) => row._id)).toEqual([
      fixtureIds.externalBeta,
    ])
    expect(result.total).toEqual([{ count: 3 }])
  })

  it.each([
    [
      'organization',
      {
        $and: [
          { status: { $in: ['uploaded', 'ready'] } },
          {
            organizationId: new ObjectId('665000000000000000000301'),
          },
        ],
      },
    ],
    [
      'owner',
      {
        $and: [
          { status: { $in: ['uploaded', 'ready'] } },
          { createdBy: { $in: ['tenant-user'] } },
        ],
      },
    ],
  ])(
    'skips external-origin relationship isolation for an explicit %s scope',
    (_scope, filter) => {
      const pipeline = buildMaterialPagePipeline({
        filter,
        sort: { createdAt: -1, _id: -1 },
        skip: 0,
        pageSize: 20,
        excludeExternalOnly: true,
        originCollectionName: FIXTURE_ORIGIN_COLLECTION,
      })

      expect(
        pipeline.some(
          (stage: any) => stage.$lookup?.as === '__externalOrigins',
        ),
      ).toBe(false)
      expect(pipeline).toEqual([
        { $match: filter },
        expect.objectContaining({ $facet: expect.any(Object) }),
      ])
    },
  )

  it('keeps external-only isolation for a synthetic global filter without external read', () => {
    const pipeline = buildMaterialPagePipeline({
      filter: {
        $and: [
          { status: { $in: ['uploaded', 'ready'] }, type: 'video' },
          {
            $or: [
              {
                organizationId: new ObjectId('665000000000000000000302'),
              },
              { organizationId: { $in: [null] } },
            ],
          },
        ],
      },
      sort: { name: 1, _id: 1 },
      skip: 0,
      pageSize: 20,
      excludeExternalOnly: true,
      originCollectionName: FIXTURE_ORIGIN_COLLECTION,
    })
    const [result] = executeFixturePipeline(fixtureMaterials, pipeline, {
      [FIXTURE_ORIGIN_COLLECTION]: fixtureOrigins,
    })

    expect(result.data.map((row: any) => row._id)).toEqual([
      fixtureIds.facebookReused,
      fixtureIds.normal,
    ])
    expect(result.total).toEqual([{ count: 2 }])
  })
})

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

  it.each([
    ['default', {}],
    ['search', { search: 'Tenant' }],
    ['folder', { folder: '665000000000000000000401' }],
  ])(
    'keeps the ordinary tenant %s list contract without an origin lookup',
    async (_case, query) => {
      const tenantMaterial = {
        _id: REUSED_MATERIAL_ID,
        name: 'Tenant material',
        type: 'image',
        status: 'ready',
      }
      mockMaterialAggregate.mockResolvedValueOnce([
        {
          data: [tenantMaterial],
          total: [{ count: 1 }],
        },
      ])

      const response = await request(app)
        .get('/api/materials')
        .set('x-test-role', 'ordinary')
        .query(query)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        success: true,
        data: {
          list: [tenantMaterial],
          total: 1,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        },
      })
      const pipeline = mockMaterialAggregate.mock.calls[0][0]
      const facetIndex = pipeline.findIndex((stage: any) => stage.$facet)
      expect(facetIndex).toBeGreaterThan(0)
      expect(
        pipeline
          .slice(0, facetIndex)
          .some((stage: any) => stage.$lookup?.as === '__externalOrigins'),
      ).toBe(false)
      expect(pipeline[facetIndex].$facet).toEqual({
        data: [
          { $sort: { createdAt: -1, _id: -1 } },
          { $skip: 0 },
          { $limit: 20 },
        ],
        total: [{ $count: 'count' }],
      })
    },
  )

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

  it.each(['unknown', 'deleted', 'private'])(
    'returns the same 404 without querying origins for an unavailable %s material',
    async () => {
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
      expect(JSON.stringify(response.body)).not.toContain(VALID_MATERIAL_ID)
    },
  )

  it('returns the same 404 for an active global material with no origins', async () => {
    mockOriginAggregate.mockResolvedValueOnce([{ data: [], total: [] }])

    const response = await request(app)
      .get(`/api/materials/${VALID_MATERIAL_ID}/origins`)
      .set('x-test-role', 'reader')

    expect(response.status).toBe(404)
    expect(response.body).toEqual({
      success: false,
      error: '素材不可用',
    })
    expect(mockMaterialFindOne).toHaveBeenCalledTimes(1)
    expect(mockOriginAggregate).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(response.body)).not.toMatch(
      new RegExp(`${VALID_MATERIAL_ID}|origin|exists|deleted|private`, 'i'),
    )
  })

  it('sanitizes material-list and origin database failures', async () => {
    const sentinel =
      'mongodb://user:secret@private-host/materials?api_key=unsafe'
    const failure = Object.assign(new Error(sentinel), {
      cause: new Error('mongodb://cause-user:cause-secret@private-host'),
      query: { uri: sentinel },
    })
    const loggerSpy = jest
      .spyOn(logger, 'error')
      .mockImplementation(() => logger)

    try {
      mockMaterialAggregate.mockRejectedValueOnce(failure)
      const listResponse = await request(app)
        .get('/api/materials')
        .set('x-test-role', 'ordinary')

      expect(listResponse.status).toBe(500)
      expect(listResponse.body).toEqual({
        success: false,
        error: '获取素材列表失败，请稍后重试',
      })
      expect(JSON.stringify(listResponse.body)).not.toContain(sentinel)

      mockMaterialAggregate.mockRejectedValueOnce(failure)
      const externalListResponse = await request(app)
        .get('/api/materials')
        .set('x-test-role', 'reader')
        .query({
          smartGroupType: 'external-package',
          smartGroupKey: PACKAGE_KEY,
        })

      expect(externalListResponse.status).toBe(500)
      expect(externalListResponse.body).toEqual({
        success: false,
        error: '获取素材列表失败，请稍后重试',
      })
      expect(JSON.stringify(externalListResponse.body)).not.toContain(sentinel)

      mockOriginAggregate.mockRejectedValueOnce(failure)
      const originsResponse = await request(app)
        .get(`/api/materials/${VALID_MATERIAL_ID}/origins`)
        .set('x-test-role', 'reader')

      expect(originsResponse.status).toBe(500)
      expect(originsResponse.body).toEqual({
        success: false,
        error: '获取素材来源失败，请稍后重试',
      })
      expect(JSON.stringify(originsResponse.body)).not.toContain(sentinel)
      expect(loggerSpy.mock.calls).toEqual([
        ['[Material] Get list failed'],
        ['[Material] Get list failed'],
        ['[Material] Get origins failed'],
      ])
      expect(JSON.stringify(loggerSpy.mock.calls)).not.toMatch(
        /mongodb:\/\/|user:secret|cause-user|private-host|api_key|unsafe/i,
      )
    } finally {
      loggerSpy.mockRestore()
    }
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

const runMongoIntegration =
  process.env.RUN_MATERIAL_MONGO_INTEGRATION === '1' &&
  Boolean(process.env.TEST_MONGO_URI)
const describeMongoIntegration = runMongoIntegration ? describe : describe.skip

describeMongoIntegration(
  'material aggregation Mongo integration (double gated)',
  () => {
    jest.setTimeout(30_000)

    const namespace = randomBytes(12).toString('hex')
    const databaseName = `autoark_task8_${namespace}`
    const materialCollectionName = `materials_${namespace}`
    const originCollectionName = `origins_${namespace}`
    let client: MongoClient | undefined
    let database: Db | undefined

    beforeAll(async () => {
      try {
        client = new MongoClient(process.env.TEST_MONGO_URI as string, {
          serverSelectionTimeoutMS: 10_000,
        })
        await client.connect()
        database = client.db(databaseName)
        await database
          .collection(materialCollectionName)
          .insertMany(fixtureMaterials)
        await database
          .collection(originCollectionName)
          .insertMany(fixtureOrigins)
      } catch {
        throw new Error('Material Mongo integration setup failed')
      }
    })

    afterAll(async () => {
      if (database) await database.dropDatabase()
      if (client) await client.close()
    })

    it('executes the production smart-group and page pipelines against isolated collections', async () => {
      const smartGroups = await database!
        .collection(originCollectionName)
        .aggregate(buildExternalSmartGroupPipeline({ materialCollectionName }))
        .toArray()
      expect(smartGroups[0].global).toEqual([{ count: 5 }])
      expect(smartGroups[0].packages).toEqual([
        expect.objectContaining({ _id: PACKAGE_KEY, count: 4 }),
        expect.objectContaining({ _id: SECOND_PACKAGE_KEY, count: 1 }),
      ])

      const page = await database!
        .collection(materialCollectionName)
        .aggregate(
          buildMaterialPagePipeline({
            ...externalPageQuery,
            originCollectionName,
          }),
        )
        .toArray()
      expect(page[0].data.map((row: any) => row._id)).toEqual([
        fixtureIds.externalBeta,
      ])
      expect(page[0].total).toEqual([{ count: 3 }])
    })
  },
)
