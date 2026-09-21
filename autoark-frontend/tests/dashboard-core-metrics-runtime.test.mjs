import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import ts from 'typescript'

// 直接把 src/services/api.ts 转译后在 Node 里执行，覆盖真实的数据判定逻辑。
const apiSource = readFileSync(
  new URL('../src/services/api.ts', import.meta.url),
  'utf8',
).replace(/import\.meta\.env/g, 'globalThis.__dashboardTestEnv')

globalThis.__dashboardTestEnv = { VITE_API_BASE_URL: 'http://dashboard.test' }
globalThis.window = {
  location: { origin: 'http://dashboard.test' },
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
}

let sessionToken = 'session-a'
globalThis.localStorage = {
  getItem: (key) => (key === 'auth_token' ? sessionToken : null),
  setItem: () => {},
  removeItem: () => {},
}

const transpiled = ts.transpileModule(apiSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText
const api = await import(
  `data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`
)

const TODAY = '2026-09-21'
const BASE_URL = 'http://dashboard.test'
const TODAY_URL = `${BASE_URL}/api/summary/dashboard`
const TREND_URL = `${BASE_URL}/api/summary/dashboard/trend?days=7`
const shiftDate = (date, offset) => {
  const [year, month, day] = date.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + offset))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`
}

const coverageFor = (available) => (available
  ? { tracked: 2, fresh: 2, stale: 0, unavailable: 0, usable: 2, completeCohort: true, usableRate: 100 }
  : { tracked: 0, fresh: 0, stale: 0, unavailable: 0, usable: 0, completeCohort: false, usableRate: 0 })

const summaryPayload = ({
  date,
  available = true,
  dataStatus = 'fresh',
  totalSpend = 0,
  roas = 0,
  overrides = {},
} = {}) => ({
  success: true,
  data: {
    date,
    totalSpend,
    totalRevenue: totalSpend,
    totalImpressions: 100,
    totalClicks: 10,
    totalInstalls: 1,
    roas,
    ctr: 1,
    cpm: 2,
    cpc: 0.5,
    cpi: 3,
    available,
    dataStatus,
    coverage: coverageFor(available),
    ...overrides,
  },
})

const trendSlot = ({
  date,
  available = true,
  dataStatus = 'fresh',
  totalSpend = 0,
  overrides = {},
}) => ({
  date,
  totalSpend,
  totalRevenue: totalSpend,
  totalImpressions: 100,
  totalClicks: 10,
  totalInstalls: 1,
  roas: totalSpend === 0 ? 0 : 2,
  available,
  dataStatus,
  coverage: coverageFor(available),
  ...overrides,
})

const jsonResponse = (payload, status = 200) => new Response(
  JSON.stringify(payload),
  { status, headers: { 'Content-Type': 'application/json' } },
)

const installRoutes = (routes) => {
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const request = {
      url: String(url),
      headers: new Headers(options.headers || {}),
    }
    calls.push(request)
    const route = routes.find((entry) => entry.match(request.url))
    assert.ok(route, `unexpected dashboard request: ${request.url}`)
    return route.respond(request)
  }
  return calls
}

describe('dashboard core metrics runtime contract', () => {
  it('returns saved subtotals when today is not aggregated but history is available', async () => {
    const trendRows = []
    for (let offset = -6; offset < 0; offset += 1) {
      trendRows.push(trendSlot({
        date: shiftDate(TODAY, offset),
        totalSpend: 10 + (offset + 6) * 5,
      }))
    }
    trendRows.push(trendSlot({
      date: TODAY,
      available: false,
      dataStatus: 'unavailable',
      totalSpend: 0,
    }))

    sessionToken = 'session-a'
    const calls = installRoutes([
      { match: (url) => url === TREND_URL, respond: () => jsonResponse({ success: true, data: trendRows }) },
      { match: (url) => url === `${TODAY_URL}?date=${shiftDate(TODAY, -1)}`, respond: () => jsonResponse(summaryPayload({ date: shiftDate(TODAY, -1), totalSpend: 45, roas: 2 })) },
      { match: (url) => url === TODAY_URL, respond: () => jsonResponse(summaryPayload({ date: TODAY, available: false, dataStatus: 'unavailable' })) },
    ])

    const result = await api.getCoreMetrics()
    assert.equal(result.success, true)

    // 今天未知：金额保持 null，而不是 0。
    assert.equal(result.data.today.available, false)
    assert.equal(result.data.today.dataStatus, 'unavailable')
    assert.equal(result.data.today.spend, null)
    assert.equal(result.data.today.roas, null)

    // 昨天可用：照常展示保存的小计。
    assert.equal(result.data.yesterday.available, true)
    assert.equal(result.data.yesterday.dataStatus, 'fresh')
    assert.equal(result.data.yesterday.spend, 45)

    // 7 日小计只统计 6 个已保存日期，并标记 partial。
    assert.equal(result.data.sevenDays.available, true)
    assert.equal(result.data.sevenDays.availableDays, 6)
    assert.equal(result.data.sevenDays.totalDays, 7)
    assert.equal(result.data.sevenDays.dataStatus, 'partial')
    assert.equal(result.data.sevenDays.spend, 135)
    assert.equal(result.data.sevenDays.avgDailySpend, 135 / 6)

    // 认证请求约束：三个请求都带当前会话 token，且日期由服务端返回决定。
    assert.equal(calls.length, 3)
    assert.deepEqual(
      calls.map((call) => call.url).sort(),
      [TODAY_URL, TREND_URL, `${TODAY_URL}?date=${shiftDate(TODAY, -1)}`].sort(),
    )
    for (const call of calls) {
      assert.equal(call.headers.get('Authorization'), 'Bearer session-a')
    }
  })

  it('fails only when all seven trend days are unavailable', async () => {
    const trendRows = Array.from({ length: 7 }, (_, index) => trendSlot({
      date: shiftDate(TODAY, index - 6),
      available: false,
      dataStatus: 'unavailable',
    }))
    const calls = installRoutes([
      { match: (url) => url === TREND_URL, respond: () => jsonResponse({ success: true, data: trendRows }) },
      { match: (url) => url === TODAY_URL, respond: () => jsonResponse(summaryPayload({ date: TODAY, available: false, dataStatus: 'unavailable' })) },
    ])

    await assert.rejects(
      () => api.getCoreMetrics(),
      /仪表盘数据暂不可用，已保留最近一次缓存/,
    )
    // 全部未知时不再请求昨日接口，保持原有失败/缓存路径。
    assert.equal(calls.length, 2)
  })

  it('keeps partial and stale days in the seven-day subtotal instead of zeroing them', async () => {
    const trendRows = [
      ...Array.from({ length: 4 }, (_, index) => trendSlot({
        date: shiftDate(TODAY, index - 6),
        totalSpend: 10,
      })),
      trendSlot({ date: shiftDate(TODAY, -2), totalSpend: 5, dataStatus: 'partial' }),
      trendSlot({ date: shiftDate(TODAY, -1), totalSpend: 20, dataStatus: 'stale' }),
      trendSlot({ date: TODAY, totalSpend: 3 }),
    ]
    installRoutes([
      { match: (url) => url === TREND_URL, respond: () => jsonResponse({ success: true, data: trendRows }) },
      { match: (url) => url === `${TODAY_URL}?date=${shiftDate(TODAY, -1)}`, respond: () => jsonResponse(summaryPayload({ date: shiftDate(TODAY, -1), dataStatus: 'partial', totalSpend: 20 })) },
      { match: (url) => url === TODAY_URL, respond: () => jsonResponse(summaryPayload({ date: TODAY, totalSpend: 3 })) },
    ])

    const result = await api.getCoreMetrics()
    assert.equal(result.data.sevenDays.availableDays, 7)
    assert.equal(result.data.sevenDays.spend, 68)
    assert.equal(result.data.sevenDays.avgDailySpend, 68 / 7)
    assert.equal(result.data.sevenDays.dataStatus, 'partial')
    assert.equal(result.data.yesterday.dataStatus, 'partial')
    assert.equal(result.data.yesterday.spend, 20)
  })

  it('counts unavailable-date ledgers in coverage instead of faking a complete 100%', async () => {
    const trendRows = Array.from({ length: 6 }, (_, index) => trendSlot({
      date: shiftDate(TODAY, index - 6),
      totalSpend: 10,
    }))
    // 缺失日期（当天没有聚合记录）仍有覆盖台账：2 条记录都还没完成。
    trendRows.push(trendSlot({
      date: TODAY,
      available: false,
      dataStatus: 'unavailable',
      overrides: {
        coverage: {
          tracked: 2,
          fresh: 0,
          stale: 0,
          unavailable: 2,
          usable: 0,
          completeCohort: false,
          usableRate: 0,
        },
      },
    }))
    installRoutes([
      { match: (url) => url === TREND_URL, respond: () => jsonResponse({ success: true, data: trendRows }) },
      { match: (url) => url === `${TODAY_URL}?date=${shiftDate(TODAY, -1)}`, respond: () => jsonResponse(summaryPayload({ date: shiftDate(TODAY, -1), totalSpend: 50 })) },
      { match: (url) => url === TODAY_URL, respond: () => jsonResponse(summaryPayload({ date: TODAY, available: false, dataStatus: 'unavailable' })) },
    ])

    const result = await api.getCoreMetrics()

    // 金额仍只累加已知的 6 天，缺失日期不按 0 摊薄日均。
    assert.equal(result.data.sevenDays.availableDays, 6)
    assert.equal(result.data.sevenDays.totalDays, 7)
    assert.equal(result.data.sevenDays.spend, 60)
    assert.equal(result.data.sevenDays.avgDailySpend, 10)

    // 覆盖率必须合计全部 7 个槽位的台账：6 天可用 × 2 + 缺失日 2 条不可用。
    const coverage = result.data.sevenDays.coverage
    assert.equal(coverage.tracked, 14)
    assert.equal(coverage.usable, 12)
    assert.equal(coverage.unavailable, 2)
    assert.equal(coverage.usableRate, 85.7)
    assert.equal(coverage.completeCohort, false)
    assert.equal(api.isRenderableCoreMetrics(result.data), true)
  })

  it('keeps yesterday unknown when yesterday is not aggregated yet', async () => {
    const trendRows = Array.from({ length: 7 }, (_, index) => trendSlot({
      date: shiftDate(TODAY, index - 6),
      totalSpend: 4,
    }))
    installRoutes([
      { match: (url) => url === TREND_URL, respond: () => jsonResponse({ success: true, data: trendRows }) },
      { match: (url) => url === `${TODAY_URL}?date=${shiftDate(TODAY, -1)}`, respond: () => jsonResponse(summaryPayload({ date: shiftDate(TODAY, -1), available: false, dataStatus: 'unavailable' })) },
      { match: (url) => url === TODAY_URL, respond: () => jsonResponse(summaryPayload({ date: TODAY, totalSpend: 4 })) },
    ])

    const result = await api.getCoreMetrics()
    assert.equal(result.data.today.available, true)
    assert.equal(result.data.today.spend, 4)
    assert.equal(result.data.yesterday.available, false)
    assert.equal(result.data.yesterday.dataStatus, 'unavailable')
    assert.equal(result.data.yesterday.spend, null)
    assert.equal(result.data.sevenDays.dataStatus, 'fresh')
    // 完整 7 天 cohort 才允许 completeCohort=true 与 100% 覆盖率。
    assert.equal(result.data.sevenDays.coverage.completeCohort, true)
    assert.equal(result.data.sevenDays.coverage.usableRate, 100)
    assert.equal(api.isRenderableCoreMetrics(result.data), true)
  })

  it('rejects inconsistent availability flags instead of rendering them', async () => {
    const trendRows = Array.from({ length: 7 }, (_, index) => trendSlot({
      date: shiftDate(TODAY, index - 6),
      totalSpend: 4,
    }))
    // 最后一个槽位号称不可用，却带着 fresh 状态，属于契约错误。
    trendRows[6] = { ...trendRows[6], available: false, dataStatus: 'fresh' }
    const calls = installRoutes([
      { match: (url) => url === TREND_URL, respond: () => jsonResponse({ success: true, data: trendRows }) },
      { match: (url) => url === TODAY_URL, respond: () => jsonResponse(summaryPayload({ date: TODAY, totalSpend: 4 })) },
    ])

    await assert.rejects(() => api.getCoreMetrics(), /契约数据/)
    assert.equal(calls.length, 2)
  })

  it('rejects numeric, slot-count, and HTTP contract violations distinctly', async () => {
    const trendRows = Array.from({ length: 7 }, (_, index) => trendSlot({
      date: shiftDate(TODAY, index - 6),
      totalSpend: 4,
    }))

    // 数值字段被序列化成字符串：契约错误，不能当作可用金额。
    installRoutes([
      { match: (url) => url === TREND_URL, respond: () => jsonResponse({ success: true, data: trendRows }) },
      { match: (url) => url === TODAY_URL, respond: () => jsonResponse(summaryPayload({ date: TODAY, overrides: { totalSpend: '4' } })) },
    ])
    await assert.rejects(() => api.getCoreMetrics(), /契约数据/)

    // 趋势不足 7 个槽位：仍是契约错误。
    installRoutes([
      { match: (url) => url === TREND_URL, respond: () => jsonResponse({ success: true, data: trendRows.slice(0, 6) }) },
      { match: (url) => url === TODAY_URL, respond: () => jsonResponse(summaryPayload({ date: TODAY, totalSpend: 4 })) },
    ])
    await assert.rejects(() => api.getCoreMetrics(), /契约数据/)

    // HTTP 失败与数据状态区分开。
    installRoutes([
      { match: (url) => url === TREND_URL, respond: () => jsonResponse({ success: false }, 500) },
      { match: (url) => url === TODAY_URL, respond: () => jsonResponse(summaryPayload({ date: TODAY, totalSpend: 4 })) },
    ])
    await assert.rejects(() => api.getCoreMetrics(), /Failed to fetch dashboard metrics/)

    // 非 JSON 响应：契约错误，保留缓存。
    installRoutes([
      { match: (url) => url === TREND_URL, respond: () => new Response('<!DOCTYPE html>', { status: 200, headers: { 'Content-Type': 'text/html' } }) },
      { match: (url) => url === TODAY_URL, respond: () => jsonResponse(summaryPayload({ date: TODAY, totalSpend: 4 })) },
    ])
    await assert.rejects(() => api.getCoreMetrics(), /无效的 JSON 响应/)
  })

  it('scopes cached snapshots to the current contract and session', async () => {
    const trendRows = Array.from({ length: 7 }, (_, index) => trendSlot({
      date: shiftDate(TODAY, index - 6),
      totalSpend: 4,
    }))

    // 旧版本缓存没有 available 语义，必须拒绝，避免按可用数据渲染。
    assert.equal(api.isRenderableCoreMetrics({
      today: { spend: 4, impressions: 1, clicks: 1, installs: 1, ctr: 0, cpm: 0, cpc: 0, cpi: 0, roas: 0, dataStatus: 'fresh' },
      yesterday: {},
      sevenDays: {},
    }), false)
    assert.equal(api.isRenderableCoreMetrics({
      today: { available: true, dataStatus: 'unavailable', spend: 4, impressions: 1, clicks: 1, installs: 1, ctr: 0, cpm: 0, cpc: 0, cpi: 0, roas: 0 },
      yesterday: { available: false, dataStatus: 'unavailable', spend: null, impressions: null, clicks: null, installs: null, ctr: null, cpm: null, cpc: null, cpi: null, roas: null },
      sevenDays: { available: true, availableDays: 7, totalDays: 7, spend: 28, impressions: 1, clicks: 1, installs: 1, avgDailySpend: 4, dataStatus: 'fresh' },
    }), false)

    const unknownSnapshot = {
      available: false,
      dataStatus: 'unavailable',
      spend: null,
      impressions: null,
      clicks: null,
      installs: null,
      ctr: null,
      cpm: null,
      cpc: null,
      cpi: null,
      roas: null,
    }
    // available=true 却标 unavailable，不能当作可用小计渲染。
    assert.equal(api.isRenderableCoreMetrics({
      today: unknownSnapshot,
      yesterday: unknownSnapshot,
      sevenDays: { available: true, availableDays: 7, totalDays: 7, spend: 28, impressions: 1, clicks: 1, installs: 1, avgDailySpend: 4, dataStatus: 'unavailable' },
    }), false)
    // availableDays 小于 totalDays 却标 fresh，不能当作完整 7 天数据渲染。
    assert.equal(api.isRenderableCoreMetrics({
      today: unknownSnapshot,
      yesterday: unknownSnapshot,
      sevenDays: { available: true, availableDays: 6, totalDays: 7, spend: 24, impressions: 1, clicks: 1, installs: 1, avgDailySpend: 4, dataStatus: 'fresh' },
    }), false)
    // 缺失日期标 partial 才是合法契约。
    assert.equal(api.isRenderableCoreMetrics({
      today: unknownSnapshot,
      yesterday: unknownSnapshot,
      sevenDays: { available: true, availableDays: 6, totalDays: 7, spend: 24, impressions: 1, clicks: 1, installs: 1, avgDailySpend: 4, dataStatus: 'partial' },
    }), true)

    sessionToken = 'session-b'
    const calls = installRoutes([
      { match: (url) => url === TREND_URL, respond: () => jsonResponse({ success: true, data: trendRows }) },
      { match: (url) => url === `${TODAY_URL}?date=${shiftDate(TODAY, -1)}`, respond: () => jsonResponse(summaryPayload({ date: shiftDate(TODAY, -1), totalSpend: 4 })) },
      { match: (url) => url === TODAY_URL, respond: () => jsonResponse(summaryPayload({ date: TODAY, totalSpend: 4 })) },
    ])

    const result = await api.getCoreMetrics()
    assert.equal(api.isRenderableCoreMetrics(result.data), true)
    assert.equal(calls.length, 3)
    for (const call of calls) {
      assert.equal(call.headers.get('Authorization'), 'Bearer session-b')
    }
  })
})
