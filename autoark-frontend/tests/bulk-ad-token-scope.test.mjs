import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(
  new URL('../src/pages/BulkAdCreatePage.tsx', import.meta.url),
  'utf8',
)

test('bulk ad assets are loaded through the selected Facebook personal token', () => {
  assert.match(source, /loadAdAccounts\(nextTokenId\)/)
  assert.match(source, /loadAuthDiagnostics\(nextTokenId\)/)
  assert.match(source, /fetchSyncStatus\(nextTokenId\)/)
  assert.match(
    source,
    /withFacebookTokenId\(\s*`\$\{API_BASE\}\/bulk-ad\/auth\/ad-accounts`,\s*facebookTokenId/,
  )
  assert.match(
    source,
    /withFacebookTokenId\(\s*`\$\{API_BASE\}\/bulk-ad\/auth\/cached-pixels`,\s*facebookTokenId/,
  )
  assert.match(
    source,
    /withFacebookTokenId\(\s*`\$\{API_BASE\}\/bulk-ad\/auth\/pages\?accountId=\$\{accountId\}`,\s*facebookTokenId/,
  )
})

test('switching Facebook personal tokens clears stale selections and ignores stale responses', () => {
  assert.match(
    source,
    /activeFacebookTokenIdRef\.current !== nextTokenId[\s\S]*resetFacebookAssetSelection\(\)/,
  )
  assert.match(source, /setSelectedAccounts\(\[\]\)/)
  assert.match(
    source,
    /const loadAdAccounts[\s\S]*await res\.json\(\)[\s\S]*if \(!isActiveFacebookToken\(facebookTokenId\)\) return[\s\S]*setAccounts\(/,
  )
  assert.match(
    source,
    /const handleFacebookLogin[\s\S]*activeFacebookTokenIdRef\.current = null[\s\S]*resetFacebookAssetSelection\(\)[\s\S]*authFetch\(/,
  )
  assert.match(
    source,
    /const nextDisabled = \(\s*authLoading \|\|\s*loginLoading \|\|/,
  )
  assert.match(
    source,
    /disabled=\{loading \|\| authLoading \|\| loginLoading \|\| selectedAccounts/,
  )
})

test('bulk ad drafts persist the selected token used by publish execution', () => {
  assert.match(source, /const facebookTokenId = authStatus\?\.tokenId/)
  assert.match(source, /facebookTokenId,\s*accounts: selectedAccounts/)
  assert.match(
    source,
    /本次仅展示并使用此个人号 Token 下的广告账户、Page 和 Pixel/,
  )
})
