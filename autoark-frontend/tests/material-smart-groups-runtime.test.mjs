import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const serviceSource = fs
  .readFileSync(
    path.resolve(__dirname, '../src/services/materialSmartGroups.ts'),
    'utf8',
  )
  .replace(
    "import { authFetch } from './api'",
    'const authFetch = globalThis.__materialSmartGroupsAuthFetch',
  )
const transpiledService = ts.transpileModule(serviceSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText
const service = await import(
  `data:text/javascript;base64,${Buffer.from(transpiledService).toString('base64')}`
)

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('material smart groups runtime behavior', () => {
  it('only lets the newest overlapping material request commit and settle loading', async () => {
    const runner = service.createLatestRequestRunner()
    const first = deferred()
    const second = deferred()
    const events = []

    const firstRun = runner.run(
      () => first.promise,
      {
        onStart: () => events.push('first:start'),
        onSuccess: (value) => events.push(`first:success:${value}`),
        onSettled: () => events.push('first:settled'),
      },
    )
    const secondRun = runner.run(
      () => second.promise,
      {
        onStart: () => events.push('second:start'),
        onSuccess: (value) => events.push(`second:success:${value}`),
        onSettled: () => events.push('second:settled'),
      },
    )

    second.resolve('new')
    await secondRun
    first.resolve('old')
    await firstRun

    assert.deepEqual(events, [
      'first:start',
      'second:start',
      'second:success:new',
      'second:settled',
    ])
  })

  it('maps an origins 404 to a normal empty result while preserving 403', async () => {
    const missing = await service.readMaterialOriginsResponse(
      new Response(
        JSON.stringify({ success: false, error: '素材不可用' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    assert.deepEqual(missing, { origins: [], total: 0, hasMore: false })

    await assert.rejects(
      service.readMaterialOriginsResponse(
        new Response(
          JSON.stringify({ success: false, message: '权限不足' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
      (error) => error?.status === 403,
    )
  })

  it('accepts the backend 409 duplicate sync response as an idempotent result', async () => {
    const result = await service.readExternalMaterialSyncResponse(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            provider: 'guangdada',
            mode: 'canary10',
            dryRun: false,
            request: { recentDays: 3, limit: 10 },
            status: 'duplicate',
            enqueued: false,
          },
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    assert.equal(result.status, 'duplicate')
    assert.equal(result.enqueued, false)
    assert.equal(
      service.externalMaterialSyncFeedback(result, '立即同步 10 条素材'),
      '已有任务运行中',
    )
  })
})
