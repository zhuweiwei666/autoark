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
    'const authFetch = (...args) => globalThis.__materialSmartGroupsAuthFetch(...args)',
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

const jsonResponse = (data, status = 200) => new Response(
  JSON.stringify(data),
  { status, headers: { 'Content-Type': 'application/json' } },
)

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

  it('aborts a pending request without committing resolve or reject handlers', async () => {
    for (const outcome of ['resolve', 'reject']) {
      const runner = service.createLatestRequestRunner()
      const pending = deferred()
      const events = []
      let signal

      const run = runner.run(
        (requestSignal) => {
          signal = requestSignal
          return pending.promise
        },
        {
          onStart: () => events.push('start'),
          onSuccess: () => events.push('success'),
          onError: () => events.push('error'),
          onSettled: () => events.push('settled'),
        },
      )

      runner.abort()
      assert.equal(signal?.aborted, true)
      if (outcome === 'resolve') {
        pending.resolve('late')
      } else {
        pending.reject(new Error('late failure'))
      }
      await run

      assert.deepEqual(events, ['start'])
    }
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

  it('only commits the newest overlapping smart-group response and forwards abort signals', async () => {
    const first = deferred()
    const second = deferred()
    const requests = [first, second]
    const signals = []
    globalThis.__materialSmartGroupsAuthFetch = (_url, options) => {
      signals.push(options?.signal)
      return requests.shift().promise
    }

    const runner = service.createLatestRequestRunner()
    const state = { loading: false, data: [], error: false }
    const handlers = {
      onStart: () => {
        state.loading = true
        state.error = false
      },
      onSuccess: (value) => {
        state.data = value
      },
      onError: () => {
        state.data = []
        state.error = true
      },
      onSettled: () => {
        state.loading = false
      },
    }

    const firstRun = runner.run(
      (signal) => service.loadMaterialSmartGroups(signal),
      handlers,
    )
    const secondRun = runner.run(
      (signal) => service.loadMaterialSmartGroups(signal),
      handlers,
    )

    second.resolve(jsonResponse({
      success: true,
      data: [{ key: 'new', type: 'facebook-root', label: '新分组', count: 2 }],
    }))
    await secondRun
    first.resolve(jsonResponse({
      success: true,
      data: [{ key: 'old', type: 'facebook-root', label: '旧分组', count: 1 }],
    }))
    await firstRun

    assert.equal(signals[0]?.aborted, true)
    assert.equal(signals[1]?.aborted, false)
    assert.deepEqual(state, {
      loading: false,
      data: [{ key: 'new', type: 'facebook-root', label: '新分组', count: 2 }],
      error: false,
    })
  })

  it('only commits the newest overlapping external-status response and forwards abort signals', async () => {
    const first = deferred()
    const second = deferred()
    const requests = [first, second]
    const signals = []
    globalThis.__materialSmartGroupsAuthFetch = (_url, options) => {
      signals.push(options?.signal)
      return requests.shift().promise
    }

    const runner = service.createLatestRequestRunner()
    const state = { data: null, error: false }
    const handlers = {
      onStart: () => {
        state.error = false
      },
      onSuccess: (value) => {
        state.data = value
      },
      onError: () => {
        state.data = null
        state.error = true
      },
    }

    const firstRun = runner.run(
      (signal) => service.loadExternalMaterialStatus(signal),
      handlers,
    )
    const secondRun = runner.run(
      (signal) => service.loadExternalMaterialStatus(signal),
      handlers,
    )

    second.resolve(jsonResponse({
      success: true,
      data: {
        provider: 'guangdada',
        paused: true,
        pauseReason: 'manual',
        recurringEnabled: false,
        lastRun: null,
      },
    }))
    await secondRun
    first.resolve(jsonResponse({
      success: true,
      data: {
        provider: 'guangdada',
        paused: false,
        pauseReason: null,
        recurringEnabled: true,
        lastRun: null,
      },
    }))
    await firstRun

    assert.equal(signals[0]?.aborted, true)
    assert.equal(signals[1]?.aborted, false)
    assert.deepEqual(state, {
      data: {
        provider: 'guangdada',
        paused: true,
        pauseReason: 'manual',
        recurringEnabled: false,
        lastRun: null,
      },
      error: false,
    })
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

  it('maps a non-2xx disabled sync response to a clear operator message', async () => {
    const disabled = {
      provider: 'guangdada',
      mode: 'canary10',
      dryRun: false,
      request: { recentDays: 3, limit: 10 },
      status: 'disabled',
      enqueued: false,
    }

    await assert.rejects(
      service.readExternalMaterialSyncResponse(
        jsonResponse({ success: true, data: disabled }, 503),
      ),
      (error) => (
        error?.status === 503 &&
        error?.message === '外部素材同步未启用'
      ),
    )
    await assert.rejects(
      service.readExternalMaterialSyncResponse(
        jsonResponse({
          success: false,
          message: '外部素材同步当前不可用',
        }, 503),
      ),
      (error) => (
        error?.status === 503 &&
        error?.message === '外部素材同步当前不可用'
      ),
    )
    assert.equal(
      service.externalMaterialSyncFeedback(disabled, '立即同步 10 条素材'),
      '外部素材同步未启用',
    )
  })

  it('maps a non-2xx unavailable sync response to a fixed operator message', async () => {
    const unavailable = {
      provider: 'guangdada',
      mode: 'canary10',
      dryRun: false,
      request: { recentDays: 3, limit: 10 },
      status: 'unavailable',
      enqueued: false,
    }

    await assert.rejects(
      service.readExternalMaterialSyncResponse(
        jsonResponse({ success: true, data: unavailable }, 503),
      ),
      (error) => (
        error?.status === 503 &&
        error?.message === '外部素材同步服务暂不可用'
      ),
    )
    assert.equal(
      service.externalMaterialSyncFeedback(unavailable, '立即同步 10 条素材'),
      '外部素材同步服务暂不可用',
    )
  })
})
