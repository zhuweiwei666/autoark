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
  assert.match(coreSource, /isValidDashboardSummary/)
  assert.match(coreSource, /isValidDashboardTrendSlot/)
  assert.match(coreSource, /trendSlots\.length\s*!==\s*7/)
  assert.match(coreSource, /availableSlots\.length === 0/)
  assert.equal((aggCoreSource.match(/\bfetch\(/g) || []).length, 0)
  assert.match(aggCoreSource, /getCoreMetrics\(/)
})

test('dashboard validators keep date, numeric, and dataStatus checks while allowing unavailable slots', () => {
  const validatorSource = sourceBetween(
    apiSource,
    'const isDashboardMetricSnapshotShape',
    'const isRenderableDashboardSnapshot',
  )

  assert.match(validatorSource, /hasFiniteNumericFields\(value, fields\)/)
  assert.match(validatorSource, /DASHBOARD_DATA_STATUSES\.includes\(value\.dataStatus\)/)
  assert.match(validatorSource, /DASHBOARD_AVAILABLE_STATUSES\.includes\(value\.dataStatus\)/)
  assert.match(validatorSource, /value\.dataStatus === 'unavailable'/)
  assert.match(validatorSource, /const isValidDashboardSummary/)
  assert.match(validatorSource, /const isValidDashboardTrendSlot/)
  assert.match(apiSource, /const isDashboardDate[\s\S]*?Date\.UTC/)
  assert.match(apiSource, /coverage: summary\.coverage/)
  assert.match(apiSource, /const coverageRows = trendSlots/)
  assert.match(apiSource, /const coverageCompleteCohort = trendSlots\.length === 7/)
  assert.match(apiSource, /coverage\.completeCohort = coverage\.completeCohort && coverageCompleteCohort/)
  assert.match(apiSource, /isConsecutiveDashboardDates\(trendSlots\.map/)
})

test('dashboard keeps unavailable days unknown instead of rendering zeros', () => {
  const mapDataSource = sourceBetween(
    apiSource,
    'const mapData = (summary: any)',
    '// 7 日小计只累加',
  )
  const cacheGuardSource = sourceBetween(
    apiSource,
    'const isRenderableDashboardSnapshot',
    'const isRenderableSevenDaysSummary',
  )

  assert.match(mapDataSource, /summary\.available === true/)
  assert.match(mapDataSource, /dataStatus: 'unavailable'/)
  assert.match(mapDataSource, /spend: null/)
  assert.doesNotMatch(mapDataSource, /spend: 0/)
  assert.match(cacheGuardSource, /DASHBOARD_SNAPSHOT_NUMERIC_FIELDS\.every\(field => value\[field\] === null\)/)
  assert.match(apiSource, /export const isRenderableCoreMetrics/)
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
  assert.match(metricSource, /available === true/)
  assert.doesNotMatch(metricSource, /coreMetrics\?\.[\s\S]*?\|\| 0/)
})

test('dashboard explains unsynchronized days without inventing zero values', () => {
  assert.match(dashboardSource, /isTrendSlotAvailable/)
  assert.match(dashboardSource, /今日数据尚未同步/)
  assert.match(dashboardSource, /未知日期不会按 0 计算/)
  assert.match(dashboardSource, /今日指标保持 --/)
  assert.match(dashboardSource, /手动重试/)
  assert.doesNotMatch(dashboardSource, /自动刷新/)
  assert.match(dashboardSource, /formatCurrency\(coreMetrics\.today\.spend\)/)
})

test('dashboard only compares days with known, comparable data', () => {
  const changeSource = sourceBetween(
    dashboardSource,
    'const todayChange = useMemo',
    'const isPositiveChange',
  )

  assert.match(changeSource, /!today\?\.available \|\| !yesterday\?\.available/)
  assert.match(changeSource, /today\.dataStatus === "partial" \|\| yesterday\.dataStatus === "partial"/)
  assert.match(changeSource, /today\.spend === null/)
  assert.match(changeSource, /yesterday\.spend === null/)
  assert.doesNotMatch(changeSource, /today\.spend === 0/)
})

test('trend charts break the line on unsynchronized days instead of plotting zeroes', () => {
  const source = sourceBetween(
    dashboardSource,
    'function MiniLineChart',
    'function BarList',
  )

  assert.doesNotMatch(source, /Number\(item\[valueKey\] \?\? 0\)/)
  assert.match(source, /isTrendSlotAvailable/)
  assert.match(source, /segments/)
  assert.match(source, /数据尚未同步/)
  assert.match(source, /\.join\(["'] ["']\)/)
})

test('dashboard cache is isolated to the authenticated session and current contract', () => {
  const source = sourceBetween(
    dashboardSource,
    'const getSessionCacheScope',
    'const loadFromCache',
  )
  const cacheSource = sourceBetween(
    dashboardSource,
    'const loadFromCache',
    'const isTrendSlotAvailable',
  )

  assert.match(source, /localStorage\.getItem\(["']auth_token["']\)/)
  assert.match(source, /dashboard_7days_\$\{getSessionCacheScope\(\)\}/)
  assert.doesNotMatch(source, /=>\s*["']dashboard_7days["']/)
  assert.match(cacheSource, /isRenderableCoreMetrics\(data\.coreMetrics\)/)
  assert.match(dashboardSource, /setLastUpdated\(new Date\(cached\.timestamp\)\)/)

  // 7 日小计缓存契约：available=true 不能携带 unavailable，缺失日期不能标 fresh。
  const sevenDaysGuardSource = sourceBetween(
    apiSource,
    'const isRenderableSevenDaysSummary',
    'export const isRenderableCoreMetrics',
  )
  assert.match(sevenDaysGuardSource, /DASHBOARD_AVAILABLE_STATUSES\.includes\(value\.dataStatus\)/)
  assert.match(sevenDaysGuardSource, /value\.availableDays === value\.totalDays \|\| value\.dataStatus !== 'fresh'/)
  assert.doesNotMatch(sevenDaysGuardSource, /DASHBOARD_DATA_STATUSES\.includes\(value\.dataStatus\)/)
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
