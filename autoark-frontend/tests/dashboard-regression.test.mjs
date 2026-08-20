import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const dashboardSource = readFileSync(
  new URL('../src/pages/DashboardPage.tsx', import.meta.url),
  'utf8',
)
const apiSource = readFileSync(
  new URL('../src/services/api.ts', import.meta.url),
  'utf8',
)

const sourceBetween = (source, start, end) => {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`)
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`)
  return source.slice(startIndex, endIndex)
}

test('dashboard core metrics use the authenticated summary pipeline', () => {
  const coreSource = sourceBetween(
    apiSource,
    'export async function getCoreMetrics',
    'export async function getSpendTrend',
  )
  const aggCoreSource = sourceBetween(
    apiSource,
    'export async function getAggCoreMetrics',
    'export async function getAggTrend',
  )

  assert.equal((coreSource.match(/\bfetch\(/g) || []).length, 0)
  assert.ok((coreSource.match(/\bauthFetch\(/g) || []).length >= 3)
  assert.doesNotMatch(coreSource, /yesterdayRes\.ok\s*\?/)
  assert.doesNotMatch(coreSource, /trendRes\.ok\s*\?/)
  assert.match(coreSource, /!yesterdayRes\.ok/)
  assert.match(coreSource, /!trendRes\.ok/)
  assert.doesNotMatch(coreSource, /new Date\(\)\.toISOString\(\)/)
  assert.match(coreSource, /isCompleteDashboardSummary/)
  assert.match(coreSource, /isCompleteDashboardTrendRow/)
  assert.match(coreSource, /trendData\.data\.length\s*!==\s*7/)
  assert.equal((aggCoreSource.match(/\bfetch\(/g) || []).length, 0)
  assert.match(aggCoreSource, /getCoreMetrics\(/)
})

test('dashboard accepts available partial snapshots but rejects unavailable placeholders', () => {
  const validatorSource = sourceBetween(
    apiSource,
    'const isCompleteDashboardSummary',
    '// 获取核心指标',
  )

  assert.equal((validatorSource.match(/value\.available\s*===\s*true/g) || []).length, 2)
  assert.equal((validatorSource.match(/value\.dataStatus/g) || []).length, 2)
  assert.equal((validatorSource.match(/\['fresh', 'stale', 'partial'\]/g) || []).length, 2)
  assert.match(apiSource, /coverage: summary\.coverage/)
})

test('dashboard renders stored partial totals with coverage context instead of fake zeroes', () => {
  const metricSource = sourceBetween(
    dashboardSource,
    '<section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">',
    '<section className="grid gap-5 xl:grid-cols-2">',
  )

  assert.match(dashboardSource, /dataStatus === "partial"/)
  assert.match(dashboardSource, /未覆盖账户保持未知/)
  assert.match(metricSource, /: "--"/)
  assert.doesNotMatch(metricSource, /coreMetrics\?\.[\s\S]*?\|\| 0/)
})

test('dashboard cache is isolated to the authenticated session', () => {
  const source = sourceBetween(
    dashboardSource,
    'const getSessionCacheScope',
    'const loadFromCache',
  )

  assert.match(source, /localStorage\.getItem\(["']auth_token["']\)/)
  assert.match(source, /dashboard_7days_\$\{getSessionCacheScope\(\)\}/)
  assert.doesNotMatch(source, /=>\s*["']dashboard_7days["']/)
  assert.match(dashboardSource, /setLastUpdated\(new Date\(cached\.timestamp\)\)/)
})

test('ROAS zero values do not fall back to spend values', () => {
  const source = sourceBetween(
    dashboardSource,
    'function MiniLineChart',
    'function BarList',
  )

  assert.doesNotMatch(source, /item\[valueKey\]\s*\|\|/)
})

test('trend chart points are separated and clipped to the SVG viewport', () => {
  const source = sourceBetween(
    dashboardSource,
    'function MiniLineChart',
    'function BarList',
  )

  assert.match(source, /\.join\(["'] ["']\)/)
  assert.doesNotMatch(source, /overflow-visible/)
})

test('trend charts expose the hovered day with the correct metric formatting', () => {
  const source = sourceBetween(
    dashboardSource,
    'function MiniLineChart',
    'function BarList',
  )

  assert.match(source, /onPointerMove=\{handlePointerMove\}/)
  assert.match(source, /onPointerLeave=\{clearActivePoint\}/)
  assert.match(source, /role="tooltip"/)
  assert.match(source, /valueLabel/)
  assert.match(source, /formatValue/)
  assert.match(source, /ArrowLeft/)
  assert.match(source, /ArrowRight/)

  assert.match(dashboardSource, /valueLabel="消耗"/)
  assert.match(dashboardSource, /formatValue=\{formatCurrency\}/)
  assert.match(dashboardSource, /valueLabel="ROAS"/)
  assert.match(dashboardSource, /formatValue=\{formatDecimal\}/)
})

test('dashboard rankings use authenticated server-date requests and fail loudly', () => {
  const source = sourceBetween(
    apiSource,
    'export async function getAggCampaignRanking',
    '}\n',
  ) + sourceBetween(
    apiSource,
    'export async function getAggAccountRanking',
    '}\n',
  )

  assert.doesNotMatch(source, /toISOString\(/)
  assert.doesNotMatch(source, /\?date=/)
  assert.equal((source.match(/if \(!response\.ok\)/g) || []).length, 2)
})
