import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const pageSource = readFileSync(
  new URL('../src/pages/BulkAdCreatePage.tsx', import.meta.url),
  'utf8',
)

const sourceBetween = (source, start, end) => {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`)
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`)
  return source.slice(startIndex, endIndex)
}

test('choosing a Pixel only filters accounts and does not preload Page assets', () => {
  const filterSource = sourceBetween(
    pageSource,
    'const filterAccountsByPixel',
    '// 批量选择多个账户',
  )

  assert.doesNotMatch(filterSource, /selectMultipleAccounts/)
  assert.doesNotMatch(filterSource, /auth\/pages/)
})

test('bulk account selection is optimistic, concurrent, and single-flight', () => {
  const selectionSource = sourceBetween(
    pageSource,
    'const selectMultipleAccounts',
    '// 全选/取消全选活跃账户',
  )

  const optimisticCommit = selectionSource.indexOf('setSelectedAccounts(newSelectedAccounts)')
  const pageReads = selectionSource.indexOf('await Promise.all(')

  assert.ok(optimisticCommit >= 0, 'accounts should be selected before Page reads finish')
  assert.equal(pageReads, -1, 'selection should not launch an unbounded Promise.all fan-out')
  assert.match(selectionSource, /await mapWithConcurrency\(/)
  assert.match(selectionSource, /ACCOUNT_PAGE_FETCH_CONCURRENCY/)
  assert.match(pageSource, /accountSelectionPromiseRef/)
  assert.match(pageSource, /accountPageRequestsRef/)
  assert.match(pageSource, /accountPageRequestsRef\.current\.get\(accountId\)/)
  assert.match(pageSource, /accountPageRequestsRef\.current\.set\(accountId,/)
  assert.doesNotMatch(
    selectionSource,
    /for\s*\(const account of accountsToSelect\)[\s\S]*await\s+authFetch/,
  )
})

test('account controls expose loading state and prevent duplicate selection requests', () => {
  assert.match(pageSource, /const \[selectingAccounts, setSelectingAccounts\] = useState\(false\)/)
  assert.match(pageSource, /disabled=\{selectingAccounts\}/)
  assert.match(pageSource, /selectingAccounts \? '加载主页\.\.\.'/)
  assert.match(pageSource, /disabled=\{!isActive \|\| selectingAccounts\}/)
  assert.match(pageSource, /selectingAccounts \? \(/)
  assert.match(pageSource, /currentStep === 3 && \(selectingAccounts \|\|/)
  assert.match(pageSource, /disabled=\{currentStep === 1 \|\| selectingAccounts\}/)
  assert.match(pageSource, /disabled=\{hasNoPages \|\| selectingAccounts\}/)
})
