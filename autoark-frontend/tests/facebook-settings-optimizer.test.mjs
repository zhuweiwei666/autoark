import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const pageSource = readFileSync(
  new URL('../src/pages/FacebookSettingsPage.tsx', import.meta.url),
  'utf8',
)

const sourceBetween = (source, start, end) => {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`)
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`)
  return source.slice(startIndex, endIndex)
}

test('settings page saves a trimmed optimizer and can clear it', () => {
  const saveSource = sourceBetween(
    pageSource,
    'const handleSaveOptimizer',
    '// 绑定 Token',
  )

  assert.match(pageSource, /updateToken/)
  assert.match(saveSource, /optimizer:\s*editOptimizer\.trim\(\)/)
  assert.doesNotMatch(saveSource, /trim\(\)\s*\|\|\s*undefined/)
  assert.match(saveSource, /let updateSucceeded = false/)
  assert.match(saveSource, /updateSucceeded = true/)
  assert.match(saveSource, /await refetchTokens\(\{ throwOnError: true \}\)/)
  assert.match(saveSource, /优化师已保存，但列表刷新失败/)
  assert.match(saveSource, /setEditingTokenId\(null\)/)
})

test('settings page exposes accessible save and cancel controls', () => {
  assert.match(pageSource, /maxLength=\{80\}/)
  assert.match(pageSource, /e\.nativeEvent\.isComposing/)
  assert.match(pageSource, /e\.key === 'Enter'/)
  assert.match(pageSource, /e\.key === 'Escape'/)
  assert.match(pageSource, /aria-label="保存优化师"/)
  assert.match(pageSource, /aria-label="取消编辑优化师"/)
  assert.match(pageSource, /savingTokenId === token\.id/)
  assert.match(pageSource, /optimizerInputRef/)
  assert.match(pageSource, /requestAnimationFrame/)
  assert.match(pageSource, /role=\{message\.type === 'error' \? 'alert' : 'status'\}/)
})
