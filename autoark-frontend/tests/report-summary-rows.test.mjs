import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const readSource = (relativePath) => readFileSync(
  new URL(relativePath, import.meta.url),
  'utf8',
)

const accountPageSource = readSource('../src/pages/FacebookAccountsPage.tsx')
const campaignPageSource = readSource('../src/pages/FacebookCampaignsPage.tsx')
const countryPageSource = readSource('../src/pages/FacebookCountriesPage.tsx')
const apiSource = readSource('../src/services/api.ts')

const tableBody = (source) => {
  const start = source.indexOf('<tbody>')
  const end = source.indexOf('</tbody>', start)
  assert.notEqual(start, -1, 'missing table body')
  assert.notEqual(end, -1, 'missing table body closing tag')
  return source.slice(start, end)
}

test('account, campaign, and country tables place the filtered-result total before data rows', () => {
  const cases = [
    [accountPageSource, 'accounts.map'],
    [campaignPageSource, 'sortedCampaigns.map'],
    [countryPageSource, 'countries.map'],
  ]

  for (const [source, dataMarker] of cases) {
    const body = tableBody(source)
    const summaryIndex = body.indexOf('aria-label="筛选结果合计"')
    const dataIndex = body.indexOf(dataMarker)
    assert.notEqual(summaryIndex, -1, 'missing filtered-result total row')
    assert.notEqual(dataIndex, -1, `missing data marker: ${dataMarker}`)
    assert.ok(summaryIndex < dataIndex, 'total row must appear before paginated data rows')
  }
})

test('report responses expose unpaginated totals and campaign caches retain them', () => {
  assert.match(apiSource, /interface AccountListResponse[\s\S]*?summary\?:/)
  assert.match(apiSource, /interface CampaignListResponse[\s\S]*?summary\?: PerformanceSummaryTotals/)
  assert.match(apiSource, /interface CountryListResponse[\s\S]*?summary\?: PerformanceSummaryTotals/)
  assert.match(campaignPageSource, /setCampaignSummary\(response\.summary \|\| null\)/)
  assert.match(campaignPageSource, /summary: response\.summary \|\| null/)
})
