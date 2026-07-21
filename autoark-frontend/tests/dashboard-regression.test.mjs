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

test('dashboard cache is isolated to the authenticated session', () => {
  const source = sourceBetween(
    dashboardSource,
    'const getSessionCacheScope',
    'const loadFromCache',
  )

  assert.match(source, /localStorage\.getItem\(["']auth_token["']\)/)
  assert.match(source, /dashboard_7days_\$\{getSessionCacheScope\(\)\}/)
  assert.doesNotMatch(source, /=>\s*["']dashboard_7days["']/)
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
