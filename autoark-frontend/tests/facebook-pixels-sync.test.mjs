import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const readSource = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const pixelPageSource = readSource('../src/pages/FacebookPixelsPage.tsx')
const settingsPageSource = readSource('../src/pages/FacebookSettingsPage.tsx')
const apiSource = readSource('../src/services/api.ts')

for (const [label, source] of [
  ['Pixel management', pixelPageSource],
  ['Facebook settings', settingsPageSource],
]) {
  test(`${label} scopes cached pixels to the selected active token`, () => {
    assert.match(source, /getTokens\(\{[^}]*pageSize:\s*200/)
    assert.match(source, /selectedTokenId/)
    assert.match(source, /getPixels\(\{ tokenId: selectedTokenId \}\)/)
    assert.match(source, /getPixels\(\{ allTokens: true \}\)/)
  })

  test(`${label} only spends Meta quota for an explicit selected-token sync`, () => {
    assert.match(
      source,
      /getPixels\(\{ tokenId: selectedTokenId, refresh: true \}\)/,
    )
    assert.match(source, /if \(allTokens\) \{[\s\S]*refetch/)
    assert.doesNotMatch(source, /getPixels\(\{ allTokens: true, refresh: true \}\)/)
  })
}

test('Pixel API serializes refresh only when the caller opts in', () => {
  assert.match(apiSource, /if \(params\?\.refresh\) queryParams\.append\('refresh', 'true'\)/)
  assert.doesNotMatch(apiSource, /queryParams\.append\('refresh', 'true'\)[\s\S]*else/)
})
